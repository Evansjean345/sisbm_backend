import type { HttpContext } from '@adonisjs/core/http'
import { ForbiddenError } from '#domain/kernel'
import { isPlatformOperator } from '#domain/identity/role_policy'
import { permissionsOf } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'

export interface OrganizationScope {
  /** Organisation sur laquelle porte la requête. */
  organizationId: string
  /** L'acteur détient le joker `*` : il peut viser n'importe quelle organisation. */
  isPlatform: boolean
}

/**
 * Détermine l'organisation visée par une requête.
 *
 * Deux familles de routes cohabitent dans l'API :
 *
 *   /api/v1/vehicle-groups                      → l'organisation de l'acteur
 *   /api/v1/organizations/:id/vehicle-groups    → une organisation désignée
 *
 * La seconde n'est légitime que pour l'exploitant plateforme. Viser une autre
 * organisation sans le joker `*` est un 403, jamais un 404 silencieux : la
 * tentative doit être lisible dans les journaux.
 */
export async function organizationScope(
  ctx: HttpContext,
  organizationId?: string
): Promise<OrganizationScope> {
  const granted = await permissionsOf(ctx)
  const isPlatform = isPlatformOperator(granted)
  const own = toExecutionContext(ctx).organizationId

  if (organizationId && organizationId !== own && !isPlatform) {
    throw new ForbiddenError('Organisation hors de votre périmètre', { organizationId })
  }

  return { organizationId: organizationId ?? own, isPlatform }
}
