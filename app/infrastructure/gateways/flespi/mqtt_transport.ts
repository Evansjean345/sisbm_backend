import mqtt, { type MqttClient, type IClientOptions, type IPublishPacket } from 'mqtt'
import logger from '@adonisjs/core/services/logger'
import type { TelemetryTransport } from '#application/telemetry/ports'

export interface MqttTransportConfig {
  host: string
  port: number
  tls: boolean
  /** STABLE d'un démarrage à l'autre : la session persistante y est attachée. */
  clientId: string
  /** flespi : username = jeton, mot de passe vide. */
  username?: string
  password?: string
  topics: string[]
  /** flespi ne gère que QoS 0 et 1. */
  qos: 0 | 1
  reconnectPeriodMs: number
  connectTimeoutMs: number
  /**
   * MQTT 5 « Receive Maximum » : nombre de messages QoS 1 non acquittés que
   * le broker peut nous envoyer. C'est LE mécanisme de contre-pression : au-delà,
   * le broker garde les messages dans la session au lieu de nous les pousser.
   */
  receiveMaximum: number
  /** Rétention de la session côté broker pendant une coupure, en secondes. */
  sessionExpirySeconds: number
  /** Souscription partagée `$share/<groupe>/…` pour répartir la charge entre workers. */
  shareGroup?: string
  /**
   * Nombre maximal de tentatives sur un même message avant de déclarer la
   * panne. Avec le backoff 1 s → 30 s, 20 tentatives ≈ 9 minutes.
   *
   * Une borne est INDISPENSABLE : `handleMessage` est séquentiel, donc un
   * message réessayé sans fin gèle tout le pipeline de paquets — y compris le
   * SUBACK de l'abonnement, ce qui fait échouer la connexion elle-même.
   */
  maxAttempts?: number
}

/**
 * SQLSTATE dont le réessai ne changera JAMAIS rien.
 *
 *   42 schéma ou privilèges (colonne/table inconnue, droit manquant)
 *   3F / 3D  schéma ou catalogue inexistant
 *   22 donnée invalide · 23 contrainte violée · 28 authentification refusée
 *
 * À l'inverse, on réessaie indéfiniment sur 08 (connexion), 40 (sérialisation,
 * verrou mortel), 53 (ressources), 57/58 (arrêt administrateur) : la base
 * revient, et le broker garde la suite dans la session.
 */
const SQLSTATE_DEFINITIF = ['42', '3F', '3D', '22', '23', '28']

function erreurDefinitive(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null
  const code = String((err as { code: unknown }).code)
  return SQLSTATE_DEFINITIF.includes(code.slice(0, 2)) ? code : null
}

/**
 * =========================================================================
 *  TRANSPORT MQTT — broker flespi (mqtt.flespi.io)
 * =========================================================================
 *
 * Défauts corrigés par rapport à la version précédente :
 *
 *  ✗ Contre-pression par `unsubscribe()`. Sur une session persistante, se
 *    désabonner SUPPRIME l'abonnement côté broker : tout message publié
 *    pendant la suspension était PERDU — exactement pendant une rafale.
 *  ✓ Contre-pression native MQTT 5 : `receiveMaximum`. Le broker ne dépasse
 *    jamais ce nombre de messages en vol ; le reste attend dans la session.
 *
 *  ✗ `clientId = sisbm-ingest-${pid}` : un nouvel identifiant à chaque
 *    démarrage, donc une NOUVELLE session. Les messages retenus pendant
 *    l'arrêt restaient dans l'ancienne session, jamais relue.
 *  ✓ `clientId` stable (config). Plusieurs workers ⇒ un clientId chacun +
 *    souscription partagée `$share/<groupe>/…`.
 *
 *  ✗ En cas d'échec de traitement, le message n'était pas acquitté puis on
 *    passait au suivant : il ne revenait qu'à la reconnexion suivante, et
 *    une base en panne remplissait silencieusement la fenêtre d'envoi.
 *  ✓ On RÉESSAIE le même message (backoff 1 s → 30 s) sans l'acquitter. Le
 *    flux s'arrête proprement, le broker retient la suite dans la session :
 *    une base lente ou en panne provoque un retard, jamais une perte.
 *
 * Point clé de MQTT.js 5 : `handleMessage` est appelé SÉQUENTIELLEMENT — le
 * paquet suivant n'est lu qu'une fois le callback du précédent invoqué, et le
 * PUBACK part dans ce callback. Toute « fenêtre de regroupement » qui retient
 * le callback ne regroupe donc rien : elle ajoute seulement sa durée à
 * chaque message (300 ms ⇒ 3 messages/s maximum). Le traitement est donc
 * immédiat, message par message.
 */
