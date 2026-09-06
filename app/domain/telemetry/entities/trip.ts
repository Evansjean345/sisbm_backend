import { AggregateRoot, Ok, Err, DomainError, type Result } from '#domain/kernel'
import { type Coordinates, Distance, type Speed } from '#domain/measures'
import {
  type TripId,
  type VehicleId,
  type DeviceId,
  type TripCloseReason,
  type TripStatus,
} from '#domain/telemetry/value_objects'
import { TripStarted, TripClosed } from '#domain/telemetry/events'

export class TripAlreadyClosedError extends DomainError {
  readonly code = 'E_TRIP_ALREADY_CLOSED'
  readonly httpStatus = 409
  constructor(tripId: string) {
    super('Ce trajet est déjà clôturé', { tripId })
  }
}

export class OutOfOrderPositionError extends DomainError {
  readonly code = 'E_OUT_OF_ORDER_POSITION'
  readonly httpStatus = 422
  constructor(at: Date, lastAt: Date) {
    super('Position antérieure au dernier point du trajet', {
      at: at.toISOString(),
      lastAt: lastAt.toISOString(),
    })
  }
}

interface TripProps {
  organizationId: string
  vehicleId: VehicleId
  deviceId: DeviceId | null
  status: TripStatus
  startedAt: Date
  endedAt: Date | null
  startLocation: Coordinates
  endLocation: Coordinates
  lastPointAt: Date
  distance: Distance
  maxSpeed: Speed
  speedSum: number
  positionsCount: number
  idleSeconds: number
  closeReason: TripCloseReason | null
}

/**
 * =========================================================================
 *  AGRÉGAT Trip — reconstitution d'un trajet
 * =========================================================================
 *
 * Un trajet naît sur un contact ON, s'enrichit à chaque position valide,
 * et meurt sur un contact OFF ou par expiration.
 *
 * Pourquoi un agrégat et non un simple calcul SQL : le trajet porte de vraies
 * invariants — distance monotone croissante, points strictement ordonnés,
 * clôture unique. Les recalculer par requête à chaque affichage coûterait un
 * scan de `positions` ; les accumuler ici les fige une fois pour toutes, ce qui
 * rend `trips` directement exploitable par les rapports (couche OLAP).
 *
 * La contrainte « un seul trajet ouvert par véhicule » est doublée en base par
 * un index unique partiel (CM-06) : l'agrégat produit le message, la base
 * garantit l'impossibilité.
 */

export class Trip extends AggregateRoot<TripId> {
  private constructor(
    id: TripId,
    private props: TripProps
  ) {
    super(id)
  }

  // ------------------------------------------------------------- ouverture

  static start(input: {
    id: TripId
    organizationId: string
    vehicleId: VehicleId
    deviceId: DeviceId | null
    at: Date
    location: Coordinates
    speed: Speed
  }): Trip {
    const trip = new Trip(input.id, {
      organizationId: input.organizationId,
      vehicleId: input.vehicleId,
      deviceId: input.deviceId,
      status: 'open',
      startedAt: input.at,
      endedAt: null,
      startLocation: input.location,
      endLocation: input.location,
      lastPointAt: input.at,
      distance: Distance.zero(),
      maxSpeed: input.speed,
      speedSum: input.speed.kph,
      positionsCount: 1,
      idleSeconds: 0,
      closeReason: null,
    })

    trip.addDomainEvent(
      new TripStarted(trip.id.value, {
        vehicleId: input.vehicleId.value,
        startedAt: input.at.toISOString(),
      })
    )

    return trip
  }

  static rehydrate(id: TripId, props: TripProps): Trip {
    return new Trip(id, props)
  }

  // ------------------------------------------------------------- accumulation

  /**
   * Ajoute une position valide.
   *
   * La distance est accumulée point à point plutôt que calculée en ligne droite
   * entre départ et arrivée : c'est la seule façon d'obtenir un kilométrage
   * réel sur un trajet non rectiligne.
   */

