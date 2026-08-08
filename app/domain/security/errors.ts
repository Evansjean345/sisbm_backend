import { DomainError } from '#domain/kernel'

/**
 * Erreurs du contexte Sécurité.
 *
 * Chaque `code` est un contrat : il apparaît dans les réponses d'API, dans les
 * journaux d'audit et dans les traductions du front. On n'en change jamais un
 * sans le traiter comme un changement d'API.
 */
export class UnsafeSpeedError extends DomainError {
  readonly code = 'E_UNSAFE_SPEED'
  readonly httpStatus = 422

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details)
  }
}

/**
 * Contrainte CM-07 — la plus importante de la plateforme.
 * Couper le moteur d'un véhicule lancé est un risque humain, pas un bug.
 */
export class VehicleInMotionError extends DomainError {
  readonly code = 'E_VEHICLE_IN_MOTION'
  readonly httpStatus = 422

  constructor(currentKph: number, limitKph: number) {
    super(
      `Immobilisation refusée : le véhicule roule à ${currentKph} km/h ` +
        `(seuil de sécurité ${limitKph} km/h). La commande ne peut être exécutée ` +
        `qu'à l'arrêt ou à vitesse résiduelle.`,
      { currentKph, limitKph }
    )
  }
}

export class InvalidReasonError extends DomainError {
  readonly code = 'E_INVALID_REASON'
  readonly httpStatus = 422

  constructor(message: string) {
    super(message)
  }
}

/** Séparation des rôles : le valideur ne peut pas être le demandeur. */
export class SelfValidationError extends DomainError {
  readonly code = 'E_SELF_VALIDATION'
  readonly httpStatus = 403

  constructor(actorId: string) {
    super(
      "Le valideur d'une immobilisation ne peut pas être son demandeur. " +
        'Un second opérateur habilité doit intervenir.',
      { actorId }
    )
  }
}

/** Contrainte CM-09 : une seule commande en vol par tracker. */
export class CommandAlreadyInFlightError extends DomainError {
  readonly code = 'E_COMMAND_IN_FLIGHT'
  readonly httpStatus = 409

  constructor(deviceId: string, existingCommandId: string) {
    super(
      'Une commande est déjà en cours sur ce tracker. ' +
        'Attendre son aboutissement ou l’annuler avant d’en émettre une nouvelle.',
      { deviceId, existingCommandId }
    )
  }
}

export class InvalidTransitionError extends DomainError {
  readonly code = 'E_INVALID_TRANSITION'
  readonly httpStatus = 409

  constructor(from: string, to: string) {
    super(`Transition impossible : ${from} -> ${to}`, { from, to })
  }
}

export class CommandExpiredError extends DomainError {
  readonly code = 'E_COMMAND_EXPIRED'
  readonly httpStatus = 409

  constructor(expiredAt: Date) {
    super(
      'La commande a expiré et ne peut plus être exécutée. Émettre une nouvelle demande ' +
        'afin que la vitesse du véhicule soit revérifiée.',
      { expiredAt: expiredAt.toISOString() }
    )
  }
}

export class ImmobilizationDisabledError extends DomainError {
  readonly code = 'E_IMMOBILIZATION_DISABLED'
  readonly httpStatus = 403

  constructor(vehicleId: string) {
    super(
      "L'immobilisation n'est pas activée pour ce véhicule. " +
        'Elle doit être habilitée explicitement, après test sur véhicule réel.',
      { vehicleId }
    )
  }
}

export class DeviceNotEquippedError extends DomainError {
  readonly code = 'E_DEVICE_NO_RELAY'
  readonly httpStatus = 422

  constructor(deviceId: string) {
    super("Le tracker installé ne dispose pas d'un relais de coupure moteur.", { deviceId })
  }
}

export class StalePositionError extends DomainError {
  readonly code = 'E_STALE_POSITION'
  readonly httpStatus = 422

  constructor(ageSeconds: number, maxAgeSeconds: number) {
    super(
      `La dernière position connue date de ${ageSeconds} s (maximum toléré ${maxAgeSeconds} s). ` +
        "Impossible de garantir que le véhicule est à l'arrêt.",
      { ageSeconds, maxAgeSeconds }
    )
  }
}
