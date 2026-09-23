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
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import {
  adminListVehiclesValidator,
  adminOrganizationFilterValidator,
  targetOrganizationValidator,
} from '#presentation/http/validators/admin/admin_validators'
import {
  PLATFORM_SCOPE,
  applyScope,
  authorizePlatform,
  countsBy,
  organizationsOf,
  ownScope,
  serializeWithOrganizations,
  type TenantScope,
} from '#presentation/http/support/platform_scope'

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
  /** GET /api/v1/vehicles — cloisonné à l'organisation de l'acteur. */
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
    return this.afficher(ctx, ownScope(ctx))
  }

  /** POST /api/v1/vehicles */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    return this.creer(ctx, toExecutionContext(ctx).organizationId)
  }

  /** PATCH /api/v1/vehicles/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    return this.modifier(ctx, ownScope(ctx))
  }

  /**
   * DELETE /api/v1/vehicles/:id — suppression LOGIQUE.
   *
   * Le véhicule est référencé par des positions, des trajets et des alertes qui
   * doivent rester lisibles. Une suppression physique casserait l'historique.
   */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    return this.archiver(ctx, ownScope(ctx))
  }

  // =========================================================================
  //  TABLEAU DE BORD ADMIN — toutes organisations (joker `*` exigé)
  // =========================================================================

  /** GET /api/v1/admin/vehicles ?organizationId=&status=&search=&page=&perPage= */
  async indexAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const {
      page = 1,
      perPage = 25,
      search,
      status,
      organizationId,
    } = await ctx.request.validateUsing(adminListVehiclesValidator)

    const query = VehicleModel.query().whereNull('deleted_at').orderBy('registration')
    if (organizationId) query.where('organization_id', organizationId)
    if (status) query.where('status', status)
    if (search) query.whereILike('registration', `%${search}%`)

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(await serializeWithOrganizations(resultat))
  }

  /**
   * GET /api/v1/admin/vehicles/stats?organizationId=
   *
   * Parc par statut, par organisation, et état de connexion issu de
   * `vehicle_last_positions` (online / idle / offline / never_seen).
   */
  async statsAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(adminOrganizationFilterValidator)

    // Colonnes qualifiées : la répartition par connexion joint `vehicle_last_positions`,
    // qui porte aussi `organization_id` (sinon « column reference is ambiguous »).
    const base = () => {
      const q = VehicleModel.query().whereNull('vehicles.deleted_at')
      if (organizationId) q.where('vehicles.organization_id', organizationId)
      return q
    }

    const [parStatut, parOrganisation, parConnexion, equipes] = await Promise.all([
      base().select('status').count('* as total').groupBy('status'),
      base().select('organization_id').count('* as total').groupBy('organization_id'),
      base()
        .joinRaw('LEFT JOIN vehicle_last_positions p ON p.vehicle_id = vehicles.id')
        .select(db.raw(`COALESCE(p.connection_state, 'never_seen') AS state`))
        .count('* as total')
        .groupByRaw(`COALESCE(p.connection_state, 'never_seen')`),
      base()
        .whereExists((sub) =>
          sub
            .from('device_assignments as da')
            .whereRaw('da.vehicle_id = vehicles.id')
            .whereRaw('upper_inf(da.period)')
        )
        .count('* as total')
        .first(),
    ])

    const compteurs = countsBy(parStatut, 'status')
    const organisations = await organizationsOf(parOrganisation.map((l) => l.organizationId))
    const total = Object.values(compteurs).reduce((a, b) => a + b, 0)
    const avecBoitier = Number(equipes?.$extras.total ?? 0)

    return ctx.response.ok({
      data: {
        total,
        withDevice: avecBoitier,
        withoutDevice: total - avecBoitier,
        byStatus: compteurs,
        byConnection: countsBy(parConnexion, 'state'),
        byOrganization: parOrganisation.map((l) => ({
          organization: organisations[l.organizationId] ?? { id: l.organizationId },
          total: Number(l.$extras.total ?? 0),
        })),
      },
    })
  }

  /** GET /api/v1/admin/vehicles/:id */
  async showAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.afficher(ctx, PLATFORM_SCOPE)
  }

  /** POST /api/v1/admin/vehicles — body : { organizationId, ...champs de POST /vehicles } */
  async storeAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(targetOrganizationValidator)

    const organisation = await OrganizationModel.query()
      .where('id', organizationId)
      .whereNull('deleted_at')
      .select('id')
      .first()
    if (!organisation) return this.introuvable(ctx, 'Organisation')

    return this.creer(ctx, organizationId)
  }

  /** PATCH /api/v1/admin/vehicles/:id */
  async updateAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.modifier(ctx, PLATFORM_SCOPE)
  }

  /** DELETE /api/v1/admin/vehicles/:id — suppression logique. */
  async destroyAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.archiver(ctx, PLATFORM_SCOPE)
  }

  // -------------------------------------------------------------------------
  //  Implémentations partagées client / admin : seul le périmètre change.
  // -------------------------------------------------------------------------

  private async afficher(ctx: HttpContext, scope: TenantScope) {
    const vehicule = await this.trouver(ctx, scope)
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
      { id: vehicule.id }
    )
    const l = detail.rows?.[0] ?? {}
    const organisations = await organizationsOf([vehicule.organizationId])

    return ctx.response.ok({
      data: {
        ...vehicule.serialize(),
        organization: organisations[vehicule.organizationId] ?? null,
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

  private async creer(ctx: HttpContext, organizationId: string) {
    const payload = await ctx.request.validateUsing(createVehicleValidator)

    const vehicule = await VehicleModel.create({
      ...payload,
      registration: `sisbm${payload.registration}`,
      organizationId,
      status: payload.status ?? 'active',
      odometerKm: payload.odometerKm ?? 0,
      immobilizationEnabled: payload.immobilizationEnabled ?? false,
    })
    return ctx.response.created({ data: vehicule.serialize() })
  }

  private async modifier(ctx: HttpContext, scope: TenantScope) {
    const payload = await ctx.request.validateUsing(updateVehicleValidator)
    const vehicule = await this.trouver(ctx, scope)
    if (!vehicule) return this.introuvable(ctx, 'Véhicule')

    vehicule.merge(payload)
    await vehicule.save()
    return ctx.response.ok({ data: vehicule.serialize() })
  }

  private async archiver(ctx: HttpContext, scope: TenantScope) {
    const vehicule = await this.trouver(ctx, scope)
    if (!vehicule) return this.introuvable(ctx, 'Véhicule')

    vehicule.deletedAt = DateTime.now()
    vehicule.status = 'archived'
    await vehicule.save()
    return ctx.response.noContent()
  }

  /** Cherché DANS le périmètre : un id d'un autre client donne 404, pas une fuite. */
  private trouver(ctx: HttpContext, scope: TenantScope): Promise<VehicleModel | null> {
    const query = VehicleModel.query().where('id', ctx.params.id).whereNull('deleted_at')
    return applyScope(query, scope).first()
  }

  private introuvable(ctx: HttpContext, ressource: string) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: `${ressource} introuvable`, details: {} },
    })
  }
}
