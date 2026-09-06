import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import VehicleModel from '#infrastructure/persistence/models/vehicle_model'
import {
  createVehicleValidator,
  updateVehicleValidator,
  listVehiclesValidator,
} from '#presentation/http/validators/fleet/fleet_validators'
import { authorize } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'

/**
 * =========================================================================
 *  CRUD FLOTTE — style PRAGMATIQUE
 * =========================================================================
 *
 * Contrôleur → Lucid, sans agrégat ni cas d'usage. Il n'y a ici aucune
 * invariant complexe à protéger : les règles structurelles sont déjà tenues
 * par la base (contraintes EXCLUDE sur les affectations, unicité de
 * l'immatriculation, CHECK sur les statuts).
 *
 * C'est la calibration décidée au Jalon 1 : profondeur des couches
 * proportionnelle à la richesse du domaine. Ajouter quatre fichiers pour un
 * `GET /vehicles` serait de la cérémonie.
 */
export default class VehicleController {
  /** GET /api/v1/vehicles */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const {
      page = 1,
      perPage = 25,
      search,
      status,
    } = await ctx.request.validateUsing(listVehiclesValidator)
    const org = toExecutionContext(ctx).organizationId

    const query = VehicleModel.query()
      .where('organization_id', org)
      .whereNull('deleted_at')
      .orderBy('registration')

    if (status) query.where('status', status)
    // pg_trgm est installé (migration 001) : la recherche floue sur
    // l'immatriculation reste indexée.
    if (search) query.whereILike('registration', `%${search}%`)

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(resultat.toJSON())
  }

  /** GET /api/v1/vehicles/:id */
  async show(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const org = toExecutionContext(ctx).organizationId

    const vehicule = await VehicleModel.query()
      .where('id', ctx.params.id)
      .where('organization_id', org)
      .whereNull('deleted_at')
      .first()

    if (!vehicule) return this.introuvable(ctx, 'Véhicule')

    // Boîtier actuellement monté + dernière position connue.
    const detail = await db.rawQuery(
      `SELECT d.id AS device_id, d.imei, d.model, d.has_relay,
              p.speed_kph, p.ignition, p.recorded_at, p.connection_state,
              ST_Y(p.location::geometry) AS latitude,
              ST_X(p.location::geometry) AS longitude
         FROM vehicles v
         LEFT JOIN device_assignments da ON da.vehicle_id = v.id AND upper_inf(da.period)
         LEFT JOIN devices d             ON d.id = da.device_id
         LEFT JOIN vehicle_last_positions p ON p.vehicle_id = v.id
        WHERE v.id = :id LIMIT 1`,
      { id: ctx.params.id }
    )
    const l = detail.rows?.[0] ?? {}

    return ctx.response.ok({
      data: {
        ...vehicule.serialize(),
        device: l.device_id
          ? { id: l.device_id, imei: l.imei, model: l.model, hasRelay: l.has_relay }
          : null,
        lastPosition: l.recorded_at
          ? {
              latitude: l.latitude,
              longitude: l.longitude,
              speedKph: l.speed_kph,
              ignition: l.ignition,
              recordedAt: l.recorded_at,
              connectionState: l.connection_state,
            }
          : null,
      },
    })
  }

  /** POST /api/v1/vehicles */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const payload = await ctx.request.validateUsing(createVehicleValidator)
    const org = toExecutionContext(ctx).organizationId

    const vehicule = await VehicleModel.create({
      ...payload,
      organizationId: org,
      status: payload.status ?? 'active',
      odometerKm: payload.odometerKm ?? 0,
      immobilizationEnabled: payload.immobilizationEnabled ?? false,
    })
    return ctx.response.created({ data: vehicule.serialize() })
  }

  /** PATCH /api/v1/vehicles/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const payload = await ctx.request.validateUsing(updateVehicleValidator)
    const org = toExecutionContext(ctx).organizationId

    const vehicule = await VehicleModel.query()
      .where('id', ctx.params.id)
      .where('organization_id', org)
      .whereNull('deleted_at')
      .first()
    if (!vehicule) return this.introuvable(ctx, 'Véhicule')

    vehicule.merge(payload)
    await vehicule.save()
    return ctx.response.ok({ data: vehicule.serialize() })
  }

  /**
   * DELETE /api/v1/vehicles/:id — suppression LOGIQUE.
   *
   * Le véhicule est référencé par des positions, des trajets et des alertes qui
   * doivent rester lisibles. Une suppression physique casserait l'historique.
   */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const org = toExecutionContext(ctx).organizationId

    const vehicule = await VehicleModel.query()
      .where('id', ctx.params.id)
      .where('organization_id', org)
      .whereNull('deleted_at')
      .first()
    if (!vehicule) return this.introuvable(ctx, 'Véhicule')

    vehicule.deletedAt = DateTime.now()
    vehicule.status = 'archived'
    await vehicule.save()
    return ctx.response.noContent()
  }

  private introuvable(ctx: HttpContext, ressource: string) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: `${ressource} introuvable`, details: {} },
    })
  }
}
