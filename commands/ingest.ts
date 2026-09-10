import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * =========================================================================
 *  node ace sisbm:ingest — worker d'ingestion télémétrie
 * =========================================================================
 *
 * PROCESSUS SÉPARÉ de l'API. Une rafale de Store & Forward — un boîtier qui
 * rejoue deux heures de trames au sortir d'une zone blanche — ne doit pas
 * dégrader le temps de réponse des tableaux de bord.
 *
 *   node ace sisbm:ingest                    # écoute le broker
 *   node ace sisbm:ingest --dry-run          # analyse sans persister
 *   node ace sisbm:ingest --batch-window=500 # regroupement en millisecondes
 */
export default class Ingest extends BaseCommand {
  static commandName = 'sisbm:ingest'
  static description = 'Consomme le flux MQTT de télémétrie et alimente la base'

  // `start` : le conteneur applicatif complet est nécessaire (base, Redis,
  // configuration). `staysAlive` : la commande ne se termine pas d'elle-même.
  static options: CommandOptions = { startApp: true, staysAlive: true }

  @flags.boolean({ description: 'Analyse et journalise sans écrire en base' })
  declare dryRun: boolean

  @flags.number({ description: 'Fenêtre de regroupement des trames, en ms' })
  declare batchWindow: number

  async run() {
    const { default: sisbmConfig } = await import('#config/sisbm')
    const { MqttTelemetryTransport } =
      await import('#infrastructure/gateways/flespi/mqtt_transport')
    const { FlespiFrameParser, FlespiParseError } =
      await import('#infrastructure/gateways/flespi/flespi_frame_parser')
    const { IngestTelemetryFrames } =
      await import('#application/telemetry/use_cases/ingest_telemetry_frames')
    const { LucidUnitOfWork } = await import('#infrastructure/persistence/unit_of_work')
    const {
      LucidPositionRepository,
      LucidVehicleLastPositionRepository,
      LucidIngestMessageRepository,
    } = await import('#infrastructure/persistence/repositories/telemetry_repositories')
    const { LucidTripRepository } =
      await import('#infrastructure/persistence/repositories/trip_repository')
    const { CachedDeviceResolver } =
      await import('#infrastructure/persistence/readers/device_resolver')
    const { TransmitBroadcaster } = await import('#infrastructure/realtime/transmit_broadcaster')
    const { SystemClock } = await import('#infrastructure/services/clock')
    const { UuidGenerator } = await import('#infrastructure/services/id_generator')

    const mqtt = sisbmConfig.mqtt
    const fenetre = this.batchWindow ?? 300

    const parser = new FlespiFrameParser()
    const ingestion = new IngestTelemetryFrames(
      new LucidUnitOfWork(),
      new LucidIngestMessageRepository(),
      new LucidPositionRepository(),
      new LucidVehicleLastPositionRepository(),
      new LucidTripRepository(),
      new CachedDeviceResolver(),
      new TransmitBroadcaster(),
      new SystemClock(),
      new UuidGenerator(),
      {
        maxHdop: sisbmConfig.ingestion.maxHdop,
        minSatellites: sisbmConfig.ingestion.minSatellites,
        maxPlausibleSpeedKph: sisbmConfig.ingestion.maxPlausibleSpeedKph,
        maxClockSkewSeconds: 300,
        backlogThresholdSeconds: sisbmConfig.ingestion.backlogThresholdSeconds,
        tripIdleTimeoutSeconds: sisbmConfig.trips.idleTimeoutSeconds,
        tripMaxDurationHours: sisbmConfig.trips.maxDurationHours,
        tripMinDistanceMeters: sisbmConfig.trips.minDistanceMeters,
        idleSpeedThresholdKph: 3,
      }
    )

    const transport = new MqttTelemetryTransport({
      host: mqtt.host,
      port: mqtt.port,
      tls: mqtt.tls,
      clientId: `${mqtt.clientId}-${process.pid}`,
      username: mqtt.username || undefined,
      password: mqtt.password || undefined,
      topics: mqtt.topics,
      qos: mqtt.qos,
      reconnectPeriodMs: mqtt.reconnectPeriodMs,
      connectTimeoutMs: mqtt.connectTimeoutMs,
      maxInflightQueue: mqtt.maxInflightQueue,
    })

    /**
     * Regroupement temporel.
     *
     * Les trames arrivent une par une, mais une rafale en livre des centaines
     * en quelques millisecondes. Les accumuler sur une courte fenêtre permet
     * une seule transaction pour tout le lot, au lieu d'une par trame.
     *
     * ⚠ La promesse de chaque message n'est résolue QU'APRÈS le vidage du
     * lot : c'est ce qui retarde l'acquittement MQTT jusqu'après le COMMIT.
     */
    let lot: Awaited<ReturnType<typeof parser.parse>> = []
    let attente: Array<() => void> = []
    let minuteur: NodeJS.Timeout | null = null
    let traitees = 0
    let persistees = 0
    let rejetees = 0

    const vider = async () => {
      if (minuteur) {
        clearTimeout(minuteur)
        minuteur = null
      }
      if (lot.length === 0) {
        attente.forEach((r) => r())
        attente = []
        return
      }

      const frames = lot
      const resolveurs = attente
      lot = []
      attente = []

      try {
        if (this.dryRun) {
          this.logger.info(`[dry-run] ${frames.length} trame(s) analysée(s), non persistées`)
        } else {
          const r = await ingestion.execute({ frames })
          if (r.ok) {
            traitees += r.value.received
            persistees += r.value.persisted
            rejetees += r.value.rejected
            if (r.value.unknownDevices > 0) {
              this.logger.warning(
                `${r.value.unknownDevices} trame(s) de boîtier(s) inconnu(s) — journalisées`
              )
            }
            if (r.value.tripsStarted || r.value.tripsClosed) {
              this.logger.info(
                `trajets : ${r.value.tripsStarted} ouvert(s), ${r.value.tripsClosed} clos`
              )
            }
          } else {
            this.logger.error(`ingestion en échec : ${r.error.code} — ${r.error.message}`)
          }
        }
      } catch (err) {
        // On NE résout PAS les promesses : sans acquittement, le broker
        // rejouera les messages. Une base indisponible provoque un retard,
        // jamais une perte.
        this.logger.error(`échec de traitement du lot : ${(err as Error).message}`)
        return
      }

      resolveurs.forEach((r) => r())
    }

    await transport.subscribe(async (raw, topic) => {
      try {
        lot.push(...parser.parse(raw, topic))
      } catch (err) {
        rejetees += 1
        if (err instanceof FlespiParseError) {
          this.logger.warning(`trame illisible sur ${topic} : ${err.detail}`)
        } else {
          this.logger.warning(`trame ignorée sur ${topic} : ${(err as Error).message}`)
        }
        return
      }

      await new Promise<void>((resolve) => {
        attente.push(resolve)
        if (!minuteur) minuteur = setTimeout(() => void vider(), fenetre)
      })
    })

    this.logger.success(
      `écoute de ${mqtt.topics.join(', ')} sur ${mqtt.host}:${mqtt.port} ` +
        `(QoS ${mqtt.qos}, fenêtre ${fenetre} ms)`
    )
    if (this.dryRun) this.logger.warning('mode dry-run : aucune écriture en base')

    // Bilan périodique — utile pour vérifier que le flux ne s'est pas tari.
    const bilan = setInterval(() => {
      if (traitees > 0) {
        this.logger.info(
          `bilan : ${traitees} reçue(s) · ${persistees} persistée(s) · ${rejetees} rejetée(s)`
        )
      }
    }, 60_000)
    bilan.unref()

    /**
     * Arrêt gracieux : on vide le lot en cours, on laisse les transactions se
     * terminer, puis on ferme. `tini` en PID 1 dans le Dockerfile est ce qui
     * rend le SIGTERM recevable par Node.
     */
    const arreter = async (signal: string) => {
      this.logger.info(`${signal} reçu — arrêt en cours`)
      clearInterval(bilan)
      await vider()
      await transport.disconnect()
      this.logger.success(
        `arrêté. Bilan : ${traitees} reçue(s) · ${persistees} persistée(s) · ${rejetees} rejetée(s)`
      )
      await this.terminate()
    }

    process.on('SIGTERM', () => void arreter('SIGTERM'))
    process.on('SIGINT', () => void arreter('SIGINT'))
  }
}
