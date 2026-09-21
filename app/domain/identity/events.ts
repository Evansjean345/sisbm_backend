import { BaseDomainEvent } from '#domain/kernel'

/**
 * Événements du contexte Identité.
 *
 * Écrits dans `outbox_messages` DANS la transaction de création, publiés après
 * le commit. Ils permettront au Jalon suivant (notification) d'envoyer le
 * courriel de bienvenue sans risque de l'envoyer pour un compte dont la
 * création a finalement échoué.
 *
 * Aucune donnée secrète dans la charge utile : ni mot de passe, ni empreinte.
 */
export class OrganizationCreated extends BaseDomainEvent {
  constructor(organizationId: string, payload: { code: string; name: string }) {
    super('identity.organization.created', organizationId, payload)
  }
}

export class UserAccountCreated extends BaseDomainEvent {
  constructor(
    userId: string,
    payload: { organizationId: string; email: string; roleCode: string; status: string }
  ) {
    super('identity.user.created', userId, payload)
  }
}
