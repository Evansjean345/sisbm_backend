import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import DeviceModel from '#infrastructure/persistence/models/device_model'
import { FlespiDeviceGateway } from '#infrastructure/gateways/flespi/flespi_device_gateway'
import {
  createDeviceValidator,
  updateDeviceValidator,
  assignDeviceValidator,
  listDevicesValidator,
} from '#presentation/http/validators/fleet/fleet_validators'
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
 */
export default class DeviceController {
  private gateway(): FlespiDeviceGateway {
    return app.container.make(FlespiDeviceGateway) as unknown as FlespiDeviceGateway
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
   * Crée le boîtier chez Flespi puis chez nous. Si `syncFlespi` est faux ou si
   * `flespiChannelId` est absent, on enregistre seulement en base : utile pour
   * préparer un parc avant d'avoir le canal Flespi.
   */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const payload = await ctx.request.validateUsing(createDeviceValidator)
    const org = toExecutionContext(ctx).organizationId

    let flespiDeviceId = payload.flespiDeviceId ?? null

    if (payload.syncFlespi && payload.flespiChannelId) {
      try {
        const cree = await this.gateway().create({
          imei: payload.imei,
          channelId: payload.flespiChannelId,
          deviceTypeId: payload.flespiDeviceTypeId ?? 'Micodus MV730',
        })
        flespiDeviceId = cree.id
      } catch (err) {
        logger.error({ err, imei: payload.imei }, '[devices] création Flespi en échec')
        return ctx.response.badGateway({
          error: {
            code: 'E_FLESPI_UNAVAILABLE',
            message:
              "Le boîtier n'a pas pu être créé chez Flespi. Rien n'a été enregistré : " +
              "relancer l'opération une fois le service rétabli.",
            details: { detail: (err as Error).message },
          },
        })
      }
    }

    const device = await DeviceModel.create({
      imei: payload.imei,
      serialNumber: payload.serialNumber ?? null,
      manufacturer: payload.manufacturer ?? 'micodus',
      model: payload.model,
      protocol: payload.protocol ?? null,
      hasRelay: payload.hasRelay ?? false,
      simMsisdn: payload.simMsisdn ?? null,
      simIccid: payload.simIccid ?? null,
      simOperator: payload.simOperator ?? null,
      organizationId: org,
      flespiDeviceId,
      flespiChannelId: payload.flespiChannelId ?? null,
      // Convention Micodus : Flespi exige un `0` devant l'IMEI.
      flespiIdent: FlespiDeviceGateway.toFlespiIdent(payload.imei),
      status: payload.status ?? 'stock',
      notes: payload.notes ?? null,
    })

    return ctx.response.created({ data: device.serialize() })
  }

  /** PATCH /api/v1/devices/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const payload = await ctx.request.validateUsing(updateDeviceValidator)
    const device = await this.trouver(ctx)
    if (!device) return this.introuvable(ctx)

    device.merge(payload)
    await device.save()
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
        await this.gateway().delete(device.flespiDeviceId)
      } catch (err) {
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

    device.deletedAt = DateTime.now()
    device.status = 'decommissioned'
    await device.save()
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
    const device = await this.trouver(ctx)
    if (!device) return this.introuvable(ctx)
    if (!device.flespiDeviceId) {
      return ctx.response.conflict({
        error: {
          code: 'E_NO_FLESPI_DEVICE',
          message: "Ce boîtier n'est pas rattaché à Flespi",
          details: {},
        },
      })
    }

    const message = await this.gateway().lastMessage(device.flespiDeviceId)
    return ctx.response.ok({ data: { source: 'flespi', message } })
  }

  /** GET /api/v1/devices/:id/telemetry/history?from=&to= */
  async liveHistory(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const device = await this.trouver(ctx)
    if (!device?.flespiDeviceId) return this.introuvable(ctx)

    const from = new Date(String(ctx.request.input('from')))
    const to = new Date(String(ctx.request.input('to')))
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_VALIDATION',
          message: 'Paramètres « from » et « to » requis au format ISO 8601',
          details: {},
        },
      })
    }

    const messages = await this.gateway().messages({
      flespiDeviceId: device.flespiDeviceId,
      from,
      to,
    })
    return ctx.response.ok({ data: { source: 'flespi', count: messages.length, messages } })
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
