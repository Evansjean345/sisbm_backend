import { DomainError } from '#domain/kernel'

/**
 * Erreurs du contexte Identité (organisations, comptes, rôles).
 *
 * Chaque `code` est un contrat d'API : le front et les systèmes tiers s'en
 * servent comme clé. On n'en change jamais un sans le traiter comme une
 * rupture de contrat.
 */

export class OrganizationCodeTakenError extends DomainError {
  readonly code = 'E_ORGANIZATION_CODE_TAKEN'
  readonly httpStatus = 409

  constructor(code: string) {
    super(`Le code d'organisation « ${code} » est déjà utilisé`, { code })
  }
}

export class OrganizationNotFoundError extends DomainError {
  readonly code = 'E_ORGANIZATION_NOT_FOUND'
  readonly httpStatus = 404

  constructor(organizationId: string) {
    super('Organisation introuvable', { organizationId })
  }
}

/**
 * Une organisation désactivée ne reçoit plus de nouveaux comptes : c'est la
 * première mesure prise lors d'une résiliation ou d'un impayé, elle doit
 * geler le périmètre, pas seulement le masquer.
 */
export class OrganizationInactiveError extends DomainError {
  readonly code = 'E_ORGANIZATION_INACTIVE'
  readonly httpStatus = 409

  constructor(organizationId: string) {
    super("L'organisation est désactivée : aucun compte ne peut y être créé", {
      organizationId,
    })
  }
}

export class EmailTakenError extends DomainError {
  readonly code = 'E_EMAIL_TAKEN'
  readonly httpStatus = 409

  constructor(email: string) {
    super('Cette adresse e-mail est déjà associée à un compte', { email })
  }
}

/** Rôle inexistant, ou appartenant à une AUTRE organisation. */
export class InvalidRoleError extends DomainError {
  readonly code = 'E_INVALID_ROLE'
  readonly httpStatus = 422

  constructor(roleId: string) {
    super('Rôle inconnu ou hors périmètre', { roleId })
  }
}

/**
 * Tentative d'attribuer un rôle plus puissant que celui de l'acteur.
 *
 * C'est la faille classique d'un RBAC : un administrateur d'organisation qui
 * se crée un complice `super_admin`, et franchit ainsi la frontière de
 * cloisonnement entre clients.
 */
export class RoleEscalationError extends DomainError {
  readonly code = 'E_ROLE_ESCALATION'
  readonly httpStatus = 403

  constructor(roleCode: string, missing: string[]) {
    super(
      `Vous ne pouvez pas attribuer le rôle « ${roleCode} » : il accorde des ` +
        `habilitations que vous ne détenez pas vous-même`,
      { roleCode, missing }
    )
  }
}