  addPosition(input: {
    at: Date
    location: Coordinates
    speed: Speed
    idleThresholdKph: number
  }): Result<void> {
    if (this.props.status !== 'open') {
      return Err(new TripAlreadyClosedError(this.id.value))
    }

    // Un rejeu de Store & Forward peut livrer un point antérieur : on le
    // conserve en base, mais on ne le laisse pas corrompre les agrégats.

    if (input.at.getTime() < this.props.lastPointAt.getTime()) {
      return Err(new OutOfOrderPositionError(input.at, this.props.lastPointAt))
    }

    const seconds = (input.at.getTime() - this.props.lastPointAt.getTime()) / 1000
    const meters = this.props.endLocation.distanceTo(input.location)

    this.props.distance = this.props.distance.plus(Distance.trusted(meters))
    this.props.endLocation = input.location
    this.props.lastPointAt = input.at
    this.props.positionsCount += 1
    this.props.speedSum += input.speed.kph

    if (input.speed.isAbove(this.props.maxSpeed)) {
      this.props.maxSpeed = input.speed
    }

    if (input.speed.kph <= input.idleThresholdKph) {
      this.props.idleSeconds += Math.max(0, Math.round(seconds))
    }

    return Ok(undefined)
  }

  // ------------------------------------------------------------- clôture

  close(input: { at: Date; reason: TripCloseReason; minDistanceMeters: number }): Result<void> {
    if (this.props.status !== 'open') {
      return Err(new TripAlreadyClosedError(this.id.value))
    }

    this.props.status = 'closed'
    this.props.endedAt = input.at
    this.props.closeReason = input.reason

    /**
     * Un trajet sous le seuil de distance est un démarrage sans déplacement :
     * livraison, contrôle moteur, manœuvre de stationnement. Le conserver
     * comme trajet fausserait les statistiques d'exploitation — on le marque
     * `orphan` plutôt que de le supprimer, pour garder la trace du contact.
     */
    if (this.props.distance.meters < input.minDistanceMeters) {
      this.props.status = 'orphan'
    }

    this.addDomainEvent(
      new TripClosed(this.id.value, {
        vehicleId: this.props.vehicleId.value,
        status: this.props.status,
        distanceMeters: Math.round(this.props.distance.meters),
        durationSeconds: this.durationSeconds ?? 0,
        maxSpeedKph: this.props.maxSpeed.kph,
        closeReason: input.reason,
      })
    )
    return Ok(undefined)
  }

  /** Trajet resté ouvert au-delà du délai maximal : le contact OFF s'est perdu. */
  isStale(now: Date, maxDurationHours: number): boolean {
    if (this.props.status !== 'open') return false
    const hours = (now.getTime() - this.props.lastPointAt.getTime()) / 3_600_000
    return hours >= maxDurationHours
  }

  // ------------------------------------------------------------- lecture

  get status(): TripStatus {
    return this.props.status
  }
  get vehicleId(): VehicleId {
    return this.props.vehicleId
  }
  get distance(): Distance {
    return this.props.distance
  }
  get maxSpeed(): Speed {
    return this.props.maxSpeed
  }
  get positionsCount(): number {
    return this.props.positionsCount
  }

  get durationSeconds(): number | null {
    if (!this.props.endedAt) return null
    return Math.round((this.props.endedAt.getTime() - this.props.startedAt.getTime()) / 1000)
  }

  get averageSpeedKph(): number {
    return this.props.positionsCount === 0
      ? 0
      : Math.round((this.props.speedSum / this.props.positionsCount) * 100) / 100
  }

  snapshot() {
    return {
      id: this.id.value,
      organizationId: this.props.organizationId,
      vehicleId: this.props.vehicleId.value,
      deviceId: this.props.deviceId?.value ?? null,
      status: this.props.status,
      startedAt: this.props.startedAt,
      endedAt: this.props.endedAt,
      startLocation: this.props.startLocation,
      endLocation: this.props.endLocation,
      lastPointAt: this.props.lastPointAt,
      distanceMeters: Math.round(this.props.distance.meters * 100) / 100,
      durationSeconds: this.durationSeconds,
      idleSeconds: this.props.idleSeconds,
      maxSpeedKph: this.props.maxSpeed.kph,
      avgSpeedKph: this.averageSpeedKph,
      positionsCount: this.props.positionsCount,
      closeReason: this.props.closeReason,
    }
  }
}
