import mqtt, { type MqttClient, type IClientOptions, type IPublishPacket } from 'mqtt'
import logger from '@adonisjs/core/services/logger'
import type { TelemetryTransport } from '#application/telemetry/ports'

export interface MqttTransportConfig {
  host: string
  port: number
  tls: boolean
  clientId: string
  username?: string
  password?: string
  topics: string[]
  qos: 0 | 1 | 2
  reconnectPeriodMs: number
  connectTimeoutMs: number
  /** Plafond de la file interne — mécanisme de contre-pression. */
  maxInflightQueue: number
}

/**
 * =========================================================================
 *  TRANSPORT MQTT — adaptateur d'infrastructure
 * =========================================================================
 *
 * Trois propriétés distinguent une ingestion robuste d'une ingestion naïve.
 *
 * ① ACQUITTEMENT APRÈS PERSISTANCE
 *    En MQTT.js 5, le PUBACK d'un message QoS 1 est émis DANS le callback de
 *    `handleMessage` (cf. handlers/publish.js). En surchargeant cette méthode,
 *    on maîtrise l'instant exact de l'acquittement : il n'est envoyé qu'une
 *    fois le COMMIT effectué.
 *
 *    ⚠ L'option `manualAcks` des versions 4.x n'existe plus en 5.x — c'est
 *    `handleMessage` qui joue ce rôle. Si la base est indisponible, on ne
 *    rappelle pas le callback : le broker rejouera. Une base lente provoque
 *    un retard, jamais une perte.
 *
 * ② CONTRE-PRESSION
 *    Au-delà de `maxInflightQueue`, le client cesse de consommer. La pression
 *    remonte jusqu'au broker au lieu de saturer la mémoire du processus. Sans
 *    ce garde-fou, une rafale de Store & Forward fait tomber le worker.
 *
 * ③ ARRÊT GRACIEUX
 *    À l'arrêt, on cesse de souscrire, on laisse les messages en cours
 *    terminer leur transaction, puis on ferme. `tini` en PID 1 dans le
 *    Dockerfile est ce qui rend le SIGTERM recevable par Node.
 */

export class MqttTelemetryTransport implements TelemetryTransport {
  #client: MqttClient | null = null
  #arretDemande = false
  #enCours = 0
  #suspendu = false

  constructor(private readonly config: MqttTransportConfig) {}

  get isConnected(): boolean {
    return this.#client?.connected ?? false
  }

  get inFlight(): number {
    return this.#enCours
  }

  async subscribe(handler: (raw: string, topic: string) => Promise<void>): Promise<void> {
    const url = `${this.config.tls ? 'mqtts' : 'mqtt'}://${this.config.host}:${this.config.port}`

    const options: IClientOptions = {
      clientId: this.config.clientId,
      username: this.config.username,
      password: this.config.password,
      // MQTT 5 : requis pour l'expiration par message posée côté Flespi.
      protocolVersion: 5,
      clean: false, // session persistante : le broker retient pendant une coupure
      reconnectPeriod: this.config.reconnectPeriodMs,
      connectTimeout: this.config.connectTimeoutMs,
      manualConnect: false,
      resubscribe: true,
      properties: {
        // TTL de session : au-delà, le broker cesse de retenir pour ce client.
        sessionExpiryInterval: 3600,
      },
    }

    await new Promise<void>((resolve, reject) => {
      const client = mqtt.connect(url, options)
      this.#client = client

      // ---- ① point de contrôle de l'acquittement QoS 1
      client.handleMessage = (packet: IPublishPacket, done: (e?: Error) => void) => {
        if (this.#arretDemande) return done()
        const topic = packet.topic
        const raw = packet.payload.toString('utf8')
        void this.traiter(handler, topic, raw, done)
      }

      client.on('connect', () => {
        logger.info({ url, topics: this.config.topics }, '[mqtt] connecté au broker')
        client.subscribe(this.config.topics, { qos: this.config.qos }, (err) =>
          err ? reject(err) : resolve()
        )
      })

      client.on('reconnect', () => logger.warn('[mqtt] reconnexion en cours'))
      client.on('offline', () => logger.warn('[mqtt] hors ligne'))
      client.on('error', (err) => logger.error({ err }, '[mqtt] erreur de transport'))

      setTimeout(
        () => reject(new Error('[mqtt] délai de connexion dépassé')),
        this.config.connectTimeoutMs + 2000
      ).unref?.()
    })
  }

  private async traiter(
    handler: (raw: string, topic: string) => Promise<void>,
    topic: string,
    raw: string,
    done: (e?: Error) => void
  ): Promise<void> {
    this.#enCours += 1
    this.appliquerContrePression()

    try {
      await handler(raw, topic)
      // Acquittement : le PUBACK part ici, après le COMMIT.
      done()
    } catch (err) {
      logger.error({ err, topic }, '[mqtt] échec de traitement — message NON acquitté')
      // On propage l'erreur SANS acquitter : le broker rejouera.
      done(err as Error)
    } finally {
      this.#enCours -= 1
      this.appliquerContrePression()
    }
  }

  /** ② Suspend ou reprend la consommation selon la charge en cours. */
  private appliquerContrePression(): void {
    const client = this.#client
    if (!client) return

    if (!this.#suspendu && this.#enCours >= this.config.maxInflightQueue) {
      this.#suspendu = true
      client.unsubscribe(this.config.topics)
      logger.warn({ enCours: this.#enCours }, '[mqtt] contre-pression — consommation suspendue')
      return
    }

    if (this.#suspendu && this.#enCours <= this.config.maxInflightQueue / 2) {
      this.#suspendu = false
      client.subscribe(this.config.topics, { qos: this.config.qos })
      logger.info('[mqtt] consommation reprise')
    }
  }

  /** ③ Arrêt gracieux : on laisse les transactions en cours se terminer. */
  async disconnect(): Promise<void> {
    this.#arretDemande = true
    const client = this.#client
    if (!client) return

    logger.info({ enCours: this.#enCours }, '[mqtt] arrêt demandé')
    const echeance = Date.now() + 15_000
    while (this.#enCours > 0 && Date.now() < echeance) {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (this.#enCours > 0) {
      logger.warn({ enCours: this.#enCours }, '[mqtt] arrêt forcé, messages non acquittés')
    }

    await new Promise<void>((resolve) => client.end(false, {}, () => resolve()))
    this.#client = null
    logger.info('[mqtt] déconnecté')
  }
}

/**
 * Transport en MÉMOIRE — pour les tests.
 *
 * C'est l'intérêt du port : la chaîne complète se teste sans broker, sans
 * conteneur et sans réseau.
 */
export class InMemoryTelemetryTransport implements TelemetryTransport {
  #handler: ((raw: string, topic: string) => Promise<void>) | null = null
  #connecte = false

  get isConnected(): boolean {
    return this.#connecte
  }

  async subscribe(handler: (raw: string, topic: string) => Promise<void>): Promise<void> {
    this.#handler = handler
    this.#connecte = true
  }

  /** Injecte une trame comme si elle venait du broker. */
  async emit(raw: string, topic = 'sisbm/telemetry/000000000000000/data'): Promise<void> {
    if (!this.#handler) throw new Error('aucun abonnement actif')
    await this.#handler(raw, topic)
  }

  async disconnect(): Promise<void> {
    this.#connecte = false
    this.#handler = null
  }
}
