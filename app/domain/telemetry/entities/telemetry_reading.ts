import { type Coordinates, type GpsQuality, type Heading, type Speed } from '#domain/measures'
import {
  type DeviceIdent,
  type DeviceId,
  type VehicleId,
  ignitionFrom,
  type IgnitionState,
  type InvalidReason,
} from '#domain/telemetry/value_objects'
import {
  evaluateQuality,
  isBacklog,
  type PreviousFix,
  type QualityThresholds,
} from '#domain/telemetry/services/quality_filter'

/**
 * Forme destinée à la persistance. Ce que le dépôt écrit dans `positions`.
 * Volontairement plat : c'est un enregistrement, pas un objet à comportement.
 */
export interface NormalizedReading {
  organizationId: string
  deviceId: string
  vehicleId: string | null
  recordedAt: Date
  receivedAt: Date
  latitude: number
  longitude: number
  altitudeM: number | null
  speedKph: number
  headingDeg: number | null
  satellites: number | null
  hdop: number | null
  ignition: boolean | null
  movement: boolean | null
  gsmSignal: number | null
  batteryPct: number | null
  externalVoltageV: number | null
  isValid: boolean
  invalidReason: string | null
  isBacklog: boolean
  source: string
  raw: unknown
}

export interface ReadingInput {
  organizationId: string
  deviceId: DeviceId
  vehicleId: VehicleId | null
  ident: DeviceIdent
  recordedAt: Date
  receivedAt: Date
  coordinates: Coordinates
  speed: Speed
  heading: Heading | null
  quality: GpsQuality
  altitudeM?: number | null
  ignition?: boolean | null
  movement?: boolean | null
  gsmSignal?: number | null
  batteryPct?: number | null
  externalVoltageV?: number | null
  source?: string
  raw?: unknown
}

/**
 * =========================================================================
 *  TelemetryReading — une position normalisée et QUALIFIÉE
 * =========================================================================
 *
 * Immuable. Sa responsabilité tient en une phrase : porter le verdict des
 * filtres qualité et savoir se projeter pour la persistance.
 *
 * Ce n'est pas une racine d'agrégat : une position n'a pas de cycle de vie,
 * n'est jamais modifiée et ne protège aucune invariant transactionnelle. En
 * faire un agrégat serait de la cérémonie sans contrepartie.
 */
export class TelemetryReading {
  private constructor(
    private readonly input: ReadingInput,
    readonly isValid: boolean,
    readonly invalidReason: InvalidReason | null,
    readonly invalidDetail: string | null,
    readonly isBacklogFrame: boolean
  ) {}

  /**
   * Applique les filtres qualité et construit la lecture qualifiée.
   *
   * Une lecture rejetée est tout de même CONSTRUITE : elle sera persistée avec
   * `is_valid = false`. On ne détruit pas une donnée brute, on la qualifie.
   */
  static qualify(
    input: ReadingInput,
    previous: PreviousFix | null,
    thresholds: QualityThresholds,
    backlogThresholdSeconds: number,
    now: Date
  ): TelemetryReading {
    const verdict = evaluateQuality(
      { coordinates: input.coordinates, quality: input.quality, recordedAt: input.recordedAt },
      previous,
      thresholds,
      now
    )

    return new TelemetryReading(
      input,
      verdict.valid,
      verdict.valid ? null : verdict.reason,
      verdict.valid ? null : verdict.detail,
      isBacklog(input.recordedAt, input.receivedAt, backlogThresholdSeconds)
    )
  }

  get ignitionState(): IgnitionState {
    return ignitionFrom(this.input.ignition)
  }

  get recordedAt(): Date {
    return this.input.recordedAt
  }
  get coordinates(): Coordinates {
    return this.input.coordinates
  }
  get speed(): Speed {
    return this.input.speed
  }
  get vehicleId(): VehicleId | null {
    return this.input.vehicleId
  }
  get deviceId(): DeviceId {
    return this.input.deviceId
  }

  /** Éligible au flux temps réel : valide ET pas issue d'un rattrapage. */
  get isLive(): boolean {
    return this.isValid && !this.isBacklogFrame
  }

  /** Éligible à la reconstitution de trajet. */
  get countsForTrip(): boolean {
    return this.isValid && this.input.vehicleId !== null
  }

  toPersistence(): NormalizedReading {
    const i = this.input
    return {
      organizationId: i.organizationId,
      deviceId: i.deviceId.value,
      vehicleId: i.vehicleId?.value ?? null,
      recordedAt: i.recordedAt,
      receivedAt: i.receivedAt,
      latitude: i.coordinates.latitude,
      longitude: i.coordinates.longitude,
      altitudeM: i.altitudeM ?? null,
      speedKph: i.speed.kph,
      headingDeg: i.heading?.degrees ?? null,
      satellites: i.quality.satellites,
      hdop: i.quality.hdop,
      ignition: i.ignition ?? null,
      movement: i.movement ?? null,
      gsmSignal: i.gsmSignal ?? null,
      batteryPct: i.batteryPct ?? null,
      externalVoltageV: i.externalVoltageV ?? null,
      isValid: this.isValid,
      invalidReason: this.invalidReason,
      isBacklog: this.isBacklogFrame,
      source: i.source ?? 'flespi',
      raw: i.raw ?? null,
    }
  }
}
