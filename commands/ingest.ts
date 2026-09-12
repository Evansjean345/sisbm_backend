import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * =========================================================================
 *  node ace sisbm:ingest — worker d'ingestion télémétrie (broker flespi)
 * =========================================================================
 *
 * PROCESSUS SÉPARÉ de l'API. Une rafale de Store & Forward — un boîtier qui
 * rejoue deux heures de trames au sortir d'une zone blanche — ne doit pas
 * dégrader le temps de réponse des tableaux de bord.
 *
 * Source : mqtt.flespi.io, topic `flespi/message/gw/devices/+` (un message
 * par publication), authentification par jeton flespi.
 *
 *   node ace sisbm:ingest                  # écoute le broker flespi
 *   node ace sisbm:ingest --dry-run        # analyse et journalise, sans écrire en base
 *   node ace sisbm:ingest --worker=2       # 2e worker : clientId distinct, souscription partagée
 */
export default class Ingest extends BaseCommand {
  static commandName = 'sisbm:ingest'
  static description = 'Consomme le flux MQTT flespi et alimente la base'

  static options: CommandOptions = { startApp: true, staysAlive: true }

  @flags.boolean({ description: 'Analyse et journalise sans écrire en base' })
  declare dryRun: boolean

  @flags.number({
    description: 'Numéro du worker (clientId distinct, souscription partagée requise)',
  })
  declare worker: number

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

    const flespi = sisbmConfig.flespi
    if (!flespi.mqttToken) {
      this.logger.error(
        'FLESPI_MQTT_TOKEN (ou FLESPI_TOKEN) absent : impossible de se connecter au broker flespi'
      )
      this.exitCode = 1
      return await this.terminate()
    }
    if (this.worker && !flespi.shareGroup) {
      this.logger.warning(
        'Plusieurs workers sans FLESPI_MQTT_SHARE_GROUP : chacun recevra TOUS les messages (doublons).'
      )
    }

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
      host: flespi.mqttHost,
      port: flespi.mqttPort,
      tls: flespi.mqttTls,
      // STABLE : c'est lui qui retrouve la session persistante au redémarrage.
      clientId: this.worker ? `${flespi.clientId}-${this.worker}` : flespi.clientId,
      username: flespi.mqttToken,
      password: '',
      topics: flespi.topics,
      shareGroup: flespi.shareGroup || undefined,
      qos: 1,
      reconnectPeriodMs: sisbmConfig.mqtt.reconnectPeriodMs,
      connectTimeoutMs: sisbmConfig.mqtt.connectTimeoutMs,
      receiveMaximum: sisbmConfig.mqtt.maxInflightQueue,
      sessionExpirySeconds: flespi.sessionExpirySeconds,
      maxAttempts: 20,
    })

    let traitees = 0
    let persistees = 0
    let rejetees = 0
    let doublons = 0
    /** Cumul des motifs de rejet sur la durée de vie du worker. */
    const motifs: Record<string, number> = {}

    /**
     * Un message MQTT = une transaction. Contrat avec le transport :
     *  - rendre la main  → message acquitté (y compris trame illisible, déjà journalisée) ;
     *  - lever           → erreur transitoire (base…), le transport réessaie sans acquitter.
     */
    await transport.subscribe(
      async (raw, topic) => {
        let frames: Awaited<ReturnType<typeof parser.parse>>
        try {
          frames = parser.parse(raw, topic)
        } catch (err) {
          rejetees += 1
          motifs.illisible = (motifs.illisible ?? 0) + 1
          const detail = err instanceof FlespiParseError ? err.detail : (err as Error).message
          this.logger.warning(`trame ignorée sur ${topic} : ${detail}`)
          return
        }

        if (this.dryRun) {
          for (const f of frames) {
            this.logger.info(
              `[dry-run] ${f.ident} ${f.recordedAt.toISOString()} ${f.latitude},${f.longitude} ` +
                `${f.speedKph} km/h ign=${f.ignition} sat=${f.satellites}`
            )
          }
          traitees += frames.length
          return
        }

        const r = await ingestion.execute({ frames })
        if (r.ok) {
          traitees += r.value.received
          persistees += r.value.persisted
          rejetees += r.value.rejected
          doublons += r.value.duplicates
          for (const [motif, n] of Object.entries(r.value.rejectedReasons)) {
            motifs[motif] = (motifs[motif] ?? 0) + n
          }
          if (r.value.unknownDevices > 0) {
            this.logger.warning(
              `trame d'un boîtier inconnu (${frames[0]?.ident}) — enregistrer le boîtier avec cet ident`
            )
          }

          /**
           * Le MOTIF du rejet, trame par trame. C'est la seule information qui
           * permette d'agir : `invalid_fix` et `null_island` signifient que le
           * boîtier ne voit pas le ciel (parking, intérieur) et qu'aucun seuil
           * n'y changera rien ; `few_satellites` et `poor_hdop` désignent un
           * seuil ; `implausible_jump` une position aberrante. Sans ce détail,
           * le worker annonce « 6 rejetée(s) » et laisse deviner.
           */
          const detailRejets = Object.entries(r.value.rejectedReasons)
            .map(([m, n]) => `${m}×${n}`)
            .join(', ')
          if (detailRejets) {
            this.logger.warning(
              `${frames[0]?.ident ?? '?'} : ${r.value.rejected} trame(s) rejetée(s) — ${detailRejets}`
            )
          }
          if (r.value.duplicates > 0) {
            // Rejeu de session MQTT, pas un échec : à ne pas lire comme une perte.
            this.logger.info(`${r.value.duplicates} trame(s) déjà connue(s) — ignorée(s)`)
          }
        } else {
          // Erreur métier : rejouer ne changerait rien. On journalise et on acquitte.
          rejetees += frames.length
          this.logger.error(`ingestion refusée : ${r.error.code} — ${r.error.message}`)
        }
      },
      /**
       * Panne définitive (schéma de base incompatible, privilèges manquants,
       * tentatives épuisées) : on sort en erreur au lieu de boucler. Les
       * messages restent dans la session flespi et seront rejoués au
       * redémarrage — aucune trame n'est perdue, mais le superviseur voit
       * l'échec au lieu d'un worker « vivant » qui ne persiste plus rien.
       */
      (err) => {
        this.logger.error(`ingestion arrêtée : ${err.message}`)
        this.exitCode = 1
        void this.terminate()
      }
    )

    this.logger.success(
      `écoute de ${transport.subscriptions.join(', ')} sur ${flespi.mqttHost}:${flespi.mqttPort} (QoS 1)`
    )
    if (this.dryRun) this.logger.warning('mode dry-run : aucune écriture en base')

    const resume = () => {
      const parMotif = Object.entries(motifs)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m}×${n}`)
        .join(', ')
      return (
        `${transport.received} reçue(s) · ${persistees} persistée(s) · ` +
        `${doublons} doublon(s) · ${rejetees} rejetée(s)` +
        (parMotif ? ` [${parMotif}]` : '')
      )
    }

    const bilan = setInterval(() => {
      this.logger.info(`bilan : ${resume()} · connecté=${transport.isConnected}`)
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
      await transport.disconnect()
      this.logger.success(`arrêté. Bilan : ${resume()} · ${traitees} trame(s) analysée(s)`)
      await this.terminate()
    }

    process.on('SIGTERM', () => void arreter('SIGTERM'))
    process.on('SIGINT', () => void arreter('SIGINT'))
  }
}
