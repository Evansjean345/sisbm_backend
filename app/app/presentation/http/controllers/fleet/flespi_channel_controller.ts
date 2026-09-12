import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import DeviceModel from '#infrastructure/persistence/models/device_model'
import sisbmConfig from '#config/sisbm'
import { FlespiChannelGateway } from '#infrastructure/gateways/flespi/flespi_channel_gateway'
import { FlespiDeviceGateway } from '#infrastructure/gateways/flespi/flespi_device_gateway'
import { FlespiProtocolGateway } from '#infrastructure/gateways/flespi/flespi_protocol_gateway'
import {
  channelMessagesValidator,
  createChannelValidator,
  logQueryValidator,
  updateChannelValidator,
} from '#presentation/http/validators/fleet/flespi_validators'
import { authorize } from '#presentation/http/support/authorize'
import { toFlespiSeconds } from '#presentation/http/support/flespi_time'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import env from '#start/env'

/**
 * =========================================================================
 *  CANAUX FLESPI — administration du point d'entrée des boîtiers
 * =========================================================================
 *
 * Un canal = un `hôte:port` qui décode UN protocole. Pour la flotte MV730,
 * un seul canal `micodus` suffit ; son `uri` est l'adresse à programmer
 * dans chaque boîtier (commande SMS SERVER du MV730).
 *
 * Toutes ces routes relaient flespi : aucune donnée n'est stockée côté SISBM,
 * hormis `FLESPI_CHANNEL_ID` dans la configuration.
 */
@inject()
export default class FlespiChannelController {
  constructor(
    private readonly channels: FlespiChannelGateway,
    private readonly devices: FlespiDeviceGateway,
    private readonly catalogue: FlespiProtocolGateway
  ) {}

  // ------------------------------------------------------------- santé
  /** GET /api/v1/flespi/health — jeton valide ? canal configuré joignable ? */
  async health(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const api = await this.devices.healthcheck()

    let channel: unknown = null
    if (api.ok && sisbmConfig.flespi.channelId) {
      channel = await this.channels.get(sisbmConfig.flespi.channelId).catch(() => null)
    }

    return ctx.response.ok({
      data: {
        api,
        configuredChannelId: sisbmConfig.flespi.channelId || null,
        channel,
        protocolName: sisbmConfig.flespi.protocolName,
        deviceType: sisbmConfig.flespi.deviceType,
        mqtt: {
          host: sisbmConfig.flespi.mqttHost,
          port: sisbmConfig.flespi.mqttPort,
          topics: sisbmConfig.flespi.topics,
          dedicatedToken: Boolean(env.get('FLESPI_MQTT_TOKEN')),
        },
      },
    })
  }

  // ------------------------------------------------------------- catalogue
  /** GET /api/v1/flespi/protocols?search=micodus */
  async protocols(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const gw = this.catalogue
    const search = String(ctx.request.input('search', '')).toLowerCase()
    const liste = await gw.protocols()
    return ctx.response.ok({
      data: search
        ? liste.filter(
            (p) =>
              p.name.toLowerCase().includes(search) ||
              (p.title ?? '').toLowerCase().includes(search)
          )
        : liste,
    })
  }

  /** GET /api/v1/flespi/protocols/:protocol/device-types?search=mv730 */
  async deviceTypes(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const gw = this.catalogue
    const protocole = await gw.protocol(ctx.params.protocol)
    if (!protocole) {
      return ctx.response.notFound({
        error: {
          code: 'E_NOT_FOUND',
          message: `Protocole flespi inconnu : ${ctx.params.protocol}`,
          details: {},
        },
      })
    }
    const search = String(ctx.request.input('search', '')).toLowerCase()
    const types = await gw.deviceTypes(protocole.id)
    return ctx.response.ok({
      data: {
        protocol: protocole,
        deviceTypes: search
          ? types.filter((t) => `${t.name} ${t.title}`.toLowerCase().includes(search))
          : types,
      },
    })
  }

  /** GET /api/v1/flespi/protocols/:protocol/device-types/:typeId — schéma complet (ident, commandes). */
  async deviceType(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const gw = this.catalogue
    const protocole = await gw.protocol(ctx.params.protocol)
    if (!protocole) return this.introuvable(ctx, 'Protocole flespi inconnu')
    const type = await gw.resolveDeviceType(protocole.id, ctx.params.typeId)
    if (!type) return this.introuvable(ctx, `Type de boîtier absent du protocole ${protocole.name}`)
    return ctx.response.ok({ data: await gw.deviceType(protocole.id, type.id) })
  }

