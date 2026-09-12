import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import DeviceModel from '#infrastructure/persistence/models/device_model'
import sisbmConfig from '#config/sisbm'
import { FlespiApiError } from '#infrastructure/gateways/flespi/flespi_client'
import { FlespiDeviceGateway } from '#infrastructure/gateways/flespi/flespi_device_gateway'
import {
  FlespiProvisioning,
  type ProvisionResult,
} from '#infrastructure/gateways/flespi/flespi_provisioning'
import { FlespiProtocolGateway } from '#infrastructure/gateways/flespi/flespi_protocol_gateway'
import { FlespiChannelGateway } from '#infrastructure/gateways/flespi/flespi_channel_gateway'
import { CachedDeviceResolver } from '#infrastructure/persistence/readers/device_resolver'
import {
  createDeviceValidator,
  updateDeviceValidator,
  assignDeviceValidator,
  listDevicesValidator,
  syncDeviceFlespiValidator,
} from '#presentation/http/validators/fleet/fleet_validators'
import { logQueryValidator } from '#presentation/http/validators/fleet/flespi_validators'
import { toFlespiSeconds } from '#presentation/http/support/flespi_time'
import { authorize } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'

/**
 * =========================================================================
 *  CRUD BOÎTIERS — avec synchronisation Flespi
 * =========================================================================
 *
 * Un boîtier existe à DEUX endroits : dans notre base et chez Flespi. Les deux
 * doivent rester alignés — un boîtier enregistré chez nous mais absent de
 * Flespi ne remontera jamais de position, et personne ne s'en apercevra avant
 * la première alerte manquée.
 *
 * L'ORDRE des opérations n'est pas indifférent :
 *   création    → Flespi d'abord, base ensuite  (si Flespi échoue, rien n'est créé)
 *   suppression → Flespi d'abord, base ensuite  (sinon device orphelin qui
 *                                                continue de facturer et de publier)
 *
 * Si l'écriture en base échoue APRÈS la création flespi, le device flespi est
 * supprimé (compensation) : on ne laisse pas d'orphelin.
 */
@inject()
export default class DeviceController {
  constructor(
    private readonly gateway: FlespiDeviceGateway,
    private readonly provisioning: FlespiProvisioning,
    private readonly channels: FlespiChannelGateway,
    private readonly catalogue: FlespiProtocolGateway,
    private readonly resolver: CachedDeviceResolver
  ) {}

  /**
   * Le cache ident → véhicule du worker d'ingestion doit être invalidé à
   * chaque montage/démontage/changement d'ident : sinon les positions sont
   * rattachées pendant 5 minutes à l'ancien véhicule.
   */
  private async invalider(device: { imei: string; flespiIdent: string | null }): Promise<void> {
    const resolver = this.resolver
    await Promise.all(
      [device.imei, device.flespiIdent]
        .filter((i): i is string => Boolean(i))
        .map((i) => resolver.invalidate(i))
    )
  }

  /** GET /api/v1/devices */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const {
      page = 1,
      perPage = 25,
      status,
      search,
      unassigned,
    } = await ctx.request.validateUsing(listDevicesValidator)
    const org = toExecutionContext(ctx).organizationId

    const query = DeviceModel.query()
      .where('organization_id', org)
      .whereNull('deleted_at')
      .orderBy('imei')

    if (status) query.where('status', status)
    if (search) query.whereILike('imei', `%${search}%`)

