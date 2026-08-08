/**
 * =========================================================================
 *  NOYAU DU DOMAINE — couche la plus interne
 * =========================================================================
 *
 * Briques génériques dont héritent tous les contextes métier : entités,
 * racines d'agrégat, objets-valeurs, événements, résultats et erreurs.
 *
 * Cette couche ne connaît RIEN : ni AdonisJS, ni Lucid, ni HTTP, ni
 * PostgreSQL. C'est la règle de dépendance de la Clean Architecture — tout
 * pointe vers l'intérieur, l'intérieur ne pointe vers rien.
 *
 * Contrôle mécanique :
 *     grep -rl "@adonisjs" app/domain/     doit être vide
 */

// ---------------------------------------------------------------------------
// Identifiant
// ---------------------------------------------------------------------------

/**
 * Identifiant typé. Empêche de passer un VehicleId là où un DeviceId est attendu,
 * alors que les deux sont des uuid au runtime.
 */
export abstract class Identifier<T extends string = string> {
  protected constructor(public readonly value: string) {
    if (!Identifier.isUuid(value)) {
      throw new Error(`Identifiant invalide : ${value}`)
    }
  }

  static isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  }

  equals(other?: Identifier<T>): boolean {
    return other instanceof Identifier && this.value === other.value
  }

  toString(): string {
    return this.value
  }

  toJSON(): string {
    return this.value
  }
}

// ---------------------------------------------------------------------------
// Value Object
// ---------------------------------------------------------------------------
/**
 * Objet-valeur : immuable, sans identité, comparé par valeur.
 * La validation se fait dans le constructeur — un VO existant est toujours valide.
 */
export abstract class ValueObject<T extends Record<string, unknown>> {
  protected constructor(protected readonly props: T) {
    Object.freeze(this.props) // immuable
  }

  equals(other?: ValueObject<T>): boolean {
    if (other === undefined || other === null) return false
    if (other.constructor !== this.constructor) return false
    return JSON.stringify(this.props) === JSON.stringify(other.props)
  }
}

// ---------------------------------------------------------------------------
// Événement de domaine
// ---------------------------------------------------------------------------

export interface DomainEvent {
  readonly eventName: string
  readonly occurredAt: Date
  readonly aggregateId: string
  readonly payload: Record<string, unknown>
}

export abstract class BaseDomainEvent implements DomainEvent {
  readonly occurredAt: Date

  protected constructor(
    public readonly eventName: string,
    public readonly aggregateId: string,
    public readonly payload: Record<string, unknown>
  ) {
    this.occurredAt = new Date()
  }
}

// ---------------------------------------------------------------------------
// Entité et racine d'agrégat
// ---------------------------------------------------------------------------

export abstract class Entity<TId extends Identifier> {
  constructor(public readonly id: TId) {}

  equals(other?: Entity<TId>): boolean {
    if (!other) return false
    if (other.constructor !== this.constructor) return false
    return this.id.equals(other.id)
  }
}

/**
 * Racine d'agrégat : seul point d'entrée pour modifier l'agrégat, et seule
 * frontière transactionnelle. Les événements accumulés ici sont publiés par
 * l'Unit of Work APRÈS le commit (via l'outbox), jamais pendant.
 */
export abstract class AggregateRoot<TId extends Identifier> extends Entity<TId> {
  #domainEvents: DomainEvent[] = []

  protected addDomainEvent(event: DomainEvent): void {
    this.#domainEvents.push(event)
  }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this.#domainEvents]
    this.#domainEvents = []
    return events
  }

  get hasDomainEvents(): boolean {
    return this.#domainEvents.length > 0
  }
}

// ---------------------------------------------------------------------------
// Result — erreurs métier explicites, sans exception
// ---------------------------------------------------------------------------
/**
 * Une règle métier violée n'est pas un incident technique : c'est un résultat
 * attendu du système. On la retourne, on ne la lance pas. Les exceptions
 * restent réservées aux pannes (base indisponible, bug).
 *
 * Conséquence directe : le compilateur force l'appelant à traiter le cas
 * d'échec, ce qu'un `throw` ne fait jamais.
 */
export type Result<T, E extends DomainError = DomainError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const Err = <E extends DomainError>(error: E): Result<never, E> => ({ ok: false, error })

export function isOk<T, E extends DomainError>(
  result: Result<T, E>
): result is { ok: true; value: T } {
  return result.ok
}

/** Déballe un Result ; lève si l'appelant s'est trompé de branche. */
export function unwrap<T, E extends DomainError>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`unwrap() sur un Result en erreur : ${result.error.code}`)
  }
  return result.value
}

// ---------------------------------------------------------------------------
// Erreurs de domaine
// ---------------------------------------------------------------------------

/**
 * Erreur métier. `code` est stable et documenté : il sert de contrat d'API
 * et de clé de traduction. Le message est destiné aux humains, jamais parsé.
 */
export abstract class DomainError {
  abstract readonly code: string
  abstract readonly httpStatus: number

  protected constructor(
    readonly message: string,
    readonly details: Record<string, unknown> = {}
  ) {}

  toJSON() {
    return { code: this.code, message: this.message, details: this.details }
  }
}

export class BusinessRuleViolation extends DomainError {
  readonly code: string
  readonly httpStatus = 422

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message, details)
    this.code = code
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'E_NOT_FOUND'
  readonly httpStatus = 404

  constructor(ressource: string, id: string) {
    super(`${ressource} introuvable`, { ressource, id })
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'E_FORBIDDEN'
  readonly httpStatus = 403

  constructor(message = 'Action non autorisée', details: Record<string, unknown> = {}) {
    super(message, details)
  }
}

export class ConflictError extends DomainError {
  readonly code = 'E_CONFLICT'
  readonly httpStatus = 409

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details)
  }
}

// ---------------------------------------------------------------------------
// Frontière transactionnelle
// ---------------------------------------------------------------------------

/**
 * Poignée de transaction, volontairement OPAQUE.
 *
 * Elle est déclarée dans le domaine parce que les ports de dépôt en ont
 * besoin dans leur signature, et qu'un port du domaine ne peut pas importer
 * la couche application sans inverser la règle de dépendance.
 *
 * `raw` est typé `unknown` : le domaine sait qu'une transaction existe, il
 * ignore totalement que c'est un client Lucid.
 */
export interface TransactionScope {
  readonly raw: unknown
  /** Collecte les événements d'un agrégat pour publication post-commit. */
  collect(events: DomainEvent[]): void
}
