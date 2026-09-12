import type { DomainError, DomainEvent, Result, TransactionScope } from '#domain/kernel'

export type { TransactionScope } from '#domain/kernel'

/**
 * Ports de la couche application.
 *
 * Ce sont des INTERFACES. Les implémentations vivent dans `infrastructure/`
 * et sont branchées dans `start/container.ts`. C'est l'inversion de dépendance :
 * l'application déclare ce dont elle a besoin, l'infrastructure s'y conforme.
 *
 * Bénéfice concret : un cas d'usage se teste sans base de données, sans Redis
 * et sans Flespi — on injecte des doubles en mémoire.
 */

// ---------------------------------------------------------------------------
// Cas d'usage
// ---------------------------------------------------------------------------

/**
 * Un cas d'usage = une intention métier = une transaction.
 * Pas de `getVehicleAndAlsoUpdateItAndSendMail` : une intention, un objet.
 */

export interface UseCase<TInput, TOutput, TError extends DomainError = DomainError> {
  execute(input: TInput): Promise<Result<TOutput, TError>>
}

/** Contexte d'exécution : qui agit, pour quelle organisation, depuis où. */
export interface ExecutionContext {
  readonly actorId: string | null
  readonly actorType: 'user' | 'system' | 'policy' | 'api'
  readonly organizationId: string
  readonly ip?: string
  readonly userAgent?: string
  readonly requestId?: string
}

// ---------------------------------------------------------------------------
// Unit of Work
// ---------------------------------------------------------------------------
export type IsolationLevel = 'read committed' | 'repeatable read' | 'serializable'

/**
 * Frontière transactionnelle explicite.
 *
 * Le niveau d'isolation est un paramètre du cas d'usage, pas une constante
 * globale : l'ingestion de positions tourne en `read committed`, une commande
 * d'immobilisation en `serializable` (cf. doc modélisation §2-c).
 *
 * Les événements de domaine collectés pendant la transaction sont écrits dans
 * l'outbox AVANT le commit, et publiés seulement après. Aucun appel réseau
 * n'est fait à l'intérieur de la transaction.
 */
export interface UnitOfWork {
  run<T>(
    handler: (tx: TransactionScope) => Promise<T>,
    options?: { isolationLevel?: IsolationLevel }
  ): Promise<T>
}

// ---------------------------------------------------------------------------
// Services techniques
// ---------------------------------------------------------------------------

/**
 * Le temps est une dépendance, pas un fait global.
 * Sans ce port, toute règle temporelle (expiration d'une commande, fenêtre
 * horaire, cooldown d'une politique) devient intestable sans attendre.
 */
export interface Clock {
  now(): Date
}

export interface IdGenerator {
  generate(): string
}

/** Publication des événements de domaine — implémentée par l'outbox. */
export interface EventPublisher {
  publish(events: DomainEvent[], tx?: TransactionScope): Promise<void>
}

/** Journalisation d'audit (TDR §II.5 « journalisation complète »). */
export interface AuditLogger {
  record(entry: {
    context: ExecutionContext
    action: string
    resourceType: string
    resourceId?: string
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }): Promise<void>
}

/**
 * Lecture des permissions d'un rôle.
 *
 * Déclaré en couche application pour que la présentation n'ait jamais à
 * toucher la base : l'implémentation Lucid vit dans `infrastructure/`.
 */
export interface PermissionReader {
  readPermissions(roleId: string): Promise<string[]>
}