    // Boîtiers en stock, non montés : la question la plus fréquente en
    // exploitation avant une installation.
    if (unassigned) {
      query.whereNotExists((sub) =>
        sub
          .from('device_assignments as da')
          .whereRaw('da.device_id = devices.id')
          .whereRaw('upper_inf(da.period)')
      )
    }

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(resultat.toJSON())
  }

  /** GET /api/v1/devices/:id */
  async show(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const device = await this.trouver(ctx)
    if (!device) return this.introuvable(ctx)

    const affectation = await db.rawQuery(
      `SELECT v.id, v.registration, lower(da.period) AS installed_at
         FROM device_assignments da
         JOIN vehicles v ON v.id = da.vehicle_id
        WHERE da.device_id = :id AND upper_inf(da.period)
        LIMIT 1`,
      { id: ctx.params.id }
    )

    return ctx.response.ok({
      data: {
        ...device.serialize(),
        assignment: affectation.rows?.[0] ?? null,
      },
    })
  }

  /**
   * POST /api/v1/devices
   *
   * `syncFlespi: true` → crée (ou rattache) le device chez flespi sur le canal
   * `flespiChannelId` (défaut FLESPI_CHANNEL_ID), avec le type
   * `flespiDeviceType` (défaut « Micodus MV730 ») résolu dans le protocole du
   * canal, puis l'enregistre en base.
   *
   * Micodus : fournir `terminalId` (ID de l'étiquette) ou `flespiIdent`.
   * L'IMEI seul ne suffit pas — cf. flespi_ident.ts.
   */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const payload = await ctx.request.validateUsing(createDeviceValidator)
    const org = toExecutionContext(ctx).organizationId

    let provision: ProvisionResult | null = null
    let flespiDeviceId = payload.flespiDeviceId ?? null
    let flespiIdent = payload.flespiIdent ?? null
    let protocol = payload.protocol ?? null
    const channelId = payload.flespiChannelId ?? (sisbmConfig.flespi.channelId || null)

    if (payload.syncFlespi) {
      const prov = this.provisioning
      // Les erreurs de provisionnement (type/protocole, ident, doublon) sont
      // traduites en 4xx explicites par le gestionnaire d'exceptions.
      provision = await prov.provision({
        imei: payload.imei,
        model: payload.model,
        channelId: channelId ?? 0,
        deviceType:
          payload.flespiDeviceType ?? payload.flespiDeviceTypeId ?? sisbmConfig.flespi.deviceType,
        name: payload.name,
        terminalId: payload.terminalId,
        flespiIdent: payload.flespiIdent,
        phone: payload.simMsisdn ?? payload.simIccid ?? null,
        messagesTtl: sisbmConfig.flespi.deviceMessagesTtl,
        linkExisting: payload.linkExisting,
      })
      flespiDeviceId = provision.device.id
      flespiIdent = provision.ident
      protocol = provision.protocolName
    } else if (flespiDeviceId) {
      // Rattachement manuel à un device flespi existant : on vérifie qu'il existe.
      const existant = await this.gateway.get(flespiDeviceId)
      if (!existant) {
        return ctx.response.unprocessableEntity({
          error: {
            code: 'E_FLESPI_DEVICE_NOT_FOUND',
            message: `Aucun device flespi ${flespiDeviceId}`,
            details: {},
          },
        })
      }
      flespiIdent = existant.configuration.ident
    }

    try {
      const device = await DeviceModel.create({
        imei: payload.imei,
        serialNumber: payload.serialNumber ?? null,
        manufacturer: payload.manufacturer ?? 'micodus',
        model: payload.model,
        protocol,
        hasRelay: payload.hasRelay ?? false,
        simMsisdn: payload.simMsisdn ?? null,
        simIccid: payload.simIccid ?? null,
        simOperator: payload.simOperator ?? null,
        organizationId: org,
        flespiDeviceId,
        flespiChannelId: flespiDeviceId ? channelId : null,
        flespiIdent,
        status: payload.status ?? 'stock',
        notes: payload.notes ?? null,
      })
      await this.invalider(device)

      return ctx.response.created({
        data: device.serialize(),
        meta: provision
          ? {
              flespi: {
                deviceId: provision.device.id,
                ident: provision.ident,
                deviceType: provision.deviceTypeTitle,
                protocol: provision.protocolName,
                created: provision.created,
              },
            }
          : undefined,
      })
    } catch (err) {
      // Compensation : pas de device flespi orphelin si la base refuse (IMEI en double…).
      if (provision) await this.provisioning.rollback(provision)
      throw err
    }
  }

  /**
   * POST /api/v1/devices/:id/flespi/sync
   *
   * Rattache après coup un boîtier SISBM à flespi (créé en stock sans
   * `syncFlespi`, ou device flespi recréé). Mêmes garde-fous que la création.
   */
  async syncFlespi(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const payload = await ctx.request.validateUsing(syncDeviceFlespiValidator)
    const device = await this.trouver(ctx)
    if (!device) return this.introuvable(ctx)
    if (device.flespiDeviceId) {
      const existant = await this.gateway.get(device.flespiDeviceId).catch(() => null)
      if (existant) {
        return ctx.response.conflict({
          error: {
            code: 'E_ALREADY_LINKED',
            message: `Déjà rattaché au device flespi ${device.flespiDeviceId}`,
            details: { flespiDeviceId: device.flespiDeviceId },
          },
        })
      }
    }

    const channelId =
      payload.flespiChannelId ?? device.flespiChannelId ?? sisbmConfig.flespi.channelId
    const prov = this.provisioning
    const provision = await prov.provision({
      imei: device.imei,
      model: device.model,
      channelId,
      deviceType: payload.flespiDeviceType ?? sisbmConfig.flespi.deviceType,
      name: payload.name,
      terminalId: payload.terminalId,
      flespiIdent: payload.flespiIdent ?? device.flespiIdent,
      phone: device.simMsisdn ?? device.simIccid,
      messagesTtl: sisbmConfig.flespi.deviceMessagesTtl,
      linkExisting: payload.linkExisting,
    })

    try {
      const ancien = { imei: device.imei, flespiIdent: device.flespiIdent }
      device.merge({
        flespiDeviceId: provision.device.id,
        flespiChannelId: channelId,
        flespiIdent: provision.ident,
        protocol: provision.protocolName,
      })
      await device.save()
      await this.invalider(ancien)
      await this.invalider(device)
    } catch (err) {
      await prov.rollback(provision)
      throw err
    }

    return ctx.response.ok({
      data: device.serialize(),
      meta: {
        flespi: {
          deviceId: provision.device.id,
          ident: provision.ident,
          created: provision.created,
        },
      },
    })
  }

  /** PATCH /api/v1/devices/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const payload = await ctx.request.validateUsing(updateDeviceValidator)
    const device = await this.trouver(ctx)
    if (!device) return this.introuvable(ctx)

    const { name, flespiIdent, ...local } = payload
    const ancien = { imei: device.imei, flespiIdent: device.flespiIdent }

    /**
     * Répercussion chez flespi AVANT la base : nom, téléphone (requis pour les
     * commandes SMS) et ident. Si flespi refuse, rien n'est modifié chez nous.
     */
    const identChange = flespiIdent !== undefined && flespiIdent !== device.flespiIdent
    const phoneChange = local.simMsisdn !== undefined && local.simMsisdn !== device.simMsisdn
    if (device.flespiDeviceId && (name || identChange || phoneChange)) {
      await this.gateway.update(device.flespiDeviceId, {
        name,
        ident: identChange ? flespiIdent : undefined,
        phone: phoneChange ? local.simMsisdn : undefined,
      })
    }

    device.merge(local)
    if (flespiIdent !== undefined) device.flespiIdent = flespiIdent
    await device.save()
    if (identChange) {
      await this.invalider(ancien)
      await this.invalider(device)
    }
    return ctx.response.ok({ data: device.serialize() })
  }

  /**
   * DELETE /api/v1/devices/:id
   *
   * Flespi d'abord, base ensuite. Si Flespi échoue, le boîtier n'est pas
   * archivé chez nous et l'opération reste rejouable.
   */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const device = await this.trouver(ctx)
    if (!device) return this.introuvable(ctx)

    // Un boîtier encore monté ne se supprime pas : l'historique du véhicule
    // en dépend. Il faut le démonter explicitement d'abord.
    const monte = await db.rawQuery(
      `SELECT 1 FROM device_assignments WHERE device_id = :id AND upper_inf(period) LIMIT 1`,
      { id: ctx.params.id }
    )
    if (monte.rows?.length) {
      return ctx.response.conflict({
        error: {
          code: 'E_DEVICE_STILL_ASSIGNED',
          message: 'Démonter le boîtier de son véhicule avant de le supprimer',
          details: {},
        },
      })
    }

    if (device.flespiDeviceId) {
      try {
        await this.gateway.delete(device.flespiDeviceId)
      } catch (err) {
        // Déjà supprimé chez flespi : rien à compenser, on archive.
        const dejaAbsent = err instanceof FlespiApiError && err.notFound
        if (!dejaAbsent) {
          logger.error(
            { err, flespiDeviceId: device.flespiDeviceId },
            '[devices] suppression Flespi en échec'
          )
          return ctx.response.badGateway({
            error: {
              code: 'E_FLESPI_UNAVAILABLE',
              message:
                "Le boîtier n'a pas pu être supprimé chez Flespi. Il n'a pas été archivé " +
                'localement : relancer une fois le service rétabli.',
              details: { detail: (err as Error).message },
            },
          })
        }
      }
    }

    device.deletedAt = DateTime.now()
    device.status = 'decommissioned'
    await device.save()
    await this.invalider(device)
    return ctx.response.noContent()
  }

  /**
   * POST /api/v1/devices/:id/assignment — monter le boîtier sur un véhicule.
   *
   * L'affectation est DATÉE. Les contraintes CM-01/CM-02 (`EXCLUDE USING gist`)
   * garantissent en base qu'un boîtier n'est jamais sur deux véhicules à la
   * fois. En cas de chevauchement, PostgreSQL lève une `exclusion_violation`
   * traduite en 409 par le gestionnaire d'exceptions.
   */
  async assign(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const { vehicleId, installNotes } = await ctx.request.validateUsing(assignDeviceValidator)
    const contexte = toExecutionContext(ctx)

    await db.transaction(async (trx) => {
      await trx.rawQuery(
        `UPDATE device_assignments
            SET period = tstzrange(lower(period), now()), removed_by = :actor
          WHERE device_id = :device AND upper_inf(period)`,
        { device: ctx.params.id, actor: contexte.actorId ?? null } as never
      )
      await trx.rawQuery(
        `INSERT INTO device_assignments (device_id, vehicle_id, period, installed_by, install_notes)
         VALUES (:device, :vehicle, tstzrange(now(), NULL), :actor, :notes)`,
        {
          device: ctx.params.id,
          vehicle: vehicleId,
          actor: contexte.actorId ?? null,
          notes: installNotes ?? null,
        } as never
      )
      await trx.from('devices').where('id', ctx.params.id).update({ status: 'active' })
    })

    const device = await this.trouver(ctx)
    if (device) await this.invalider(device)
    return ctx.response.created({ data: { deviceId: ctx.params.id, vehicleId } })
  }

  /** DELETE /api/v1/devices/:id/assignment — démonter le boîtier. */
  async unassign(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const contexte = toExecutionContext(ctx)

    const r = await db.rawQuery(
      `UPDATE device_assignments
          SET period = tstzrange(lower(period), now()), removed_by = :actor
        WHERE device_id = :device AND upper_inf(period)
        RETURNING id`,
      { device: ctx.params.id, actor: contexte.actorId ?? null } as never
    )
    if (!r.rows?.length) {
      return ctx.response.notFound({
        error: { code: 'E_NOT_FOUND', message: 'Aucune affectation en cours', details: {} },
      })
    }
    const device = await this.trouver(ctx)
    if (device) await this.invalider(device)
    return ctx.response.noContent()
  }

  /**
   * GET /api/v1/devices/:id/telemetry — dernier message CHEZ FLESPI.
   *
   * Outil de DIAGNOSTIC : il interroge Flespi directement, pas notre base.
   * Il répond à la question « le boîtier émet-il, et est-ce nous qui perdons
   * les trames ? ». La source de vérité de l'historique reste `positions`.
   */
  async liveTelemetry(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const device = await this.trouverRattache(ctx)
    if (!device) return
    const message = await this.gateway.lastMessage(device.flespiDeviceId!)
    return ctx.response.ok({ data: { source: 'flespi', message } })
  }

  /** GET /api/v1/devices/:id/telemetry/history?from=&to=&count= */
  async liveHistory(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const device = await this.trouverRattache(ctx)
    if (!device) return

    const q = await ctx.request.validateUsing(logQueryValidator)
    const from = toFlespiSeconds(q.from)
    const to = toFlespiSeconds(q.to)
    if (from === undefined || to === undefined || from > to) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_VALIDATION',
          message: 'Paramètres « from » et « to » requis au format ISO 8601, from ≤ to',
          details: {},
        },
      })
    }

    const messages = await this.gateway.messages(device.flespiDeviceId!, {
      from,
      to,
      count: q.count ?? 1000,
    })
    return ctx.response.ok({ data: { source: 'flespi', count: messages.length, messages } })
  }

  /**
   * GET /api/v1/devices/:id/flespi — DIAGNOSTIC COMPLET du rattachement.
   *
   * Répond en un appel aux questions d'une mise en service :
   *   - le device existe-t-il chez flespi, avec quel ident et quel type ?
   *   - son protocole est-il celui du canal ? (sinon il ne recevra rien)
   *   - l'ident SISBM et l'ident flespi coïncident-ils ?
   *   - le boîtier est-il connecté, quand a-t-il émis pour la dernière fois ?
   *   - quelle est sa dernière position connue ?
   */
  async flespiStatus(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const device = await this.trouverRattache(ctx)
    if (!device) return

    const gw = this.gateway
    const flespi = await gw.get(device.flespiDeviceId!)
    if (!flespi) {
      return ctx.response.ok({
        data: {
          linked: false,
          problems: [
            `Le device flespi ${device.flespiDeviceId} n'existe plus : relancer POST /devices/${device.id}/flespi/sync`,
          ],
        },
      })
    }

    const protocoles = this.catalogue
    const telemetrie = await gw
      .telemetry(device.flespiDeviceId!)
      .catch(() => ({}) as Record<string, { value: unknown; ts: number }>)
    const canalId = device.flespiChannelId ?? sisbmConfig.flespi.channelId
    const canal = canalId ? await this.channels.get(canalId).catch(() => null) : null
    const type = await protocoles
      .deviceType(flespi.protocol_id, flespi.device_type_id)
      .catch(() => null)

    const t = (k: string) => telemetrie[k]?.value ?? null
    const derniereTrame = telemetrie['timestamp']?.value as number | undefined

    const problems: string[] = []
    if (canal && canal.protocol_id !== flespi.protocol_id) {
      problems.push(
        `Protocole du device (${flespi.protocol_id}) ≠ protocole du canal ${canal.id} (${canal.protocol_id}) : ` +
          'le device ne recevra aucun message. Recréer le device avec un type du protocole du canal.'
      )
    }
    if (device.flespiIdent && device.flespiIdent !== flespi.configuration.ident) {
      problems.push(
        `Ident SISBM (${device.flespiIdent}) ≠ ident flespi (${flespi.configuration.ident}) : ` +
          "l'ingestion ne saura pas rattacher les trames."
      )
    }
    if (!derniereTrame) {
      problems.push(
        'Aucune trame reçue. Vérifier : SIM active avec data, APN, serveur programmé sur ' +
          `${canal?.uri ?? "l'URI du canal"}, puis GET /api/v1/flespi/channels/${canalId}/idents.`
      )
    } else if (Date.now() / 1000 - derniereTrame > 3600) {
      problems.push(
        'Dernière trame il y a plus d’une heure : boîtier en veille, hors couverture ou éteint.'
      )
    }
    if (!flespi.configuration.phone) {
      problems.push(
        'Aucun numéro de SIM chez flespi : les commandes par SMS (repli hors GPRS) sont impossibles.'
      )
    }

    return ctx.response.ok({
      data: {
        linked: true,
        device: {
          id: flespi.id,
          name: flespi.name,
          ident: flespi.configuration.ident,
          phone: flespi.configuration.phone ?? null,
          enabled: flespi.enabled,
          deviceTypeId: flespi.device_type_id,
          deviceType: type?.title ?? null,
          protocolId: flespi.protocol_id,
          messagesTtl: flespi.messages_ttl,
        },
        channel: canal ? { id: canal.id, uri: canal.uri, protocolId: canal.protocol_id } : null,
        lastMessageAt: derniereTrame ? new Date(derniereTrame * 1000).toISOString() : null,
        position: {
          latitude: t('position.latitude'),
          longitude: t('position.longitude'),
          speed: t('position.speed'),
          valid: t('position.valid'),
          satellites: t('position.satellites'),
        },
        ignition: t('engine.ignition.status'),
        batteryLevel: t('battery.level'),
        gsmSignal: t('gsm.signal.level'),
        problems,
      },
    })
  }

  /** GET /api/v1/devices/:id/flespi/logs?from=&to=&count= — connexions, erreurs de décodage, modifications. */
  async flespiLogs(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const device = await this.trouverRattache(ctx)
    if (!device) return
    const q = await ctx.request.validateUsing(logQueryValidator)
    const logs = await this.gateway.logs(device.flespiDeviceId!, {
      from: toFlespiSeconds(q.from),
      to: toFlespiSeconds(q.to),
      count: q.count,
    })
    return ctx.response.ok({ data: logs })
  }

  /** GET /api/v1/devices/:id/flespi/telemetry — dernière valeur de chaque paramètre. */
  async flespiTelemetry(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const device = await this.trouverRattache(ctx)
    if (!device) return
    return ctx.response.ok({ data: await this.gateway.telemetry(device.flespiDeviceId!) })
  }

  /** Boîtier de l'organisation ET rattaché à flespi ; sinon répond (404 / 409) et renvoie null. */
  private async trouverRattache(ctx: HttpContext): Promise<DeviceModel | null> {
    const device = await this.trouver(ctx)
    if (!device) {
      this.introuvable(ctx)
      return null
    }
    if (!device.flespiDeviceId) {
      ctx.response.conflict({
        error: {
          code: 'E_NO_FLESPI_DEVICE',
          message: "Ce boîtier n'est pas rattaché à Flespi (POST /devices/:id/flespi/sync)",
          details: {},
        },
      })
      return null
    }
    return device
  }

  // -------------------------------------------------------------------------

  private async trouver(ctx: HttpContext): Promise<DeviceModel | null> {
    const org = toExecutionContext(ctx).organizationId
    return DeviceModel.query()
      .where('id', ctx.params.id)
      .where('organization_id', org)
      .whereNull('deleted_at')
      .first()
  }

  private introuvable(ctx: HttpContext) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: 'Boîtier introuvable', details: {} },
    })
  }
}
