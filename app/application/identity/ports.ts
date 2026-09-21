import type { TransactionScope } from '#application/ports'
import type { AssignableRole } from '#domain/identity/role_policy'

/**
 * =========================================================================
 *  PORTS DU CONTEXTE IDENTITÉ
 * =========================================================================
 *
 * Le contexte Identité reste PRAGMATIQUE pour la lecture et le CRUD simple
 * (contrôleur → Lucid, cf. docs/03 §3). La CRÉATION d'une organisation et de
 * ses comptes est en revanche promue en cas d'usage, pour trois raisons :
 *
 *  - elle est transactionnelle (organisation + administrateur : tout ou rien) ;
 *  - elle porte une règle de sécurité (cloisonnement, non-escalade des rôles) ;
 *  - elle doit rester testable sans base, comme la tranche `security`.
 *
 * Tous les paramètres `tx` sont optionnels : hors transaction, l'adaptateur
 * utilise la connexion par défaut.
 */

// ---------------------------------------------------------------------------
// Données échangées
// ---------------------------------------------------------------------------

export interface OrganizationData {
  code: string
  name: string
  contactEmail: string | null
  contactPhone: string | null
  countryCode: string
  timezone: string
  currency: string
  isActive: boolean
  settings: Record<string, unknown>
}

export interface OrganizationRecord extends OrganizationData {
  id: string
  createdAt: Date
}

export type UserStatus = 'pending' | 'active' | 'suspended'

export interface UserAccountData {
  organizationId: string
  roleId: string
  email: string
  passwordHash: string
  fullName: string
  phone: string | null
  status: UserStatus
  locale: string
  timezone: string
}

/** Vue d'un compte renvoyée par les cas d'usage — jamais l'empreinte du mot de passe. */
export interface UserAccountRecord {
  id: string
  organizationId: string
  roleId: string
  email: string
  fullName: string
  phone: string | null
  status: UserStatus
  locale: string
  timezone: string
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface OrganizationRepository {
  /** Recherche parmi les organisations NON supprimées (index unique partiel). */
  codeExists(code: string, tx?: TransactionScope): Promise<boolean>
  findById(id: string, tx?: TransactionScope): Promise<OrganizationRecord | null>
  insert(id: string, data: OrganizationData, tx?: TransactionScope): Promise<OrganizationRecord>
}

export interface UserAccountRepository {
  /** Unicité GLOBALE de l'e-mail (l'identifiant de connexion ne porte pas l'organisation). */
  emailExists(email: string, tx?: TransactionScope): Promise<boolean>
  insert(id: string, data: UserAccountData, tx?: TransactionScope): Promise<UserAccountRecord>
}

export interface RoleCatalog {
  findById(roleId: string, tx?: TransactionScope): Promise<AssignableRole | null>
  /** Rôle système (global) par son code : `admin`, `supervisor`… */
  findSystemRole(code: string, tx?: TransactionScope): Promise<AssignableRole | null>
}

/**
 * Hachage du mot de passe. Port dédié : le cas d'usage ne dépend pas de
 * l'algorithme (scrypt aujourd'hui, argon2 demain), et un test n'a pas à
 * payer 100 ms de dérivation de clé.
 */
export interface PasswordHasher {
  make(plain: string): Promise<string>
}
