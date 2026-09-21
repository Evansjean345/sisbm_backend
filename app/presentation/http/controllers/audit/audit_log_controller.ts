import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { LucidAuditLogReader } from '#infrastructure/persistence/readers/audit_log_reader'
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import { listAuditLogsValidator } from '#presentation/http/validators/audit/audit_validators'
import { authorize } from '#presentation/http/support/authorize'
import { organizationScope } from '#presentation/http/support/organization_scope'
import { resolveWindow, serializeAuditPage } from '#presentation/http/support/audit_window'

/**
 * =========================================================================
 *  JOURNAL D'AUDIT — lecture seule
 * =========================================================================
 *
 * `audit_logs` est append-only (TDR §II.5) : aucune route n'écrit, aucune ne
 * modifie, aucune ne supprime. Ce contrôleur ne fait que lire, à travers un
 * port — la présentation ne touche jamais la base.
 *
 * CLOISONNEMENT — c'est le point sensible de cette ressource :
 *
 *   super_admin (`*`)  : toutes les organisations, ou une seule via
 *                        `?organizationId=` / `/organizations/:id/audit-logs`
 *   admin client       : SON organisation, quoi qu'il demande
 *
 * Le paramètre `organizationId` d'un administrateur client visant une autre
 * organisation donne un 403 explicite, pas une liste vide : une tentative
 * doit être visible, pas silencieuse.
 */
@inject()
export default class AuditLogController {
  constructor(private readonly auditLogs: LucidAuditLogReader) {}

  /** GET /api/v1/audit-logs */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewAuditLogs')
    const filtres = await ctx.request.validateUsing(listAuditLogsValidator)
    const scope = await organizationScope(ctx, filtres.organizationId)

    const fenetre = resolveWindow(filtres.from, filtres.to)
    if (!fenetre.ok) return ctx.response.unprocessableEntity({ error: fenetre.error })

    // Exploitant sans filtre explicite : lecture inter-organisations.
    const organizationIds =
      scope.isPlatform && !filtres.organizationId ? [] : [scope.organizationId]

    const page = await this.auditLogs.search({
      organizationIds,
      from: fenetre.from,
      to: fenetre.to,
      action: filtres.action,
      resourceType: filtres.resourceType,
      resourceId: filtres.resourceId,
      actorId: filtres.actorId,
      page: filtres.page ?? 1,
      perPage: Math.min(filtres.perPage ?? 25, 200),
    })

    return ctx.response.ok(serializeAuditPage(page, fenetre))
  }

  /**
   * GET /api/v1/organizations/:id/audit-logs
   *
   * Même lecture, organisation imposée par l'URL. L'existence de
   * l'organisation est vérifiée : sinon une faute de frappe rendrait une
   * liste vide qu'on prendrait pour « aucune activité ».
   */
  async byOrganization(ctx: HttpContext) {
    await authorize(ctx, 'viewAuditLogs')
    const scope = await organizationScope(ctx, ctx.params.id)
    const filtres = await ctx.request.validateUsing(listAuditLogsValidator)

    const organisation = await OrganizationModel.query()
      .where('id', scope.organizationId)
      .whereNull('deleted_at')
      .select('id')
      .first()
    if (!organisation) {
      return ctx.response.notFound({
        error: { code: 'E_NOT_FOUND', message: 'Organisation introuvable', details: {} },
      })
    }

    const fenetre = resolveWindow(filtres.from, filtres.to)
    if (!fenetre.ok) return ctx.response.unprocessableEntity({ error: fenetre.error })

    const page = await this.auditLogs.search({
      organizationIds: [scope.organizationId],
      from: fenetre.from,
      to: fenetre.to,
      action: filtres.action,
      resourceType: filtres.resourceType,
      resourceId: filtres.resourceId,
      actorId: filtres.actorId,
      page: filtres.page ?? 1,
      perPage: Math.min(filtres.perPage ?? 25, 200),
    })

    return ctx.response.ok(serializeAuditPage(page, fenetre))
  }

  /**
   * GET /api/v1/audit-logs/actions
   *
   * Valeurs distinctes d'`action` sur la fenêtre : alimente le filtre du
   * tableau de bord sans lui faire deviner la nomenclature.
   */
  async actions(ctx: HttpContext) {
    await authorize(ctx, 'viewAuditLogs')
    const filtres = await ctx.request.validateUsing(listAuditLogsValidator)
    const scope = await organizationScope(ctx, filtres.organizationId)

    const fenetre = resolveWindow(filtres.from, filtres.to)
    if (!fenetre.ok) return ctx.response.unprocessableEntity({ error: fenetre.error })

    const organizationIds =
      scope.isPlatform && !filtres.organizationId ? [] : [scope.organizationId]
    const actions = await this.auditLogs.actions(organizationIds, fenetre.from, fenetre.to)

    return ctx.response.ok({
      data: actions,
      meta: { window: { from: fenetre.from.toISOString(), to: fenetre.to.toISOString() } },
    })
  }
}
