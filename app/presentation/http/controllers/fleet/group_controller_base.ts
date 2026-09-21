import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import type { LucidModel, LucidRow } from '@adonisjs/lucid/types/model'
import type { AuditLogger } from '#application/ports'
import type { AuditLogReader } from '#application/audit/ports'
import type { GroupMembershipRepository } from '#application/fleet/ports'
import {
  assignDevicesValidator,
  assignVehiclesValidator,
  createGroupValidator,
  listGroupsValidator,
  updateGroupValidator,
} from '#presentation/http/validators/fleet/group_validators'
import { listAuditLogsValidator } from '#presentation/http/validators/audit/audit_validators'
import { authorize, type Permission } from '#presentation/http/support/authorize'
import { organizationScope } from '#presentation/http/support/organization_scope'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { resolveWindow, serializeAuditPage } from '#presentation/http/support/audit_window'

interface GroupRow extends LucidRow {
  id: string
  organizationId: string
  name: string
  description: string | null
  color: string | null
  deletedAt: DateTime | null
}

export interface GroupControllerConfig {
  /** Modèle Lucid du groupe. */
  model: LucidModel
  /** `vehicle_group` | `device_group` — type de ressource dans l'audit. */
  resourceType: string
  /** `vehicle` | `device` — type de ressource des membres dans l'audit. */
  memberResourceType: string
  /** Clé JSON de la liste des membres dans le corps de requête. */
  memberPayloadKey: 'vehicleIds' | 'deviceIds'
  read: Permission
  write: Permission
  libelle: string
}

/**
 * =========================================================================
 *  GROUPES — socle commun véhicules / boîtiers
 * =========================================================================
 *
 * Style PRAGMATIQUE (docs/03 §3) : contrôleur → Lucid pour le CRUD, qui n'a
 * aucun invariant complexe (l'unicité du nom par organisation est un index).
 * Deux exceptions passent par des ports :
 *
 *  - l'APPARTENANCE, qui porte la règle de cloisonnement ;
 *  - la LECTURE D'AUDIT, pour que la présentation ne touche jamais la base.
 *
 * Les deux familles de groupes partagent ce socle : elles ont les mêmes
 * tables à un nom près, et une divergence de comportement entre « groupe de
 * véhicules » et « groupe de boîtiers » serait une surprise, pas une feature.
 */
export abstract class GroupControllerBase {
  protected constructor(
    private readonly cfg: GroupControllerConfig,
    private readonly membership: GroupMembershipRepository,
    private readonly audit: AuditLogger,
    private readonly auditLogs: AuditLogReader
  ) {}

  /** GET /:famille  ·  GET /organizations/:organizationId/:famille */
  async index(ctx: HttpContext) {
    await authorize(ctx, this.cfg.read)
    const scope = await organizationScope(ctx, ctx.params.organizationId)
    const { page = 1, perPage = 25, search } = await ctx.request.validateUsing(listGroupsValidator)

    const query = this.cfg.model
      .query()
      .where('organization_id', scope.organizationId)
      .whereNull('deleted_at')
      .orderBy('name')
    if (search) query.whereILike('name', `%${search}%`)

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    const lignes = resultat.all() as GroupRow[]

    // Un groupe sans son effectif n'apprend rien : une seule requête agrégée
    // pour toute la page, plutôt qu'un compte par ligne.
    const compteurs = await this.membership.countByGroup(lignes.map((g) => g.id))

    return ctx.response.ok({
      meta: resultat.getMeta(),
      data: lignes.map((g) => ({ ...g.serialize(), membersCount: compteurs[g.id] ?? 0 })),
    })
  }

  /** POST /:famille  ·  POST /organizations/:organizationId/:famille */
  async store(ctx: HttpContext) {
    await authorize(ctx, this.cfg.write)
    const scope = await organizationScope(ctx, ctx.params.organizationId)
    const payload = await ctx.request.validateUsing(createGroupValidator)

    if (await this.nomPris(scope.organizationId, payload.name)) {
      return this.nomDejaPris(ctx, payload.name)
    }

    const groupe = (await this.cfg.model.create({
      ...payload,
      organizationId: scope.organizationId,
    })) as GroupRow

    await this.tracer(ctx, scope.organizationId, 'created', groupe.id, {
      after: { name: groupe.name, description: groupe.description, color: groupe.color },
    })

    return ctx.response.created({ data: { ...groupe.serialize(), membersCount: 0 } })
  }

