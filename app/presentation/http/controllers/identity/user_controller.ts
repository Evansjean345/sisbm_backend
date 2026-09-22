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

  /** GET /api/v1/users/admin -- superAdminRoutes */
  async indexAll(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const { page = 1, perPage = 25, status } = await ctx.request.validateUsing(listUsersValidator)
    //const org = toExecutionContext(ctx).organizationId

    const query = UserModel.query()
      //.where('organization_id', org)
      .whereNull('deleted_at')
      .orderBy('full_name')
    if (status) query.where('status', status)

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(resultat.toJSON())
  }

  /** GET /api/v1/users/:id */
  async show(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const utilisateur = await this.trouver(ctx)
    if (!utilisateur) return this.introuvable(ctx)

    const role = await RoleModel.query()
      .where('id', utilisateur.roleId)
      .select('id', 'code', 'name', 'permissions')
      .first()

    return ctx.response.ok({
      data: {
        ...utilisateur.serialize(),
        role: role
          ? { id: role.id, code: role.code, name: role.name, permissions: role.permissions }
          : null,
      },
    })
  }
  /** GET /api/v1/users/:id/admin --superAdminRoutes */
  async showALL(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const utilisateur = await this.findALL(ctx)
    if (!utilisateur) return this.introuvable(ctx)

    const role = await RoleModel.query()
      .where('id', utilisateur.roleId)
      .select('id', 'code', 'name', 'permissions')
      .first()

    return ctx.response.ok({
      data: {
        ...utilisateur.serialize(),
        role: role
          ? { id: role.id, code: role.code, name: role.name, permissions: role.permissions }
          : null,
      },
    })
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
    const payload = await ctx.request.validateUsing(createUserValidator)
    const contexte = toExecutionContext(ctx)

    const result = await this.createOrganizationUser.execute({
      context: contexte,
      actorPermissions: await permissionsOf(ctx),
      organizationId: contexte.organizationId,
      user: payload,
    })

    if (!result.ok) {
      return ctx.response.status(result.error.httpStatus).send({ error: result.error.toJSON() })
    }
    return ctx.response.created({ data: result.value })
  }

  /** PATCH /api/v1/users/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const payload = await ctx.request.validateUsing(updateUserValidator)
    const utilisateur = await this.trouver(ctx)
    if (!utilisateur) return this.introuvable(ctx)

    // Changer de rôle, c'est attribuer un rôle : même règle qu'à la création.
    // Sans ce contrôle, `PATCH { roleId }` était une porte d'escalade.
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

  /** PATCH /api/v1/users/:id/admin */
  async updateALL(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const payload = await ctx.request.validateUsing(updateUserValidator)
    const utilisateur = await this.findALL(ctx)
    if (!utilisateur) return this.introuvable(ctx)

    // Changer de rôle, c'est attribuer un rôle : même règle qu'à la création.
    // Sans ce contrôle, `PATCH { roleId }` était une porte d'escalade.
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
    const utilisateur = await this.trouver(ctx)
    if (!utilisateur) return this.introuvable(ctx)

    utilisateur.status = 'suspended'
    await utilisateur.save()
    // Suspendre sans révoquer les jetons laisserait le compte actif jusqu'à
    // leur expiration — sept jours.
    await UserModel.revokeAllTokens(utilisateur.id)

    return ctx.response.ok({ data: utilisateur.serialize() })
  }
  /** POST /api/v1/users/:id/suspend/admin */
  async suspendALL(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const utilisateur = await this.findALL(ctx)
    if (!utilisateur) return this.introuvable(ctx)

    utilisateur.status = 'suspended'
    await utilisateur.save()
    // Suspendre sans révoquer les jetons laisserait le compte actif jusqu'à
    // leur expiration — sept jours.
    await UserModel.revokeAllTokens(utilisateur.id)

    return ctx.response.ok({ data: utilisateur.serialize() })
  }

  /** DELETE /api/v1/users/:id — suppression logique. */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const contexte = toExecutionContext(ctx)
    const utilisateur = await this.trouver(ctx)
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
  /** DELETE /api/v1/users/:id/admin — suppression logique. */
  async destroyALL(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const contexte = toExecutionContext(ctx)
    const utilisateur = await this.findALL(ctx)
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

  private async trouver(ctx: HttpContext): Promise<UserModel | null> {
    const org = toExecutionContext(ctx).organizationId
    return UserModel.query()
      .where('id', ctx.params.id)
      .where('organization_id', org)
      .whereNull('deleted_at')
      .first()
  }

  private async findALL(ctx: HttpContext): Promise<UserModel | null> {
    return UserModel.query().where('id', ctx.params.id).whereNull('deleted_at').first()
  }

  private introuvable(ctx: HttpContext) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: 'Utilisateur introuvable', details: {} },
    })
  }
}
