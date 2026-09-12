import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * =========================================================================
 *  node ace sisbm:flespi:watch — TEST EN DIRECT D'UN BOÎTIER RÉEL VIA MQTT
 * =========================================================================
 *
 * Se connecte au broker flespi et affiche, en temps réel, ce que le boîtier
 * envoie — AVANT toute écriture en base. C'est l'outil de la première mise
 * en service d'un MV730 :
 *
 *   # ce que reçoit le device flespi (ident et type corrects)
 *   node ace sisbm:flespi:watch --device=8958982
 *
 *   # ce que reçoit le CANAL, y compris d'un boîtier non encore enregistré
 *   # → révèle l'ident exact à déclarer
 *   node ace sisbm:flespi:watch --channel=1442013
 *
 *   # suivi des commandes (file, envoi, résultat) en plus des messages
 *   node ace sisbm:flespi:watch --device=8958982 --commands
 *
 *   # trame brute complète, tous paramètres flespi
 *   node ace sisbm:flespi:watch --device=8958982 --raw
 *
 * Session PROPRE (clean start) et clientId aléatoire : cet outil ne vole
 * jamais la session persistante du worker `sisbm:ingest`.
 */
export default class FlespiWatch extends BaseCommand {
  static commandName = 'sisbm:flespi:watch'
  static description = 'Affiche en direct les messages MQTT flespi d’un boîtier ou d’un canal'
  static options: CommandOptions = { startApp: true, staysAlive: true }

  @flags.number({ description: 'Id du device flespi' })
  declare device: number

  @flags.number({ description: 'Id du canal flespi (voit aussi les boîtiers non enregistrés)' })
  declare channel: number

  @flags.boolean({ description: 'Affiche aussi le cycle de vie des commandes' })
  declare commands: boolean

  @flags.boolean({ description: 'Affiche la trame JSON complète' })
  declare raw: boolean

  @flags.number({ description: 'Arrêt automatique après N secondes (0 = jamais)', default: 0 })
  declare duration: number

  async run() {
    const { default: sisbmConfig } = await import('#config/sisbm')
    const { default: mqtt } = await import('mqtt')
    const { FlespiFrameParser } =
      await import('#infrastructure/gateways/flespi/flespi_frame_parser')
    const { randomBytes } = await import('node:crypto')

    const f = sisbmConfig.flespi
    if (!f.mqttToken) {
      this.logger.error('FLESPI_MQTT_TOKEN (ou FLESPI_TOKEN) absent dans .env')
      this.exitCode = 1
      return this.terminate()
    }

    const cible = this.device ? String(this.device) : '+'
    const topics: string[] = []
    if (this.channel) {
      // Messages du canal : tous les boîtiers connectés, enregistrés ou non.
      topics.push(`flespi/message/gw/channels/${this.channel}/+`)
    }
    if (this.device || !this.channel) {
      topics.push(`flespi/message/gw/devices/${cible}`)
    }
    if (this.commands) {
      topics.push(`flespi/log/gw/devices/${cible}/commands-queue/#`)
    }

    const url = `${f.mqttTls ? 'mqtts' : 'mqtt'}://${f.mqttHost}:${f.mqttPort}`
    const client = mqtt.connect(url, {
      clientId: `sisbm-watch-${randomBytes(4).toString('hex')}`,
      username: f.mqttToken,
      password: '',
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 10_000,
    })

    const parser = new FlespiFrameParser()
    const vusCanal = new Set<string>()
    let n = 0

    client.on('connect', () => {
      this.logger.success(`connecté à ${url}`)
      client.subscribe(topics, { qos: 0 }, (err, granted) => {
        if (err) return this.logger.error(`abonnement refusé : ${err.message}`)
        for (const g of granted ?? []) {
          if (g.qos > 2) this.logger.error(`refusé par le broker (ACL du jeton ?) : ${g.topic}`)
          else this.logger.info(`abonné : ${g.topic}`)
        }
        this.logger.info('en attente de trames… (le MV730 émet selon son intervalle de suivi)')
      })
    })

    client.on('message', (topic, payload) => {
      n++
      const texte = payload.toString('utf8')
      const heure = new Date().toISOString().slice(11, 19)

      if (topic.startsWith('flespi/log/')) {
        this.logger.info(`${heure} [commande] ${topic.split('/').slice(-2).join(' → ')} ${texte}`)
        return
      }

      try {
        const [trame] = parser.parse(texte, topic)
        const brut = trame.raw as Record<string, unknown>
        this.logger.info(
          `${heure} ident=${trame.ident} device=${brut['device.id'] ?? '—'} ` +
            `${trame.recordedAt.toISOString()} ` +
            `pos=${trame.latitude.toFixed(6)},${trame.longitude.toFixed(6)} ` +
            `v=${trame.speedKph}km/h cap=${trame.headingDeg ?? '—'} sat=${trame.satellites ?? '—'} ` +
            `fix=${trame.isValidFix} ign=${trame.ignition ?? '—'} bat=${trame.batteryPct ?? '—'} ` +
            `gsm=${trame.gsmSignal ?? '—'}`
        )
        if (topic.includes('/channels/') && !vusCanal.has(trame.ident)) {
          vusCanal.add(trame.ident)
          this.logger.warning(
            `  ↳ ident émis sur le canal : « ${trame.ident} ». C'est la valeur EXACTE à déclarer ` +
              '(flespiIdent) — vérifier son rattachement : GET /api/v1/flespi/channels/:id/idents'
          )
        }
      } catch (err) {
        // Trame sans position (heartbeat, alarme, réponse de commande) : on l'affiche telle quelle.
        this.logger.info(`${heure} ${topic} (sans position : ${(err as Error).message})`)
      }
      if (this.raw) console.log(JSON.stringify(JSON.parse(texte), null, 2))
    })

    client.on('error', (err) => this.logger.error(`MQTT : ${err.message}`))

    const arreter = async () => {
      this.logger.info(`${n} message(s) reçu(s) — arrêt`)
      await new Promise<void>((r) => client.end(false, {}, () => r()))
      await this.terminate()
    }
    if (this.duration > 0) setTimeout(() => void arreter(), this.duration * 1000)
    process.on('SIGINT', () => void arreter())
    process.on('SIGTERM', () => void arreter())
  }
}
