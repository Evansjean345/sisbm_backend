import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import UserModel from '#infrastructure/persistence/models/user_model'
import RoleModel from '#infrastructure/persistence/models/role_model'
import { missingPermissions } from '#domain/identity/role_policy'
import { CreateOrganizationUser } from '#application/identity/use_cases/create_organization_user'
import { RoleAssignment } from '#application/identity/services/role_assignment'
import {
  createUserValidator,
  updateUserValidator,
  listUsersValidator,
  changePasswordValidator,
} from '#presentation/http/validators/identity/user_validators'
import { authorize, permissionsOf } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import {
  adminListUsersValidator,
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
 *  CRUD UTILISATEURS — style pragmatique
 * =========================================================================
 *
 * Contrôleur → Lucid. Aucune invariant complexe : l'unicité de l'e-mail et la
 * validité des statuts sont tenues par la base.
 *
 * Deux règles s'appliquent en revanche sans exception :
 *  ① Le mot de passe n'est JAMAIS renvoyé (`serializeAs: null` sur le modèle).
 *  ② La suppression est LOGIQUE : un utilisateur est référencé par des
 *     commandes d'immobilisation et des journaux d'audit qui doivent rester
 *     nominatifs. Effacer la ligne rendrait l'audit inexploitable.
 */
@inject()
export default class UserController {
  constructor(
    private readonly createOrganizationUser: CreateOrganizationUser,
    private readonly roleAssignment: RoleAssignment
  ) {}

  /** GET /api/v1/users */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const { page = 1, perPage = 25, status } = await ctx.request.validateUsing(listUsersValidator)
    const org = toExecutionContext(ctx).organizationId

    const query = UserModel.query()
      .where('organization_id', org)
      .whereNull('deleted_at')
      .orderBy('full_name')
    if (status) query.where('status', status)

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(resultat.toJSON())
  }

  /** GET /api/v1/users/:id */
  async show(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    return this.afficher(ctx, ownScope(ctx))
  }

  /**
   * POST /api/v1/users — création d'un compte dans l'organisation de l'acteur.
   *
   * Passe par le cas d'usage partagé avec `POST /organizations/:id/users` :
   * le contrôle du rôle (cloisonnement + non-escalade) n'existe qu'à un endroit.
   * Il corrige une faille de la version précédente : un administrateur pouvait
   * attribuer le rôle système `super_admin`, car les rôles système étaient
   * tous considérés comme « dans le périmètre ».
   */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    return this.creer(ctx, toExecutionContext(ctx).organizationId)
  }

  /** PATCH /api/v1/users/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    return this.modifier(ctx, ownScope(ctx))
  }

  /**
   * POST /api/v1/users/me/password — changement par l'utilisateur lui-même.
   *
   * Exige le mot de passe courant : sans cela, une session volée suffirait à
   * verrouiller le compte de son propriétaire.
   */
  async changePassword(ctx: HttpContext) {
    const payload = await ctx.request.validateUsing(changePasswordValidator)
    const utilisateur = ctx.auth.getUserOrFail() as UserModel

    if (!(await utilisateur.verifyPassword(payload.currentPassword))) {
      return ctx.response.unauthorized({
        error: {
          code: 'E_INVALID_CREDENTIALS',
          message: 'Mot de passe actuel incorrect',
          details: {},
        },
      })
    }

    utilisateur.passwordHash = await hash.make(payload.newPassword)
    utilisateur.passwordChangedAt = DateTime.now()
    await utilisateur.save()

    // Révocation de toutes les sessions : un changement de mot de passe fait
    // souvent suite à une suspicion de compromission.
    await UserModel.revokeAllTokens(utilisateur.id)

    return ctx.response.noContent()
  }

  /** POST /api/v1/users/:id/suspend */
  async suspend(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    return this.suspendre(ctx, ownScope(ctx))
  }

  /** DELETE /api/v1/users/:id — suppression logique. */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    return this.supprimer(ctx, ownScope(ctx))
  }

  // =========================================================================
  //  TABLEAU DE BORD ADMIN — toutes organisations (joker `*` exigé)
  // =========================================================================

  /**
   * GET /api/v1/admin/users
   * ?organizationId=&roleId=&status=&search=&page=&perPage=
   *
   * Chaque ligne porte son `organization` et son `role` : le tableau de bord
   * affiche une liste inter-clients sans requête supplémentaire.
   */
  async indexAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const {
      page = 1,
      perPage = 25,
      status,
      organizationId,
      roleId,
      search,
    } = await ctx.request.validateUsing(adminListUsersValidator)

    const query = UserModel.query().whereNull('deleted_at').orderBy('full_name')
    if (organizationId) query.where('organization_id', organizationId)
    if (roleId) query.where('role_id', roleId)
    if (status) query.where('status', status)
    if (search) {
      query.where((q) =>
        q.whereILike('full_name', `%${search}%`).orWhereILike('email', `%${search}%`)
      )
    }

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    const corps = await serializeWithOrganizations(resultat)

    const roleIds = [...new Set(resultat.all().map((u) => u.roleId))]
    const roles = roleIds.length
      ? await RoleModel.query().whereIn('id', roleIds).select('id', 'code', 'name')
      : []
    const parId = Object.fromEntries(
      roles.map((r) => [r.id, { id: r.id, code: r.code, name: r.name }])
    )

    return ctx.response.ok({
      meta: corps.meta,
      data: corps.data.map((u, i) => ({ ...u, role: parId[resultat.all()[i].roleId] ?? null })),
    })
  }

  /** GET /api/v1/admin/users/stats?organizationId= — compteurs par statut et par organisation. */
  async statsAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(adminOrganizationFilterValidator)

    const base = () => {
      const q = UserModel.query().whereNull('deleted_at')
      if (organizationId) q.where('organization_id', organizationId)
      return q
    }

    const [parStatut, parOrganisation] = await Promise.all([
      base().select('status').count('* as total').groupBy('status'),
      base().select('organization_id').count('* as total').groupBy('organization_id'),
    ])
    const compteurs = countsBy(parStatut, 'status')
    const organisations = await organizationsOf(parOrganisation.map((l) => l.organizationId))

    return ctx.response.ok({
      data: {
        total: Object.values(compteurs).reduce((a, b) => a + b, 0),
        byStatus: compteurs,
        byOrganization: parOrganisation.map((l) => ({
          organization: organisations[l.organizationId] ?? { id: l.organizationId },
          total: Number(l.$extras.total ?? 0),
        })),
      },
    })
  }

  /** GET /api/v1/admin/users/:id */
  async showAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.afficher(ctx, PLATFORM_SCOPE)
  }

  /**
   * POST /api/v1/admin/users — body : { organizationId, ...champs de POST /users }
   *
   * Même cas d'usage que la création client : le rôle doit appartenir à
   * l'organisation CIBLE (ou être un rôle système) et la non-escalade
   * s'applique — l'organisation inexistante ou inactive est refusée.
   */
  async storeAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(targetOrganizationValidator)
    return this.creer(ctx, organizationId)
  }

  /** PATCH /api/v1/admin/users/:id */
  async updateAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.modifier(ctx, PLATFORM_SCOPE)
  }

  /** POST /api/v1/admin/users/:id/suspend */
  async suspendAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.suspendre(ctx, PLATFORM_SCOPE)
  }

  /**
   * POST /api/v1/admin/users/:id/activate — lève une suspension.
   *
   * Remet aussi à zéro le compteur d'échecs et le verrouillage : réactiver un
   * compte resté verrouillé ne servirait à rien.
   */
  async activateAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const utilisateur = await this.trouver(ctx, PLATFORM_SCOPE)
    if (!utilisateur) return this.introuvable(ctx)

    utilisateur.status = 'active'
    utilisateur.failedAttempts = 0
    utilisateur.lockedUntil = null
    await utilisateur.save()
    return ctx.response.ok({ data: utilisateur.serialize() })
  }

  /** DELETE /api/v1/admin/users/:id — suppression logique. */
  async destroyAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.supprimer(ctx, PLATFORM_SCOPE)
  }

  // -------------------------------------------------------------------------
  //  Implémentations partagées client / admin : seul le périmètre change.
  // -------------------------------------------------------------------------

  private async afficher(ctx: HttpContext, scope: TenantScope) {
    const utilisateur = await this.trouver(ctx, scope)
    if (!utilisateur) return this.introuvable(ctx)

    const role = await RoleModel.query()
      .where('id', utilisateur.roleId)
      .select('id', 'code', 'name', 'permissions')
      .first()
    const organisations = await organizationsOf([utilisateur.organizationId])

    return ctx.response.ok({
      data: {
        ...utilisateur.serialize(),
        organization: organisations[utilisateur.organizationId] ?? null,
        role: role
          ? { id: role.id, code: role.code, name: role.name, permissions: role.permissions }
          : null,
      },
    })
  }

  private async creer(ctx: HttpContext, organizationId: string) {
    const payload = await ctx.request.validateUsing(createUserValidator)

    const result = await this.createOrganizationUser.execute({
      context: toExecutionContext(ctx),
      actorPermissions: await permissionsOf(ctx),
      organizationId,
      user: payload,
    })

    if (!result.ok) {
      return ctx.response.status(result.error.httpStatus).send({ error: result.error.toJSON() })
    }
    return ctx.response.created({ data: result.value })
  }

  private async modifier(ctx: HttpContext, scope: TenantScope) {
    const payload = await ctx.request.validateUsing(updateUserValidator)
    const utilisateur = await this.trouver(ctx, scope)
    if (!utilisateur) return this.introuvable(ctx)

    // Changer de rôle, c'est attribuer un rôle : même règle qu'à la création.
    // Sans ce contrôle, `PATCH { roleId }` était une porte d'escalade.
    // En admin aussi : le rôle doit exister dans l'organisation DE L'UTILISATEUR.
    if (payload.roleId && payload.roleId !== utilisateur.roleId) {
      const controle = await this.roleAssignment.check({
        roleId: payload.roleId,
        targetOrganizationId: utilisateur.organizationId,
        actorPermissions: await permissionsOf(ctx),
      })
      if (!controle.ok) {
        return ctx.response
          .status(controle.error.httpStatus)
          .send({ error: controle.error.toJSON() })
      }
    }

    utilisateur.merge(payload)
    await utilisateur.save()
    return ctx.response.ok({ data: utilisateur.serialize() })
  }

  private async suspendre(ctx: HttpContext, scope: TenantScope) {
    const utilisateur = await this.trouver(ctx, scope)
    if (!utilisateur) return this.introuvable(ctx)
    if (utilisateur.id === toExecutionContext(ctx).actorId) {
      return ctx.response.conflict({
        error: {
          code: 'E_SELF_SUSPEND',
          message: 'Un utilisateur ne peut pas suspendre son propre compte',
          details: {},
        },
      })
    }

    utilisateur.status = 'suspended'
    await utilisateur.save()
    // Suspendre sans révoquer les jetons laisserait le compte actif jusqu'à
    // leur expiration — sept jours.
    await UserModel.revokeAllTokens(utilisateur.id)

    return ctx.response.ok({ data: utilisateur.serialize() })
  }

  private async supprimer(ctx: HttpContext, scope: TenantScope) {
    const contexte = toExecutionContext(ctx)
    const utilisateur = await this.trouver(ctx, scope)
    if (!utilisateur) return this.introuvable(ctx)

    if (utilisateur.id === contexte.actorId) {
      return ctx.response.conflict({
        error: {
          code: 'E_SELF_DELETE',
          message: 'Un utilisateur ne peut pas supprimer son propre compte',
          details: {},
        },
      })
    }

    utilisateur.deletedAt = DateTime.now()
    utilisateur.status = 'suspended'
    await utilisateur.save()
    await UserModel.revokeAllTokens(utilisateur.id)

    return ctx.response.noContent()
  }

  /**
   * GET /api/v1/roles — alimente le formulaire de création.
   *
   * Format de réponse inchangé (clés snake_case consommées par le tableau de
   * bord), enrichi du drapeau `assignable` : calculé par la même règle que
   * l'écriture, il permet de griser `super_admin` pour un administrateur.
   */
  async roles(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const org = toExecutionContext(ctx).organizationId
    const granted = await permissionsOf(ctx)
    const lignes = await RoleModel.query()
      .where((q) => q.where('organization_id', org).orWhereNull('organization_id'))
      .orderBy('code')

    return ctx.response.ok({
      data: lignes.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        is_system: r.isSystem,
        assignable:
          missingPermissions(granted, {
            id: r.id,
            code: r.code,
            organizationId: r.organizationId,
            permissions: r.permissions ?? [],
          }).length === 0,
      })),
    })
  }

  // -------------------------------------------------------------------------

  /** Cherché DANS le périmètre : un id d'un autre client donne 404, pas une fuite. */
  private async trouver(ctx: HttpContext, scope: TenantScope): Promise<UserModel | null> {
    const query = UserModel.query().where('id', ctx.params.id).whereNull('deleted_at')
    return applyScope(query, scope).first()
  }

  private introuvable(ctx: HttpContext) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: 'Utilisateur introuvable', details: {} },
    })
  }
}
