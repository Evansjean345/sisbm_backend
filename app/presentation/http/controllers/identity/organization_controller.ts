import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import RoleModel from '#infrastructure/persistence/models/role_model'
import UserModel from '#infrastructure/persistence/models/user_model'
import VehicleModel from '#infrastructure/persistence/models/vehicle_model'
import DeviceModel from '#infrastructure/persistence/models/device_model'
import DeviceCommandModel from '#infrastructure/persistence/models/device_command_model'
import { DateTime } from 'luxon'
import type { LucidModel, ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { authorizePlatform } from '#presentation/http/support/platform_scope'
import { adminActivityValidator } from '#presentation/http/validators/admin/admin_validators'
import { LucidActivityReader } from '#infrastructure/persistence/readers/activity_reader'
import { CreateOrganization } from '#application/identity/use_cases/create_organization'
import { CreateOrganizationUser } from '#application/identity/use_cases/create_organization_user'
import { missingPermissions } from '#domain/identity/role_policy'
import {
  createOrganizationValidator,
  listOrganizationsValidator,
  updateOrganizationValidator,
} from '#presentation/http/validators/identity/organization_validators'
import {
  createUserValidator,
  listUsersValidator,
} from '#presentation/http/validators/identity/user_validators'
import { authorize, permissionsOf } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'

/**
 * =========================================================================
 *  ORGANISATIONS — administration PLATEFORME
 * =========================================================================
 *
 * Deux styles cohabitent, conformément à la calibration du §3 (docs/03) :
 *
 *  - lectures et mise à jour simple : contrôleur → Lucid (pragmatique) ;
 *  - CRÉATIONS (organisation, comptes rattachés) : cas d'usage, parce
 *    qu'elles sont transactionnelles et portent la règle de non-escalade.
 *
 * Toutes les routes exigent `organization:*`, que seul le joker `*`
 * (super_admin) couvre. Un administrateur client continue de gérer SES
 * comptes par `/users`, cloisonné à sa propre organisation.
 */
@inject()
export default class OrganizationController {
  constructor(
    private readonly createOrganization: CreateOrganization,
    private readonly createOrganizationUser: CreateOrganizationUser,
    private readonly activity: LucidActivityReader
  ) {}

  /** GET /api/v1/organizations */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewOrganizations')
    const {
      page = 1,
      perPage = 25,
      search,
      isActive,
    } = await ctx.request.validateUsing(listOrganizationsValidator)

    const query = OrganizationModel.query().whereNull('deleted_at').orderBy('name')
    if (isActive !== undefined) query.where('is_active', isActive)
    if (search) {
      query.where((q) => q.whereILike('name', `%${search}%`).orWhereILike('code', `%${search}%`))
    }

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(resultat.toJSON())
  }

  /** GET /api/v1/organizations/:id */
  async show(ctx: HttpContext) {
    await authorize(ctx, 'viewOrganizations')
    const organisation = await this.trouver(ctx.params.id)
    if (!organisation) return this.introuvable(ctx)

    const [users, vehicles] = await Promise.all([
      UserModel.query()
        .where('organization_id', organisation.id)
        .whereNull('deleted_at')
        .count('* as total')
        .first(),
      VehicleModel.query()
        .where('organization_id', organisation.id)
        .whereNull('deleted_at')
        .count('* as total')
        .first(),
    ])

    return ctx.response.ok({
      data: {
        ...organisation.serialize(),
        stats: {
          users: Number(users?.$extras.total ?? 0),
          vehicles: Number(vehicles?.$extras.total ?? 0),
        },
      },
    })
  }

  /**
   * POST /api/v1/organizations
   *
   * Crée l'organisation et, si le bloc `admin` est fourni, son premier
   * administrateur — dans UNE transaction.
   */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageOrganizations')
    const payload = await ctx.request.validateUsing(createOrganizationValidator)

    const { admin, ...organization } = payload
    const result = await this.createOrganization.execute({
      context: toExecutionContext(ctx),
      actorPermissions: await permissionsOf(ctx),
      organization,
      admin,
    })

    if (!result.ok) {
      return ctx.response.status(result.error.httpStatus).send({ error: result.error.toJSON() })
    }
    return ctx.response.created({ data: result.value })
  }

  /** PATCH /api/v1/organizations/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageOrganizations')
    const payload = await ctx.request.validateUsing(updateOrganizationValidator)
    const organisation = await this.trouver(ctx.params.id)
    if (!organisation) return this.introuvable(ctx)

    // Garde-fou : l'exploitant ne peut pas désactiver SA propre organisation.
    // Il perdrait la main sur la plateforme sans autre moyen de la reprendre
    // qu'une intervention en base.
    if (payload.isActive === false && organisation.id === toExecutionContext(ctx).organizationId) {
      return ctx.response.conflict({
        error: {
          code: 'E_SELF_DEACTIVATION',
          message: 'Vous ne pouvez pas désactiver votre propre organisation',
          details: {},
        },
      })
    }

    organisation.merge(payload)
    await organisation.save()
    return ctx.response.ok({ data: organisation.serialize() })
  }

  /** GET /api/v1/organizations/:id/users */
  async users(ctx: HttpContext) {
    await authorize(ctx, 'viewOrganizations')
    const { page = 1, perPage = 25, status } = await ctx.request.validateUsing(listUsersValidator)
    const organisation = await this.trouver(ctx.params.id)
    if (!organisation) return this.introuvable(ctx)

    const query = UserModel.query()
      .where('organization_id', organisation.id)
      .whereNull('deleted_at')
      .orderBy('full_name')
    if (status) query.where('status', status)

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(resultat.toJSON())
  }

  /**
   * POST /api/v1/organizations/:id/users
   *
   * Rattache un compte à l'organisation désignée. Même cas d'usage que
   * `POST /users` : cloisonnement et non-escalade s'appliquent à l'identique.
   */
  async storeUser(ctx: HttpContext) {
    await authorize(ctx, 'manageOrganizations')
    const payload = await ctx.request.validateUsing(createUserValidator)

    const result = await this.createOrganizationUser.execute({
      context: toExecutionContext(ctx),
      actorPermissions: await permissionsOf(ctx),
      organizationId: ctx.params.id,
      user: payload,
    })

    if (!result.ok) {
      return ctx.response.status(result.error.httpStatus).send({ error: result.error.toJSON() })
    }
    return ctx.response.created({ data: result.value })
  }

  /**
   * GET /api/v1/organizations/:id/roles
   *
   * Rôles utilisables dans cette organisation (système + propres), avec le
   * drapeau `assignable` calculé par la MÊME règle que celle appliquée à
   * l'écriture : le formulaire ne propose que ce qui sera accepté.
   */
  async roles(ctx: HttpContext) {
    await authorize(ctx, 'viewOrganizations')
    const organisation = await this.trouver(ctx.params.id)
    if (!organisation) return this.introuvable(ctx)

    const granted = await permissionsOf(ctx)
    const lignes = await RoleModel.query()
      .where((q) => q.where('organization_id', organisation.id).orWhereNull('organization_id'))
      .orderBy('code')

    return ctx.response.ok({
      data: lignes.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        isSystem: role.isSystem,
        assignable:
          missingPermissions(granted, {
            id: role.id,
            code: role.code,
            organizationId: role.organizationId,
            permissions: role.permissions ?? [],
          }).length === 0,
      })),
    })
  }

  // =========================================================================
  //  TABLEAU DE BORD ADMIN
  // =========================================================================

  /**
   * GET /api/v1/admin/overview
   *
   * Les indicateurs de la page d'accueil du tableau de bord, en UN appel :
   * organisations, comptes, véhicules, boîtiers et commandes des dernières
   * 24 h. Le détail de chaque ressource est sur `/admin/<ressource>/stats`.
   */
  async overviewAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const depuis = DateTime.now().minus({ hours: 24 })

    const compter = async (q: ModelQueryBuilderContract<LucidModel>) => {
      const ligne = await q.count('* as total').first()
      return Number(ligne?.$extras.total ?? 0)
    }

    const [
      organisations,
      organisationsActives,
      utilisateurs,
      utilisateursActifs,
      vehicules,
      boitiers,
      boitiersRattaches,
      boitiersSilencieux,
      commandes24h,
      commandesEchouees24h,
      commandesEnVol,
    ] = await Promise.all([
      compter(OrganizationModel.query().whereNull('deleted_at')),
      compter(OrganizationModel.query().whereNull('deleted_at').where('is_active', true)),
      compter(UserModel.query().whereNull('deleted_at')),
      compter(UserModel.query().whereNull('deleted_at').where('status', 'active')),
      compter(VehicleModel.query().whereNull('deleted_at')),
      compter(DeviceModel.query().whereNull('deleted_at')),
      compter(DeviceModel.query().whereNull('deleted_at').whereNotNull('flespi_device_id')),
      compter(
        DeviceModel.query()
          .whereNull('deleted_at')
          .whereNot('status', 'decommissioned')
          .where((q) => q.whereNull('last_seen_at').orWhere('last_seen_at', '<', depuis.toSQL()!))
      ),
      compter(DeviceCommandModel.query().where('requested_at', '>=', depuis.toJSDate())),
      compter(
        DeviceCommandModel.query()
          .where('requested_at', '>=', depuis.toJSDate())
          .whereIn('status', ['failed', 'expired'])
      ),
      compter(
        DeviceCommandModel.query().whereIn('status', [
          'pending_validation',
          'approved',
          'queued',
          'sent',
        ])
      ),
    ])

    return ctx.response.ok({
      data: {
        organizations: { total: organisations, active: organisationsActives },
        users: { total: utilisateurs, active: utilisateursActifs },
        vehicles: { total: vehicules },
        devices: {
          total: boitiers,
          flespiLinked: boitiersRattaches,
          silentSince24h: boitiersSilencieux,
        },
        commands: {
          last24h: commandes24h,
          failedLast24h: commandesEchouees24h,
          inFlight: commandesEnVol,
        },
        generatedAt: DateTime.now().toISO(),
      },
    })
  }

  /**
   * GET /api/v1/admin/stats/activity?days=30&organizationId=
   *
   * Séries journalières des courbes du tableau de bord : positions reçues,
   * véhicules actifs, trajets, km, commandes par résultat, alertes et
   * croissance du parc. Un point par jour, jours vides compris.
   */
  async activityAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { days = 30, organizationId } = await ctx.request.validateUsing(adminActivityValidator)
    const rapport = await this.activity.daily({ days, organizationId })
    return ctx.response.ok({ data: rapport })
  }

  /**
   * GET /api/v1/admin/organizations/stats
   *
   * Une ligne par organisation : comptes, véhicules, boîtiers. Alimente le
   * tableau comparatif des clients (4 requêtes groupées, quel que soit le
   * nombre d'organisations).
   */
  async statsAll(ctx: HttpContext) {
    await authorizePlatform(ctx)

    const parOrg = (model: typeof UserModel | typeof VehicleModel | typeof DeviceModel) =>
      model
        .query()
        .whereNull('deleted_at')
        .select('organization_id')
        .count('* as total')
        .groupBy('organization_id')

    const [organisations, users, vehicles, devices] = await Promise.all([
      OrganizationModel.query().whereNull('deleted_at').orderBy('name'),
      parOrg(UserModel),
      parOrg(VehicleModel),
      parOrg(DeviceModel),
    ])

    const index = (lignes: Array<{ organizationId: string; $extras: Record<string, unknown> }>) =>
      Object.fromEntries(lignes.map((l) => [l.organizationId, Number(l.$extras.total ?? 0)]))
    const [u, v, d] = [index(users), index(vehicles), index(devices)]

    return ctx.response.ok({
      data: organisations.map((o) => ({
        id: o.id,
        code: o.code,
        name: o.name,
        isActive: o.isActive,
        users: u[o.id] ?? 0,
        vehicles: v[o.id] ?? 0,
        devices: d[o.id] ?? 0,
      })),
    })
  }

  // -------------------------------------------------------------------------

  /** Le format uuid de `:id` est garanti par le matcher de route. */
  private trouver(id: string): Promise<OrganizationModel | null> {
    return OrganizationModel.query().where('id', id).whereNull('deleted_at').first()
  }

  private introuvable(ctx: HttpContext) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: 'Organisation introuvable', details: {} },
    })
  }
}