  // ------------------------------------------------------------- CRUD canal
  /** GET /api/v1/flespi/channels */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    return ctx.response.ok({ data: await this.channels.list() })
  }

  /**
   * POST /api/v1/flespi/channels
   * body : { name: "sisbm_channel", protocolName?: "micodus", messagesTtl?: 86400 }
   */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const p = await ctx.request.validateUsing(createChannelValidator)
    const canal = await this.channels.create({
      name: p.name,
      protocolId: p.protocolId,
      protocolName: p.protocolId ? undefined : (p.protocolName ?? sisbmConfig.flespi.protocolName),
      messagesTtl: p.messagesTtl,
      enabled: p.enabled,
    })

    const [hote, port] = canal.uri.split(':')
    return ctx.response.created({
      data: canal,
      meta: {
        nextSteps: [
          `Renseigner FLESPI_CHANNEL_ID=${canal.id} dans .env`,
          `Programmer chaque boîtier sur ${hote} port ${port} (TCP)`,
          'Brancher le boîtier puis lire GET /api/v1/flespi/channels/' + canal.id + '/idents',
          'Enregistrer le boîtier : POST /api/v1/devices avec syncFlespi=true',
        ],
      },
    })
  }

  /** GET /api/v1/flespi/channels/:id */
  async show(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const canal = await this.channels.get(Number(ctx.params.id))
    if (!canal) return this.introuvable(ctx, 'Canal flespi introuvable')
    return ctx.response.ok({ data: canal })
  }

  /** PATCH /api/v1/flespi/channels/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const p = await ctx.request.validateUsing(updateChannelValidator)
    const canal = await this.channels.update(Number(ctx.params.id), p)
    return ctx.response.ok({ data: canal })
  }

  /**
   * DELETE /api/v1/flespi/channels/:id
   *
   * Refusé pour le canal de production configuré : le supprimer déconnecte
   * instantanément TOUTE la flotte, et le nouveau canal aura un autre port —
   * il faudrait reprogrammer chaque boîtier par SMS.
   */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const id = Number(ctx.params.id)
    if (id === sisbmConfig.flespi.channelId && ctx.request.input('force') !== 'true') {
      return ctx.response.conflict({
        error: {
          code: 'E_CHANNEL_IN_USE',
          message:
            'Ce canal est le canal de production (FLESPI_CHANNEL_ID). Sa suppression ' +
            'déconnecte toute la flotte. Ajouter ?force=true pour confirmer.',
          details: { channelId: id },
        },
      })
    }
    await this.channels.delete(id)
    return ctx.response.noContent()
  }

  // ------------------------------------------------------------- diagnostic
  /** GET /api/v1/flespi/channels/:id/logs?from=&to=&count= */
  async logs(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const q = await ctx.request.validateUsing(logQueryValidator)
    const logs = await this.channels.logs(Number(ctx.params.id), {
      from: toFlespiSeconds(q.from),
      to: toFlespiSeconds(q.to),
      count: q.count,
    })
    return ctx.response.ok({ data: logs })
  }

  /** GET /api/v1/flespi/channels/:id/messages?currKey=0&limit=100 */
  async messages(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const q = await ctx.request.validateUsing(channelMessagesValidator)
    const r = await this.channels.messages(Number(ctx.params.id), {
      currKey: q.currKey,
      limitCount: q.limit,
    })
    return ctx.response.ok({
      data: r.messages,
      meta: { nextKey: r.nextKey, count: r.messages.length },
    })
  }

  /** GET /api/v1/flespi/channels/:id/connections — boîtiers connectés en ce moment. */
  async connections(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    return ctx.response.ok({
      data: await this.channels.connections(Number(ctx.params.id)),
    })
  }

  /**
   * GET /api/v1/flespi/channels/:id/idents
   *
   * Idents réellement émis par les boîtiers sur ce canal, croisés avec
   * l'enregistrement SISBM et flespi. Un ident `unregistered` est un boîtier
   * qui parle mais qu'aucun device n'écoute : c'est la valeur exacte à
   * passer dans `flespiIdent` lors de la création.
   */
  async idents(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const vus = await this.channels.seenIdents(Number(ctx.params.id))
    const devicesGw = this.devices
    const org = toExecutionContext(ctx).organizationId

    const locaux = vus.length
      ? await DeviceModel.query()
          .where('organization_id', org)
          .whereNull('deleted_at')
          .where((q) =>
            q
              .whereIn(
                'flespi_ident',
                vus.map((v) => v.ident)
              )
              .orWhereIn(
                'imei',
                vus.map((v) => v.ident)
              )
          )
      : []

    const data = await Promise.all(
      vus.map(async (v) => {
        const local = locaux.find((d) => d.flespiIdent === v.ident || d.imei === v.ident) ?? null
        const flespi = await devicesGw.findByIdent(v.ident).catch(() => null)
        return {
          ...v,
          lastSeenAt: v.lastSeen ? new Date(v.lastSeen * 1000).toISOString() : null,
          sisbmDeviceId: local?.id ?? null,
          flespiDeviceId: flespi?.id ?? null,
          flespiDeviceTypeId: flespi?.device_type_id ?? null,
          status: flespi ? (local ? 'registered' : 'flespi_only') : 'unregistered',
        }
      })
    )
    return ctx.response.ok({ data })
  }

  private introuvable(ctx: HttpContext, message: string) {
    return ctx.response.notFound({ error: { code: 'E_NOT_FOUND', message, details: {} } })
  }
}