export class MqttTelemetryTransport implements TelemetryTransport {
  #client: MqttClient | null = null
  #arretDemande = false
  #enCours = 0
  #recus = 0
  #panne: ((err: Error) => void) | null = null

  constructor(private readonly config: MqttTransportConfig) {}

  get isConnected(): boolean {
    return this.#client?.connected ?? false
  }

  get inFlight(): number {
    return this.#enCours
  }

  get received(): number {
    return this.#recus
  }

  /** Topics effectivement souscrits (avec préfixe de partage éventuel). */
  get subscriptions(): string[] {
    const g = this.config.shareGroup?.trim()
    return this.config.topics.map((t) => (g ? `$share/${g}/${t}` : t))
  }

  /**
   * @param onFatal Appelé quand un message est définitivement intraitable
   *   (schéma de base incompatible, privilèges manquants) ou que les tentatives
   *   sont épuisées. Le message n'est PAS acquitté : il reste dans la session
   *   du broker et sera rejoué après correction. L'appelant doit arrêter le
   *   worker — continuer reviendrait à perdre silencieusement la télémétrie.
   */
  async subscribe(
    handler: (raw: string, topic: string) => Promise<void>,
    onFatal?: (err: Error) => void
  ): Promise<void> {
    this.#panne = onFatal ?? null
    const url = `${this.config.tls ? 'mqtts' : 'mqtt'}://${this.config.host}:${this.config.port}`

    const options: IClientOptions = {
      clientId: this.config.clientId,
      username: this.config.username,
      password: this.config.password,
      protocolVersion: 5,
      clean: false, // session persistante : le broker retient pendant une coupure
      reconnectPeriod: this.config.reconnectPeriodMs,
      connectTimeout: this.config.connectTimeoutMs,
      resubscribe: true,
      keepalive: 60,
      properties: {
        sessionExpiryInterval: this.config.sessionExpirySeconds,
        receiveMaximum: Math.max(1, Math.min(this.config.receiveMaximum, 65535)),
      },
    }

    await new Promise<void>((resolve, reject) => {
      let premiereConnexion = true
      const client = mqtt.connect(url, options)
      this.#client = client

      client.handleMessage = (packet: IPublishPacket, done: (e?: Error) => void) => {
        if (this.#arretDemande) return // ni traitement ni acquittement : rejoué à la reprise
        this.#recus += 1
        const raw = packet.payload.toString('utf8')
        void this.traiter(handler, packet.topic, raw, done)
      }

      client.on('connect', (connack) => {
        logger.info(
          {
            url,
            clientId: this.config.clientId,
            sessionPresent: connack.sessionPresent,
            topics: this.subscriptions,
          },
          '[mqtt] connecté au broker'
        )
        // Reconnexion : MQTT.js (`resubscribe: true`) rétablit lui-même les
        // abonnements si la session n'a pas été retrouvée.
        if (!premiereConnexion) return
        client.subscribe(this.subscriptions, { qos: this.config.qos }, (err, granted) => {
          if (err) {
            logger.error({ err }, '[mqtt] abonnement refusé')
            if (premiereConnexion) reject(err)
            return
          }
          // flespi répond 0x87 (not authorized) si le jeton n'a pas les droits ACL.
          const refuses = (granted ?? []).filter((g) => g.qos > 2)
          if (refuses.length) {
            const e = new Error(
              `[mqtt] abonnement refusé par le broker : ${refuses.map((r) => r.topic).join(', ')} (ACL du jeton ?)`
            )
            logger.error(e.message)
            if (premiereConnexion) return reject(e)
          }
          if (premiereConnexion) {
            premiereConnexion = false
            resolve()
          }
        })
      })

      client.on('reconnect', () => logger.warn('[mqtt] reconnexion en cours'))
      client.on('offline', () => logger.warn('[mqtt] hors ligne'))
      client.on('error', (err) => {
        logger.error({ err: err.message }, '[mqtt] erreur de transport')
        // Jeton invalide, hôte injoignable… au premier démarrage : on échoue franchement.
        if (premiereConnexion) {
          client.end(true)
          reject(err)
        }
      })

      setTimeout(() => {
        if (premiereConnexion) {
          client.end(true)
          reject(new Error(`[mqtt] délai de connexion dépassé vers ${url}`))
        }
      }, this.config.connectTimeoutMs + 5000).unref?.()
    })
  }

  /**
   * Traite un message jusqu'au succès (ou jusqu'à l'arrêt), PUIS l'acquitte.
   * Le handler doit lever une exception pour une erreur TRANSITOIRE (base
   * indisponible) et rendre la main normalement pour une trame définitivement
   * inexploitable (déjà journalisée par lui) — sinon elle bloquerait le flux.
   */
  private async traiter(
    handler: (raw: string, topic: string) => Promise<void>,
    topic: string,
    raw: string,
    done: (e?: Error) => void
  ): Promise<void> {
    this.#enCours += 1
    let attente = 1000
    const maxEssais = Math.max(1, this.config.maxAttempts ?? 20)
    try {
      for (let essai = 1; ; essai += 1) {
        try {
          await handler(raw, topic)
          done() // PUBACK après COMMIT
          return
        } catch (err) {
          if (this.#arretDemande) {
            logger.warn(
              { topic },
              '[mqtt] arrêt pendant un réessai — message non acquitté, sera rejoué'
            )
            return
          }

          /**
           * Erreur définitive, ou tentatives épuisées : on cesse de boucler.
           *
           * Réessayer indéfiniment sur une colonne manquante gèle le pipeline
           * MQTT (séquentiel) : plus aucun message n'est lu, le SUBACK n'est
           * plus traité et le broker finit par fermer la connexion. Le symptôme
           * observé — « abonnement refusé : Connection closed » suivi d'un
           * délai de connexion dépassé — a pour cause ce gel, pas le réseau.
           */
          const sqlstate = erreurDefinitive(err)
          if (sqlstate || essai >= maxEssais) {
            const motif = sqlstate
              ? `erreur définitive de la base (SQLSTATE ${sqlstate})`
              : `${maxEssais} tentatives épuisées`
            logger.fatal(
              { err, topic, essais: essai, sqlstate },
              `[mqtt] ingestion interrompue : ${motif}. Message NON acquitté — ` +
                'il sera rejoué après correction. Vérifier les migrations ' +
                '(node ace migration:status) et les droits de DB_USER.'
            )
            this.#arretDemande = true
            this.#panne?.(err instanceof Error ? err : new Error(String(err)))
            return
          }

          logger.error(
            { err, topic, essai, maxEssais, prochainEssaiMs: attente },
            '[mqtt] échec de traitement — nouvel essai'
          )
          await new Promise((r) => setTimeout(r, attente))
          attente = Math.min(attente * 2, 30_000)
        }
      }
    } finally {
      this.#enCours -= 1
    }
  }

  /** Arrêt gracieux : on laisse le message en cours terminer sa transaction. */
  async disconnect(): Promise<void> {
    this.#arretDemande = true
    const client = this.#client
    if (!client) return

    logger.info({ enCours: this.#enCours }, '[mqtt] arrêt demandé')
    const echeance = Date.now() + 15_000
    while (this.#enCours > 0 && Date.now() < echeance) {
      await new Promise((r) => setTimeout(r, 100))
    }
    await new Promise<void>((resolve) => client.end(false, {}, () => resolve()))
    this.#client = null
    logger.info('[mqtt] déconnecté')
  }
}

/**
 * Transport en MÉMOIRE — pour les tests.
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

  /** Injecte une trame comme si elle venait du broker flespi. */
  async emit(raw: string, topic = 'flespi/message/gw/devices/1'): Promise<void> {
    if (!this.#handler) throw new Error('aucun abonnement actif')
    await this.#handler(raw, topic)
  }

  async disconnect(): Promise<void> {
    this.#connecte = false
    this.#handler = null
  }
}
