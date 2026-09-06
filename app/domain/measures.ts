import { ValueObject, Ok, Err, BusinessRuleViolation, type Result } from '#domain/kernel'

/**
 * =========================================================================
 *  MESURES PHYSIQUES — objets-valeurs partagés
 * =========================================================================
 *
 * Ces objets sont utilisés par PLUSIEURS contextes : la télémétrie mesure une
 * vitesse, la sécurité la compare à un seuil. Les laisser dans l'un des deux
 * créerait un couplage arbitraire entre contextes métier.
 *
 * L'unité est portée par le TYPE, pas seulement par le nom de la variable.
 * C'est ce qui rend impossible de comparer par erreur des km/h à des m/s.
 */

export class InvalidMeasureError extends BusinessRuleViolation {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('E_INVALID_MEASURE', message, details)
  }
}

// ---------------------------------------------------------------------------
// Vitesse
// ---------------------------------------------------------------------------

export class Speed extends ValueObject<{ kph: number }> {
  static readonly MAX_KPH = 400

  private constructor(kph: number) {
    super({ kph })
  }

  static fromKph(kph: number): Result<Speed> {
    if (!Number.isFinite(kph) || kph < 0 || kph > Speed.MAX_KPH) {
      return Err(new InvalidMeasureError(`Vitesse hors domaine : ${kph} km/h`, { kph }))
    }
    return Ok(new Speed(kph))
  }

  /** Valeur déjà validée (relecture depuis la base, bornée par un CHECK SQL). */
  static trusted(kph: number): Speed {
    return new Speed(kph)
  }

  static zero(): Speed {
    return new Speed(0)
  }

  get kph(): number {
    return this.props.kph
  }

  get mps(): number {
    return this.props.kph / 3.6
  }

  isAtOrBelow(other: Speed): boolean {
    return this.props.kph <= other.props.kph
  }

  isAbove(other: Speed): boolean {
    return this.props.kph > other.props.kph
  }

  toString(): string {
    return `${this.props.kph} km/h`
  }
}

// ---------------------------------------------------------------------------
// Coordonnées
// ---------------------------------------------------------------------------

export class Coordinates extends ValueObject<{ latitude: number; longitude: number }> {
  private constructor(latitude: number, longitude: number) {
    super({ latitude, longitude })
  }

  static create(latitude: number, longitude: number): Result<Coordinates> {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return Err(new InvalidMeasureError(`Latitude hors domaine : ${latitude}`, { latitude }))
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return Err(new InvalidMeasureError(`Longitude hors domaine : ${longitude}`, { longitude }))
    }
    return Ok(new Coordinates(latitude, longitude))
  }

  static trusted(latitude: number, longitude: number): Coordinates {
    return new Coordinates(latitude, longitude)
  }

  get latitude(): number {
    return this.props.latitude
  }

  get longitude(): number {
    return this.props.longitude
  }

  /**
   * Point nul : perte de fix GPS. Le boîtier émet des zéros plutôt que rien.
   * Techniquement une coordonnée valide (golfe de Guinée, au large d'Abidjan),
   * ce qui la rend d'autant plus piégeuse : sans ce contrôle, la flotte entière
   * semble converger vers un point en mer.
   */

  get isNullIsland(): boolean {
    return this.props.latitude === 0 && this.props.longitude === 0
  }

  /**
   * Distance orthodromique en mètres (formule de haversine).
   *
   * Utilisée uniquement pour le filtre de plausibilité, à l'ingestion : il faut
   * une réponse en microsecondes, sans aller-retour vers PostGIS. Les calculs
   * de distance qui comptent — kilométrage d'un trajet, distance à une zone —
   * restent délégués à PostGIS, qui tient compte de l'ellipsoïde.
   */
  distanceTo(other: Coordinates): number {
    const R = 6_371_000
    const toRad = (d: number) => (d * Math.PI) / 180
    const dLat = toRad(other.latitude - this.latitude)
    const dLon = toRad(other.longitude - this.longitude)
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(this.latitude)) * Math.cos(toRad(other.latitude)) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
  }

  toString(): string {
    return `${this.props.latitude},${this.props.longitude}`
  }
}

// ---------------------------------------------------------------------------
// Cap
// ---------------------------------------------------------------------------
export class Heading extends ValueObject<{ degrees: number }> {
  private constructor(degrees: number) {
    super({ degrees })
  }

  static fromDegrees(degrees: number): Result<Heading> {
    if (!Number.isFinite(degrees) || degrees < 0 || degrees >= 360) {
      return Err(new InvalidMeasureError(`Cap hors domaine : ${degrees}°`, { degrees }))
    }
    return Ok(new Heading(degrees))
  }

  static trusted(degrees: number): Heading {
    return new Heading(degrees)
  }

  get degrees(): number {
    return this.props.degrees
  }
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------
export class Distance extends ValueObject<{ meters: number }> {
  private constructor(meters: number) {
    super({ meters })
  }

  static fromMeters(meters: number): Result<Distance> {
    if (!Number.isFinite(meters) || meters < 0) {
      return Err(new InvalidMeasureError(`Distance négative : ${meters} m`, { meters }))
    }
    return Ok(new Distance(meters))
  }

  static trusted(meters: number): Distance {
    return new Distance(meters)
  }

  static zero(): Distance {
    return new Distance(0)
  }

  get meters(): number {
    return this.props.meters
  }

  get kilometers(): number {
    return this.props.meters / 1000
  }

  plus(other: Distance): Distance {
    return new Distance(this.props.meters + other.props.meters)
  }
}

// ---------------------------------------------------------------------------
// Qualité du point GPS
// ---------------------------------------------------------------------------
export class GpsQuality extends ValueObject<{
  hdop: number | null
  satellites: number | null
  isValidFix: boolean
}> {
  private constructor(hdop: number | null, satellites: number | null, isValidFix: boolean) {
    super({ hdop, satellites, isValidFix })
  }

  static create(input: {
    hdop?: number | null
    satellites?: number | null
    isValidFix?: boolean | null
  }): GpsQuality {
    return new GpsQuality(input.hdop ?? null, input.satellites ?? null, input.isValidFix ?? true)
  }

  get hdop(): number | null {
    return this.props.hdop
  }

  get satellites(): number | null {
    return this.props.satellites
  }

  get isValidFix(): boolean {
    return this.props.isValidFix
  }

  /**
   * `hdop` et `satellites` peuvent être absents : tous les protocoles ne les
   * transmettent pas. Une valeur absente n'est pas une valeur mauvaise — on ne
   * rejette que sur une information positive de mauvaise qualité.
   */
  meets(maxHdop: number, minSatellites: number): boolean {
    if (!this.props.isValidFix) return false
    if (this.props.hdop !== null && this.props.hdop > maxHdop) return false
    if (this.props.satellites !== null && this.props.satellites < minSatellites) return false
    return true
  }
}
