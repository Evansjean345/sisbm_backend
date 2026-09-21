import { Identifier, ValueObject, Ok, DomainError, type Result } from '#domain/kernel'

// ---------------------------------------------------------------------------
// Identifiants
// ---------------------------------------------------------------------------

export class VehicleId extends Identifier<'VehicleId'> {
  static from(v: string): VehicleId {
    return new VehicleId(v)
  }
}

export class DeviceId extends Identifier<'DeviceId'> {
  static from(v: string): DeviceId {
    return new DeviceId(v)
  }
}

export class TripId extends Identifier<'TripId'> {
  static from(v: string): TripId {
    return new TripId(v)
  }
}

// ---------------------------------------------------------------------------
// Identifiant boîtier (IMEI)
// ---------------------------------------------------------------------------

export class InvalidIdentError extends DomainError {
  readonly code = 'E_INVALID_IDENT'
  readonly httpStatus = 422
  constructor(value: string) {
    super(`Identifiant de boîtier invalide : ${value}`, { value })
  }
}

/**
 * Identifiant transmis par Flespi.
 *
 * Flespi préfixe l'IMEI d'un `0` pour les boîtiers Micodus. On normalise à
 * l'entrée : la base ne contient que des IMEI à 15 chiffres, et une même carte
 * SIM ne peut pas produire deux boîtiers distincts selon la présence du zéro.
 */
export class DeviceIdent extends ValueObject<{ imei: string }> {
  private constructor(imei: string) {
    super({ imei })
  }

  static create(raw: string): Result<DeviceIdent> {
    const trimmed = (raw ?? '').trim()
    //const normalized = trimmed.length === 16 && trimmed.startsWith('0') ? trimmed.slice(1) : trimmed

    /*
    if (!/^\d{15}$/.test(normalized)) {
      return Err(new InvalidIdentError(raw))
    } */
    return Ok(new DeviceIdent(trimmed))
    //return Ok(new DeviceIdent(normalized))
  }

  static trusted(imei: string): DeviceIdent {
    return new DeviceIdent(imei)
  }

  get imei(): string {
    return this.props.imei
  }

  /** Forme attendue par l'API Flespi pour les boîtiers Micodus. */
  get flespiIdent(): string {
    return `0${this.props.imei}`
  }

  toString(): string {
    return this.props.imei
  }
}

// ---------------------------------------------------------------------------
// Motifs de rejet — liste fermée
// ---------------------------------------------------------------------------

/**
 * Un point rejeté est CONSERVÉ avec son motif, jamais supprimé. Le motif est
 * une liste fermée : il alimente les statistiques de qualité par boîtier
 * (`sisbm_data_quality_report`) et permet de rejouer avec d'autres seuils.
 */

export const INVALID_REASONS = [
  'null_island',
  'invalid_fix',
  'poor_hdop',
  'few_satellites',
  'implausible_jump',
  'future_timestamp',
] as const

export type InvalidReason = (typeof INVALID_REASONS)[number]

export const INVALID_REASON_LABELS: Record<InvalidReason, string> = {
  null_island: 'Coordonnées nulles — perte de fix GPS',
  invalid_fix: 'Le boîtier signale une position non fiable',
  poor_hdop: 'Dilution de précision horizontale trop élevée',
  few_satellites: 'Nombre de satellites insuffisant',
  implausible_jump: 'Déplacement physiquement impossible depuis le point précédent',
  future_timestamp: 'Horodatage dans le futur — horloge du boîtier déréglée',
}

// ---------------------------------------------------------------------------
// État du contact
// ---------------------------------------------------------------------------

export type IgnitionState = 'on' | 'off' | 'unknown'

export function ignitionFrom(value: boolean | null | undefined): IgnitionState {
  if (value === true) return 'on'
  if (value === false) return 'off'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Statuts de trajet
// ---------------------------------------------------------------------------

export const TRIP_STATUSES = ['open', 'closed', 'orphan'] as const
export type TripStatus = (typeof TRIP_STATUSES)[number]

export const TRIP_CLOSE_REASONS = ['ignition_off', 'timeout', 'manual', 'device_removed'] as const
export type TripCloseReason = (typeof TRIP_CLOSE_REASONS)[number]