  /** GET /:famille/:id */
  async show(ctx: HttpContext) {
    await authorize(ctx, this.cfg.read)
    const groupe = await this.trouver(ctx)
    if (!groupe) return this.introuvable(ctx)

    const membres = await this.membership.members(groupe.id)
    return ctx.response.ok({
      data: { ...groupe.serialize(), membersCount: membres.length, members: membres },
    })
  }

  /** PATCH /:famille/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, this.cfg.write)
    const payload = await ctx.request.validateUsing(updateGroupValidator)
    const groupe = await this.trouver(ctx)
    if (!groupe) return this.introuvable(ctx)

    if (payload.name && payload.name !== groupe.name) {
      if (await this.nomPris(groupe.organizationId, payload.name, groupe.id)) {
        return this.nomDejaPris(ctx, payload.name)
      }
    }

    const avant = { name: groupe.name, description: groupe.description, color: groupe.color }
    groupe.merge(payload)
    await groupe.save()

    await this.tracer(ctx, groupe.organizationId, 'updated', groupe.id, {
      before: avant,
      after: { name: groupe.name, description: groupe.description, color: groupe.color },
    })

    return ctx.response.ok({ data: groupe.serialize() })
  }

  /**
   * DELETE /:famille/:id — suppression LOGIQUE.
   *
   * Le groupe est référencé par des politiques et des geofences
   * (migrations 005 et 006) et par des lignes d'audit qui doivent rester
   * lisibles. On le retire des listes, on ne l'efface pas.
   */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, this.cfg.write)
    const groupe = await this.trouver(ctx)
    if (!groupe) return this.introuvable(ctx)

    groupe.deletedAt = DateTime.now()
    await groupe.save()

    await this.tracer(ctx, groupe.organizationId, 'deleted', groupe.id, {
      before: { name: groupe.name },
    })

    return ctx.response.noContent()
  }

  /** GET /:famille/:id/members */
  async members(ctx: HttpContext) {
    await authorize(ctx, this.cfg.read)
    const groupe = await this.trouver(ctx)
    if (!groupe) return this.introuvable(ctx)

    const membres = await this.membership.members(groupe.id)
    return ctx.response.ok({ data: membres, meta: { total: membres.length } })
  }

  /**
   * POST /:famille/:id/members — affectation en lot, IDEMPOTENTE.
   *
   * Réaffecter un membre déjà présent n'est pas une erreur : le tableau de
   * bord réémet volontiers la même sélection. La réponse distingue trois
   * ensembles — ajoutés, déjà présents, refusés — pour que l'appelant sache
   * exactement ce qui s'est passé sans rejouer un GET.
   */
  async assign(ctx: HttpContext) {
    await authorize(ctx, this.cfg.write)
    const groupe = await this.trouver(ctx)
    if (!groupe) return this.introuvable(ctx)

    const ids = await this.lireMembres(ctx)
    const resultat = await this.membership.add(groupe.id, groupe.organizationId, ids)

    if (resultat.applied.length > 0) {
      await this.tracer(ctx, groupe.organizationId, 'members_added', groupe.id, {
        after: { [this.cfg.memberPayloadKey]: resultat.applied },
        metadata: { rejected: resultat.rejected.length },
      })
    }

    // Refus TOTAL : aucun identifiant exploitable, l'appelant s'est trompé
    // de groupe ou d'organisation. On le dit en 422 plutôt qu'en 200 vide.
    if (resultat.applied.length === 0 && resultat.unchanged.length === 0) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_MEMBERS_OUT_OF_SCOPE',
          message: `Aucun ${this.cfg.libelle} exploitable : identifiants inconnus, supprimés ou hors de l'organisation du groupe`,
          details: { rejected: resultat.rejected },
        },
      })
    }

    return ctx.response.ok({ data: resultat })
  }

  /** DELETE /:famille/:id/members/:memberId — retrait d'un membre. */
  async unassign(ctx: HttpContext) {
    await authorize(ctx, this.cfg.write)
    const groupe = await this.trouver(ctx)
    if (!groupe) return this.introuvable(ctx)

    const resultat = await this.membership.remove(groupe.id, [ctx.params.memberId])
    if (resultat.applied.length === 0) {
      return ctx.response.notFound({
        error: {
          code: 'E_NOT_FOUND',
          message: `Ce ${this.cfg.libelle} n'appartient pas au groupe`,
          details: { memberId: ctx.params.memberId },
        },
      })
    }

    await this.tracer(ctx, groupe.organizationId, 'members_removed', groupe.id, {
      before: { [this.cfg.memberPayloadKey]: resultat.applied },
    })

    return ctx.response.noContent()
  }

  /**
   * GET /:famille/:id/audit-logs — journal du groupe.
   *
   * « Les logs du groupe » réunissent trois choses : les actes sur le groupe
   * lui-même, ceux sur ses membres, et les COMMANDES émises sur ces membres.
   * Sans le troisième ensemble, l'écran manquerait les immobilisations, qui
   * sont tracées sous `device_command`.
   */
  async auditLogsOfGroup(ctx: HttpContext) {
    await authorize(ctx, 'viewAuditLogs')
    const groupe = await this.trouver(ctx)
    if (!groupe) return this.introuvable(ctx)

    const filtres = await ctx.request.validateUsing(listAuditLogsValidator)
    const fenetre = resolveWindow(filtres.from, filtres.to)
    if (!fenetre.ok) return ctx.response.unprocessableEntity({ error: fenetre.error })

    const membres = await this.membership.memberIds(groupe.id)
    const commandes = await this.membership.commandIdsForMembers(membres)

    const page = await this.auditLogs.search({
      organizationIds: [groupe.organizationId],
      from: fenetre.from,
      to: fenetre.to,
      action: filtres.action,
      actorId: filtres.actorId,
      resourceScope: [
        { resourceType: this.cfg.resourceType, resourceIds: [groupe.id] },
        { resourceType: this.cfg.memberResourceType, resourceIds: membres },
        { resourceType: 'device_command', resourceIds: commandes },
      ],
      page: filtres.page ?? 1,
      perPage: Math.min(filtres.perPage ?? 25, 200),
    })

    return ctx.response.ok(serializeAuditPage(page, fenetre))
  }

  // -------------------------------------------------------------------------

  /** Le groupe est cherché DANS le périmètre de l'acteur : pas de fuite inter-clients. */
  private async trouver(ctx: HttpContext): Promise<GroupRow | null> {
    const scope = await organizationScope(ctx)
    const query = this.cfg.model.query().where('id', ctx.params.id).whereNull('deleted_at')
    if (!scope.isPlatform) query.where('organization_id', scope.organizationId)
    return (await query.first()) as GroupRow | null
  }

  private async lireMembres(ctx: HttpContext): Promise<string[]> {
    if (this.cfg.memberPayloadKey === 'vehicleIds') {
      const payload = await ctx.request.validateUsing(assignVehiclesValidator)
      return payload.vehicleIds
    }
    const payload = await ctx.request.validateUsing(assignDevicesValidator)
    return payload.deviceIds
  }

  private tracer(
    ctx: HttpContext,
    organizationId: string,
    action: string,
    groupId: string,
    details: {
      before?: Record<string, unknown>
      after?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }
  ) {
    return this.audit.record({
      context: { ...toExecutionContext(ctx), organizationId },
      action: `fleet.${this.cfg.resourceType}.${action}`,
      resourceType: this.cfg.resourceType,
      resourceId: groupId,
      ...details,
    })
  }

  /**
   * L'unicité du nom est tenue par un index (`uq_*_groups_org_name`). On la
   * pré-vérifie tout de même : « nom déjà utilisé » est actionnable,
   * « contrainte d'intégrité violée » ne l'est pas.
   */
  private async nomPris(organizationId: string, name: string, exceptId?: string): Promise<boolean> {
    const query = this.cfg.model
      .query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .whereRaw('lower(name) = lower(?)', [name])
    if (exceptId) query.whereNot('id', exceptId)
    return (await query.first()) !== null
  }

  private nomDejaPris(ctx: HttpContext, name: string) {
    return ctx.response.conflict({
      error: {
        code: 'E_GROUP_NAME_TAKEN',
        message: `Un groupe nommé « ${name} » existe déjà dans cette organisation`,
        details: { name },
      },
    })
  }

  private introuvable(ctx: HttpContext) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: 'Groupe introuvable', details: {} },
    })
  }
}
