import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import UserModel from '#infrastructure/persistence/models/user_model'
import {
  createUserValidator,
  updateUserValidator,
  listUsersValidator,
  changePasswordValidator,
} from '#presentation/http/validators/identity/user_validators'
import { authorize } from '#presentation/http/support/authorize'
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
export default class UserController {
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
    const utilisateur = await this.trouver(ctx)
    if (!utilisateur) return this.introuvable(ctx)

    const role = await db
      .from('roles')
      .where('id', utilisateur.roleId)
      .select('id', 'code', 'name', 'permissions')
      .first()

    return ctx.response.ok({ data: { ...utilisateur.serialize(), role } })
  }

  /** POST /api/v1/users */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const payload = await ctx.request.validateUsing(createUserValidator)
    const org = toExecutionContext(ctx).organizationId

    // Le rôle doit appartenir à l'organisation, ou être un rôle système.
    // Sans ce contrôle, un administrateur pourrait s'attribuer le rôle d'une
    // autre organisation et franchir la frontière de cloisonnement.
    const role = await db
      .from('roles')
      .where('id', payload.roleId)
      .where((q) => q.where('organization_id', org).orWhereNull('organization_id'))
      .first()

    if (!role) {
      return ctx.response.unprocessableEntity({
        error: { code: 'E_INVALID_ROLE', message: 'Rôle inconnu ou hors périmètre', details: {} },
      })
    }

    const utilisateur = await UserModel.create({
      organizationId: org,
      roleId: payload.roleId,
      email: payload.email,
      passwordHash: await hash.make(payload.password),
      fullName: payload.fullName,
      phone: payload.phone ?? null,
      status: payload.status ?? 'active',
      locale: payload.locale ?? 'fr',
      timezone: payload.timezone ?? 'Africa/Abidjan',
      failedAttempts: 0,
    })

    return ctx.response.created({ data: utilisateur.serialize() })
  }

  /** PATCH /api/v1/users/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const payload = await ctx.request.validateUsing(updateUserValidator)
    const utilisateur = await this.trouver(ctx)
    if (!utilisateur) return this.introuvable(ctx)

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
    await db.from('auth_access_tokens').where('tokenable_id', utilisateur.id).delete()

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
    await db.from('auth_access_tokens').where('tokenable_id', utilisateur.id).delete()

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
    await db.from('auth_access_tokens').where('tokenable_id', utilisateur.id).delete()

    return ctx.response.noContent()
  }

  /** GET /api/v1/roles — nécessaire pour alimenter le formulaire de création. */
  async roles(ctx: HttpContext) {
    await authorize(ctx, 'manageUsers')
    const org = toExecutionContext(ctx).organizationId
    const lignes = await db
      .from('roles')
      .where((q) => q.where('organization_id', org).orWhereNull('organization_id'))
      .orderBy('code')
      .select('id', 'code', 'name', 'description', 'permissions', 'is_system')
    return ctx.response.ok({ data: lignes })
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

  private introuvable(ctx: HttpContext) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: 'Utilisateur introuvable', details: {} },
    })
  }
}
