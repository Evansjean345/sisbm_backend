/**
 * =========================================================================
 *  POLITIQUE D'ATTRIBUTION DES RÔLES — règles pures, sans I/O
 * =========================================================================
 *
 * Le RBAC est plat : `roles.permissions text[]`, format `ressource:action`,
 * jokers `ressource:*` et `*` (cf. docs/03 §6).
 *
 * Deux règles, et seulement deux :
 *
 *  ① CLOISONNEMENT — un rôle attribuable est soit un rôle système (global),
 *    soit un rôle propre à l'organisation CIBLE. Jamais celui d'un autre client.
 *
 *  ② NON-ESCALADE — on ne peut accorder que ce que l'on détient. Toute
 *    habilitation du rôle attribué doit être couverte par celles de l'acteur.
 *    Conséquence : seul un détenteur de `*` peut créer un `super_admin`.
 *
 * Aucune dépendance : ces règles se testent en quelques microsecondes.
 */

export interface AssignableRole {
  readonly id: string
  readonly code: string
  readonly organizationId: string | null
  readonly permissions: readonly string[]
}

/** Joker absolu : réservé à l'exploitant de la plateforme. */
export const PLATFORM_WILDCARD = '*'

/** Code du rôle attribué au premier compte d'une organisation nouvellement créée. */
export const ORGANIZATION_OWNER_ROLE = 'admin'

/**
 * Vrai si `granted` couvre l'habilitation `required`.
 *
 *   covers(['*'], 'vehicle:read')          → true
 *   covers(['vehicle:*'], 'vehicle:read')  → true
 *   covers(['vehicle:*'], 'vehicle:*')     → true
 *   covers(['vehicle:read'], 'vehicle:*')  → false  (le joker vaut plus que l'action)
 *   covers(['vehicle:*'], '*')             → false
 */
export function covers(granted: readonly string[], required: string): boolean {
  if (granted.includes(PLATFORM_WILDCARD)) return true
  if (required === PLATFORM_WILDCARD) return false
  if (granted.includes(required)) return true

  const [resource] = required.split(':')
  return granted.includes(`${resource}:*`)
}

/** Habilitations du rôle que l'acteur ne détient pas. Vide = attribution permise. */
export function missingPermissions(
  actorPermissions: readonly string[],
  role: AssignableRole
): string[] {
  return role.permissions.filter((p) => !covers(actorPermissions, p))
}

/** Règle ① — le rôle est-il utilisable dans l'organisation cible ? */
export function isRoleInScope(role: AssignableRole, targetOrganizationId: string): boolean {
  return role.organizationId === null || role.organizationId === targetOrganizationId
}

/** L'acteur opère-t-il au niveau plateforme (toutes organisations) ? */
export function isPlatformOperator(actorPermissions: readonly string[]): boolean {
  return actorPermissions.includes(PLATFORM_WILDCARD)
}
