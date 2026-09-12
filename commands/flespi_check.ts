import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * =========================================================================
 *  node ace sisbm:flespi:check — diagnostic de l'intégration flespi
 * =========================================================================
 *
 * Vérifie, dans l'ordre où une erreur bloque tout ce qui suit :
 *   1. jeton REST valide
 *   2. canal FLESPI_CHANNEL_ID existant, protocole attendu, URI à programmer
 *   3. type FLESPI_DEVICE_TYPE résolu DANS le protocole du canal (id numérique)
 *   4. chaque boîtier SISBM rattaché : device flespi existant, même protocole
 *      que le canal, même ident qu'en base, dernière trame
 *   5. idents qui émettent sur le canal sans device pour les écouter
 *
 * Code de sortie ≠ 0 si un problème bloquant est détecté : utilisable en CI
 * ou avant une mise en production.
 */
export default class FlespiCheck extends BaseCommand {
  static commandName = 'sisbm:flespi:check'
  static description = 'Diagnostique la configuration flespi (canal, type, boîtiers, idents)'
  static options: CommandOptions = { startApp: true }

  async run() {
    const { default: sisbmConfig } = await import('#config/sisbm')
    const { FlespiChannelGateway } =
      await import('#infrastructure/gateways/flespi/flespi_channel_gateway')
    const { FlespiDeviceGateway } =
      await import('#infrastructure/gateways/flespi/flespi_device_gateway')
    const { FlespiProtocolGateway } =
      await import('#infrastructure/gateways/flespi/flespi_protocol_gateway')
    const { default: DeviceModel } = await import('#infrastructure/persistence/models/device_model')

    const f = sisbmConfig.flespi

    // config/sisbm.ts antérieur au jalon 2 : ces clés n'existaient pas.
    if (!f.protocolName || !f.deviceType || f.mqttToken === undefined) {
      this.logger.error(
        'config/sisbm.ts n’est pas à jour (protocolName / deviceType / mqttToken absents). ' +
          'Reprendre config/sisbm.ts et start/env.ts de la livraison du jalon 2.'
      )
      this.exitCode = 1
      return
    }

    const channels = await this.app.container.make(FlespiChannelGateway)
    const devices = await this.app.container.make(FlespiDeviceGateway)
    const protocols = await this.app.container.make(FlespiProtocolGateway)
    let bloquant = false
    const ko = (m: string) => {
      bloquant = true
      this.logger.error(m)
    }

    // ---- 1. jeton
    const sante = await devices.healthcheck()
    if (!sante.ok) {
      ko(`jeton flespi refusé ou API injoignable : ${sante.detail}`)
      this.exitCode = 1
      return
    }
    this.logger.success('jeton REST valide')
    if (!process.env.FLESPI_MQTT_TOKEN) {
      this.logger.warning(
        'FLESPI_MQTT_TOKEN absent : le worker MQTT utilise le jeton REST (droits complets). ' +
          'Créer un jeton dédié limité par ACL à flespi/message/gw/devices/#.'
      )
    }

    // ---- 2. canal
    if (!f.channelId) {
      ko('FLESPI_CHANNEL_ID non renseigné (POST /api/v1/flespi/channels pour en créer un)')
      this.exitCode = 1
      return
    }
    const canal = await channels.get(f.channelId)
    if (!canal) {
      ko(`canal ${f.channelId} introuvable chez flespi`)
      this.exitCode = 1
      return
    }
    const protocole = await protocols.protocol(canal.protocol_id)
    this.logger.success(
      `canal ${canal.id} « ${canal.name} » : protocole ${protocole?.name ?? canal.protocol_id} ` +
        `(id ${canal.protocol_id}), ${canal.enabled ? 'actif' : 'DÉSACTIVÉ'}`
    )
    this.logger.info(`   adresse à programmer dans les boîtiers : ${canal.uri}`)
    if (!canal.enabled) ko('le canal est désactivé : aucun boîtier ne peut s’y connecter')
    if (protocole && protocole.name !== f.protocolName) {
      this.logger.warning(
        `protocole du canal (${protocole.name}) ≠ FLESPI_PROTOCOL_NAME (${f.protocolName})`
      )
    }

    // ---- 3. type de boîtier
    const type = await protocols.resolveDeviceType(canal.protocol_id, f.deviceType)
    if (!type) {
      const liste = await protocols.deviceTypes(canal.protocol_id)
      ko(
        `type « ${f.deviceType} » absent du protocole ${protocole?.name}. Disponibles : ` +
          liste
            .slice(0, 30)
            .map((t) => `${t.id}=${t.title}`)
            .join(', ')
      )
    } else {
      this.logger.success(`type de boîtier : ${type.title} (device_type_id ${type.id})`)
    }

    // ---- 4. boîtiers SISBM
    const locaux = await DeviceModel.query()
      .whereNull('deleted_at')
      .whereNotNull('flespi_device_id')
    this.logger.info(`${locaux.length} boîtier(s) SISBM rattaché(s) à flespi`)
    for (const d of locaux) {
      const dist = await devices.get(d.flespiDeviceId!).catch(() => null)
      const nom = `${d.imei} (flespi ${d.flespiDeviceId})`
      if (!dist) {
        ko(
          `${nom} : le device flespi ${d.flespiDeviceId} n'existe pas dans ce compte flespi ` +
            '(id de test ou device supprimé). Détacher puis rattacher : ' +
            `UPDATE devices SET flespi_device_id = NULL, flespi_channel_id = NULL, flespi_ident = NULL ` +
            `WHERE id = '${d.id}'; puis POST /api/v1/devices/${d.id}/flespi/sync`
        )
        continue
      }
      if (dist.protocol_id !== canal.protocol_id) {
        ko(
          `${nom} : protocole ${dist.protocol_id} ≠ canal ${canal.protocol_id} (type ${dist.device_type_id}) ` +
            '— ne recevra AUCUN message. Recréer avec le bon type.'
        )
        continue
      }
      if (d.flespiIdent !== dist.configuration.ident) {
        ko(`${nom} : ident SISBM ${d.flespiIdent} ≠ ident flespi ${dist.configuration.ident}`)
        continue
      }
      const dernier = await devices.lastMessage(dist.id).catch(() => null)
      const ts = dernier?.timestamp
      if (ts) {
        this.logger.success(`${nom} : dernière trame ${new Date(ts * 1000).toISOString()}`)
      } else {
        this.logger.warning(
          `${nom} : aucune trame reçue à ce jour (ident ${dist.configuration.ident})`
        )
      }
    }

    // ---- 5. idents orphelins sur le canal
    const vus = await channels.seenIdents(canal.id).catch(() => [])
    for (const v of vus) {
      const dist = await devices.findByIdent(v.ident).catch(() => null)
      if (!dist) {
        this.logger.warning(
          `ident ${v.ident} émet sur le canal (${v.source}) sans device flespi : ` +
            'POST /api/v1/devices avec flespiIdent=' +
            v.ident
        )
      }
    }

    if (bloquant) {
      this.logger.error('problème(s) bloquant(s) détecté(s)')
      this.exitCode = 1
    } else {
      this.logger.success('intégration flespi opérationnelle')
    }
  }
}
