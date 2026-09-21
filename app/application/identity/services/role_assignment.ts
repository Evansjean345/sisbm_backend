import { Err, Ok, type Result } from '#domain/kernel'
import type { TransactionScope } from '#application/ports'
import type { RoleCatalog } from '#application/identity/ports'
import {
  isRoleInScope,
  missingPermissions,
  type AssignableRole,
} from '#domain/identity/role_policy'
import { InvalidRoleError, RoleEscalationError } from '#domain/identity/errors'

/**
 * Contrôle d'attribution d'un rôle — point UNIQUE de décision.
 *
 * Utilisé à la création d'un compte (cas d'usage) ET au changement de rôle
 * (`PATCH /users/:id`). Deux chemins, une seule règle : c'est ce qui empêche
 * qu'une route oubliée devienne la porte d'escalade.
 */
export class RoleAssignment {
  constructor(private readonly roles: RoleCatalog) {}

  async check(input: {
    roleId: string
    targetOrganizationId: string
    actorPermissions: readonly string[]
    tx?: TransactionScope
  }): Promise<Result<AssignableRole, InvalidRoleError | RoleEscalationError>> {
    const role = await this.roles.findById(input.roleId, input.tx)

    // Rôle inexistant et rôle d'un autre client : MÊME réponse. Distinguer
    // les deux révélerait l'existence des rôles des autres organisations.
    if (!role || !isRoleInScope(role, input.targetOrganizationId)) {
      return Err(new InvalidRoleError(input.roleId))
    }

    const missing = missingPermissions(input.actorPermissions, role)
    if (missing.length > 0) return Err(new RoleEscalationError(role.code, missing))

    return Ok(role)
  }
}
