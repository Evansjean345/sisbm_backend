import type { TransactionScope } from '#domain/kernel'
import type { Trip } from '#domain/telemetry/entities/trip'
import type { TripId, VehicleId, DeviceId } from '#domain/telemetry/value_objects'
import type { NormalizedReading } from '#domain/telemetry/entities/telemetry_reading'

/**
 * Ports de persistance du contexte Télémétrie.
 *
 * Déclarés dans le DOMAINE, implémentés dans `infrastructure/`. Le domaine
 * dicte le contrat ; l'infrastructure s'y plie.
 */

export interface IngestMessageRepository {
  /** Journal des trames brutes. Idempotent sur (source, external_id). */
  record(
    input: {
      source: string
      externalId: string
      deviceIdent: string | null
      deviceId: string | null
      payload: unknown
      receivedAt: Date
    },
    tx?: TransactionScope
  ): Promise<void>

  markProcessed(externalId: string, receivedAt: Date, tx?: TransactionScope): Promise<void>
  markRejected(
    externalId: string,
    receivedAt: Date,
    error: string,
    tx?: TransactionScope
  ): Promise<void>
}

export interface PositionRepository {
  /**
   * Insertion PAR LOT, idempotente.
   * Retourne le nombre de lignes réellement insérées : les rejeux du
   * Store & Forward sont absorbés par ON CONFLICT DO NOTHING.
   */

  insertBatch(readings: NormalizedReading[], tx?: TransactionScope): Promise<number>

  /** Dernier point VALIDE — référence du contrôle de plausibilité. */
  findLastValidFix(
    deviceId: DeviceId
  ): Promise<{ latitude: number; longitude: number; recordedAt: Date } | null>

  /** Rattache les positions d'une fenêtre au trajet clôturé. */
  attachToTrip(
    vehicleId: VehicleId,
    tripId: TripId,
    from: Date,
    to: Date,
    tx?: TransactionScope
  ): Promise<number>
}

export interface VehicleLastPositionRepository {
  /** UPSERT de l'état courant. Sert 100 % du temps réel, jamais `positions`. */
  upsert(reading: NormalizedReading, tx?: TransactionScope): Promise<void>
}

export interface TripRepository {
  /** Trajet ouvert, sous verrou consultatif par véhicule. */
  findOpenByVehicle(vehicleId: VehicleId, tx?: TransactionScope): Promise<Trip | null>
  save(trip: Trip, tx?: TransactionScope): Promise<void>
  findStale(now: Date, maxDurationHours: number, limit: number): Promise<Trip[]>
}
