import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { TransactionScope } from '#domain/kernel'
import { Coordinates, Distance, Speed } from '#domain/measures'
import { Trip } from '#domain/telemetry/entities/trip'
import {
  DeviceId,
  TripId,
  VehicleId,
  type TripCloseReason,
  type TripStatus,
} from '#domain/telemetry/value_objects'
import type { TripRepository } from '#domain/telemetry/repositories/telemetry_repositories'

const client = (tx?: TransactionScope) =>
  tx ? (tx.raw as TransactionClientContract) : db.connection()

/** Une seule chaîne SQL de projection : évite les divergences entre méthodes. */
const COLONNES = `
  id, organization_id, vehicle_id, device_id, status,
  started_at, ended_at, last_point_at,
  ST_Y(start_location::geometry) AS start_lat,
  ST_X(start_location::geometry) AS start_lng,
  ST_Y(end_location::geometry)   AS end_lat,
  ST_X(end_location::geometry)   AS end_lng,
  distance_m, duration_s, idle_duration_s,
  max_speed_kph, avg_speed_kph, positions_count, close_reason`

export class LucidTripRepository implements TripRepository {
  /**
   * Trajet ouvert du véhicule, SOUS VERROU.
   *
   * `pg_advisory_xact_lock` sérialise les workers sur un même véhicule : sans
   * lui, deux rafales concurrentes ouvriraient deux trajets, et l'index unique
   * partiel `WHERE status = 'open'` ferait échouer la seconde transaction en
   * plein traitement — perte de la rafale entière.
   *
   * Le verrou consultatif est PRÉFÉRABLE à un `SELECT ... FOR UPDATE` ici :
   * il fonctionne même quand aucune ligne n'existe encore, ce qui est
   * précisément le cas au démarrage d'un trajet.
   *
   * `hashtextextended` transforme l'uuid en `bigint`, seul type accepté par
   * la fonction. Le verrou est libéré automatiquement au COMMIT.
   */
  async findOpenByVehicle(vehicleId: VehicleId, tx?: TransactionScope): Promise<Trip | null> {
    const c = client(tx)

    if (tx) {
      await c.rawQuery(`SELECT pg_advisory_xact_lock(hashtextextended(:v, 0))`, {
        v: vehicleId.value,
      })
    }

    const r = await c.rawQuery(
      `SELECT ${COLONNES} FROM trips WHERE vehicle_id = :v AND status = 'open' LIMIT 1`,
      { v: vehicleId.value }
    )
    const l = r.rows?.[0]
    return l ? this.versDomaine(l) : null
  }

  async save(trip: Trip, tx?: TransactionScope): Promise<void> {
    const s = trip.snapshot()

    await client(tx).rawQuery(
      `INSERT INTO trips (
         id, organization_id, vehicle_id, device_id, status,
         started_at, ended_at, last_point_at,
         start_location, end_location,
         distance_m, duration_s, idle_duration_s,
         max_speed_kph, avg_speed_kph, positions_count, close_reason
       ) VALUES (
         :id, :org, :vehicle, :device, :status,
         :startedAt, :endedAt, :lastPointAt,
         ST_SetSRID(ST_MakePoint(:startLng, :startLat), 4326)::geography,
         ST_SetSRID(ST_MakePoint(:endLng, :endLat), 4326)::geography,
         :distance, :duration, :idle,
         :maxSpeed, :avgSpeed, :count, :closeReason
       )
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         ended_at = EXCLUDED.ended_at,
         last_point_at = EXCLUDED.last_point_at,
         end_location = EXCLUDED.end_location,
         distance_m = EXCLUDED.distance_m,
         duration_s = EXCLUDED.duration_s,
         idle_duration_s = EXCLUDED.idle_duration_s,
         max_speed_kph = EXCLUDED.max_speed_kph,
         avg_speed_kph = EXCLUDED.avg_speed_kph,
         positions_count = EXCLUDED.positions_count,
         close_reason = EXCLUDED.close_reason,
         updated_at = now()`,
      {
        id: s.id,
        org: s.organizationId,
        vehicle: s.vehicleId,
        device: s.deviceId,
        status: s.status,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        lastPointAt: s.lastPointAt.toISOString(),
        startLng: s.startLocation.longitude,
        startLat: s.startLocation.latitude,
        endLng: s.endLocation.longitude,
        endLat: s.endLocation.latitude,
        distance: s.distanceMeters,
        duration: s.durationSeconds,
        idle: s.idleSeconds,
        maxSpeed: s.maxSpeedKph,
        avgSpeed: s.avgSpeedKph,
        count: s.positionsCount,
        closeReason: s.closeReason,
      } as never
    )
  }

  /**
   * Trajets restés ouverts au-delà du délai — le contact OFF s'est perdu.
   *
   * Balayés par la tâche planifiée `close_stale_trips`. Sans elle, un trajet
   * orphelin bloque indéfiniment l'ouverture du suivant, à cause de l'index
   * unique partiel : le véhicule cesse silencieusement de produire des trajets.
   */
  async findStale(now: Date, maxDurationHours: number, limit: number): Promise<Trip[]> {
    const r = await db.rawQuery(
      `SELECT ${COLONNES}
         FROM trips
        WHERE status = 'open'
          AND last_point_at < :cutoff
        ORDER BY last_point_at
        LIMIT :limit`,
      {
        cutoff: new Date(now.getTime() - maxDurationHours * 3_600_000).toISOString(),
        limit,
      } as never
    )
    return (r.rows ?? []).map((l: Record<string, unknown>) => this.versDomaine(l))
  }

  // -------------------------------------------------------------------------

  private versDomaine(l: Record<string, unknown>): Trip {
    const distance = Distance.trusted(Number(l.distance_m ?? 0))
    const count = Number(l.positions_count ?? 0)
    const avg = Number(l.avg_speed_kph ?? 0)

    return Trip.rehydrate(TripId.from(String(l.id)), {
      organizationId: String(l.organization_id),
      vehicleId: VehicleId.from(String(l.vehicle_id)),
      deviceId: l.device_id ? DeviceId.from(String(l.device_id)) : null,
      status: String(l.status) as TripStatus,
      startedAt: new Date(l.started_at as string),
      endedAt: l.ended_at ? new Date(l.ended_at as string) : null,
      startLocation: Coordinates.trusted(Number(l.start_lat), Number(l.start_lng)),
      endLocation: Coordinates.trusted(Number(l.end_lat), Number(l.end_lng)),
      lastPointAt: new Date((l.last_point_at ?? l.started_at) as string),
      distance,
      maxSpeed: Speed.trusted(Number(l.max_speed_kph ?? 0)),
      // `speedSum` n'est pas stocké : on le reconstitue depuis la moyenne pour
      // que l'accumulation reprenne correctement après rechargement.
      speedSum: avg * count,
      positionsCount: count,
      idleSeconds: Number(l.idle_duration_s ?? 0),
      closeReason: (l.close_reason as TripCloseReason | null) ?? null,
    })
  }
}
