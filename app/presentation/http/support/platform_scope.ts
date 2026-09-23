import type { HttpContext } from '@adonisjs/core/http'
import { ForbiddenError } from '#domain/kernel'
import { isPlatformOperator } from '#domain/identity/role_policy'
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import { permissionsOf } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'

/**
 * =========================================================================
 *  PÉRIMÈTRE PLATEFORME — tableau de bord d'administration
 * =========================================================================
 *
 * Les routes `/api/v1/admin/*` lisent et modifient les ressources de TOUTES
 * les organisations. Elles sont réservées au détenteur du joker `*`
 * (super_admin) : un `admin` d'organisation, même avec `user:write`, reste
 * cloisonné à son client.
 *
 * Le contrôle est fait deux fois, volontairement :
 *   ① par le middleware `platformAdmin` posé sur le groupe de routes ;
 *   ② par `authorizePlatform()` au début de chaque fonction `*All`.
 * Une route admin rattachée par erreur hors du groupe reste ainsi fermée.
 */

/**
 * Périmètre de lecture/écriture d'une requête :
 *   - `organizationId: string` → une seule organisation (routes client) ;
 *   - `organizationId: null`   → toutes les organisations (routes admin).
 */
export interface TenantScope {
  readonly organizationId: string | null
}

/** Toutes les organisations — n'utiliser qu'après `authorizePlatform()`. */
export const PLATFORM_SCOPE: TenantScope = Object.freeze({ organizationId: null })

/** L'organisation de l'acteur : le périmètre par défaut de toute l'API. */
export function ownScope(ctx: HttpContext): TenantScope {
  return { organizationId: toExecutionContext(ctx).organizationId }
}

/** Refuse (403) quiconque ne détient pas le joker plateforme `*`. */
export async function authorizePlatform(ctx: HttpContext): Promise<void> {
  const granted = await permissionsOf(ctx)
  if (!isPlatformOperator(granted)) {
    throw new ForbiddenError('Réservé à l’administration de la plateforme', { required: '*' })
  }
}

/**
 * Applique le cloisonnement à une requête Lucid. Sans effet en périmètre
 * plateforme ; `column` permet de viser une colonne préfixée (`devices.organization_id`).
 */
export function applyScope<Q extends { where(column: string, value: string): unknown }>(
  query: Q,
  scope: TenantScope,
  column = 'organization_id'
): Q {
  if (scope.organizationId !== null) query.where(column, scope.organizationId)
  return query
}

export interface OrganizationSummary {
  id: string
  code: string
  name: string
  isActive: boolean
}

/**
 * Résumé des organisations d'une page de résultats — UNE requête pour toute
 * la page. Le tableau de bord affiche le client de chaque ligne ; le lui
 * faire recharger ligne par ligne serait un N+1 côté front.
 */
export async function organizationsOf(
  organizationIds: string[]
): Promise<Record<string, OrganizationSummary>> {
  const ids = [...new Set(organizationIds.filter(Boolean))]
  if (ids.length === 0) return {}

  const lignes = await OrganizationModel.query()
    .whereIn('id', ids)
    .select('id', 'code', 'name', 'is_active')
  return Object.fromEntries(
    lignes.map((o) => [o.id, { id: o.id, code: o.code, name: o.name, isActive: o.isActive }])
  )
}

/** Sérialise une page Lucid en ajoutant `organization` à chaque ligne. */
export async function serializeWithOrganizations<
  R extends { organizationId: string; serialize(): Record<string, unknown> },
>(page: { all(): R[]; getMeta(): unknown }) {
  const lignes = page.all()
  const organisations = await organizationsOf(lignes.map((l) => l.organizationId))
  return {
    meta: page.getMeta(),
    data: lignes.map((l) => ({
      ...l.serialize(),
      organization: organisations[l.organizationId] ?? null,
    })),
  }
}

/**
 * Transforme le résultat d'un `GROUP BY` Lucid en dictionnaire
 * `{ valeur: total }` — format des compteurs du tableau de bord.
 */
export function countsBy(
  lignes: ReadonlyArray<{ $extras: Record<string, unknown> }>,
  key: string
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of lignes) {
    const valeur = String(
      (l as unknown as Record<string, unknown>)[key] ?? l.$extras[key] ?? 'unknown'
    )
    out[valeur] = Number(l.$extras.total ?? 0)
  }
  return out
}
