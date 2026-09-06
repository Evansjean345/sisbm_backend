import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { TransactionScope } from '#domain/kernel'
import type { NormalizedReading } from '#domain/telemetry/entities/telemetry_reading'
import type { DeviceId, TripId, VehicleId } from '#domain/telemetry/value_objects'
import type {
  IngestMessageRepository,
  PositionRepository,
  VehicleLastPositionRepository,
} from '#domain/telemetry/repositories/telemetry_repositories'

const client = (tx?: TransactionScope) =>
  tx ? (tx.raw as TransactionClientContract) : db.connection()

// ===========================================================================
//  POSITIONS
// ===========================================================================

export class LucidPositionRepository implements PositionRepository {
  /**
   * Insertion PAR LOT, idempotente.
   *
   * Deux choix structurants :
   *
   * ① `ON CONFLICT (device_id, recorded_at) DO NOTHING` — la clé d'idempotence
   *    CM-16 absorbe les rejeux du Store & Forward. Un boîtier qui remonte
   *    deux heures de trames après une zone blanche ne duplique rien.
   *
   * ② Une seule requête pour tout le lot. À 200 points par rafale, 200
   *    requêtes séparées écrouleraient l'ingestion — et surtout tiendraient
   *    la transaction ouverte bien au-delà du `statement_timeout` de 5 s.
   *
   * Retourne le nombre de lignes RÉELLEMENT insérées : la différence avec la
   * taille du lot mesure le taux de rejeu, indicateur utile en exploitation.
   */
  async insertBatch(readings: NormalizedReading[], tx?: TransactionScope): Promise<number> {
    if (readings.length === 0) return 0

    const valeurs: unknown[] = []
    const lignes = readings.map((r) => {
      valeurs.push(
        r.organizationId,
        r.deviceId,
        r.vehicleId,
        r.recordedAt.toISOString(),
        r.receivedAt.toISOString(),
        // ST_MakePoint attend (longitude, latitude) — l'ordre inverse de
        // l'usage courant. L'intervertir place toute la flotte en Antarctique.
        r.longitude,
        r.latitude,
        r.altitudeM,
        r.speedKph,
        r.headingDeg,
        r.satellites,
        r.hdop,
        r.ignition,
        r.movement,
        r.gsmSignal,
        r.batteryPct,
        r.externalVoltageV,
        r.isValid,
        r.invalidReason,
        r.isBacklog
      )
      // Knex utilise « ? » pour les bindings positionnels, PAS la syntaxe
      // « $1 » de PostgreSQL : celle-ci produit « Expected N bindings, saw 0 ».
      return `(?, ?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'flespi')`
    })

    const resultat = await client(tx).rawQuery(
      `INSERT INTO positions (
         organization_id, device_id, vehicle_id, recorded_at, received_at,
         location, altitude_m, speed_kph, heading_deg, satellites, hdop,
         ignition, movement, gsm_signal, battery_pct, external_voltage_v,
         is_valid, invalid_reason, is_backlog, source
       ) VALUES ${lignes.join(',')}
       ON CONFLICT (device_id, recorded_at) DO NOTHING`,
      valeurs as never
    )
    return resultat.rowCount ?? 0
  }

  /**
   * Dernier point VALIDE — référence du contrôle de plausibilité.
   *
   * Le filtre `is_valid` est essentiel : prendre le dernier point tout court
   * ferait d'une position aberrante le repère de comparaison, ce qui
   * rejetterait ensuite les points corrects. L'erreur se propagerait.
   *
   * La borne sur `recorded_at` force le *partition pruning* : sans elle, la
   * requête scanne toutes les partitions mensuelles.
   */
  async findLastValidFix(
    deviceId: DeviceId
  ): Promise<{ latitude: number; longitude: number; recordedAt: Date } | null> {
    const r = await db.rawQuery(
      `SELECT ST_Y(location::geometry) AS latitude,
              ST_X(location::geometry) AS longitude,
              recorded_at
         FROM positions
        WHERE device_id = :device
          AND is_valid
          AND recorded_at >= now() - interval '7 days'
        ORDER BY recorded_at DESC
        LIMIT 1`,
      { device: deviceId.value }
    )
    const l = r.rows?.[0]
    if (!l) return null
    return {
      latitude: Number(l.latitude),
      longitude: Number(l.longitude),
      recordedAt: new Date(l.recorded_at),
    }
  }

  /**
   * Rattache au trajet les positions de sa fenêtre temporelle.
   *
   * `trip_id` est la SEULE colonne que le rôle applicatif peut mettre à jour
   * sur `positions` (cf. `01_roles_and_grants.sql`) : la table reste
   * append-only pour tout le reste.
   */
  async attachToTrip(
    vehicleId: VehicleId,
    tripId: TripId,
    from: Date,
    to: Date,
    tx?: TransactionScope
  ): Promise<number> {
    const r = await client(tx).rawQuery(
      `UPDATE positions
          SET trip_id = :trip
        WHERE vehicle_id = :vehicle
          AND recorded_at >= :from
          AND recorded_at <= :to
          AND trip_id IS NULL`,
      {
        trip: tripId.value,
        vehicle: vehicleId.value,
        from: from.toISOString(),
        to: to.toISOString(),
      }
    )
    return r.rowCount ?? 0
  }
}

// ===========================================================================
//  DERNIER ÉTAT CONNU
// ===========================================================================

export class LucidVehicleLastPositionRepository implements VehicleLastPositionRepository {
  /**
   * UPSERT de l'état courant — une ligne par véhicule.
   *
   * C'est cette table qui sert 100 % du temps réel : la carte de supervision
   * lit N lignes, jamais les millions de `positions`.
   *
   * La garde `WHERE recorded_at < EXCLUDED.recorded_at` est indispensable :
   * une rafale de Store & Forward peut livrer un point ANCIEN après un point
   * récent. Sans elle, l'état courant régresserait dans le passé.
   */
  async upsert(r: NormalizedReading, tx?: TransactionScope): Promise<void> {
    await client(tx).rawQuery(
      `INSERT INTO vehicle_last_positions (
         vehicle_id, organization_id, device_id, recorded_at, received_at,
         location, speed_kph, heading_deg, ignition, movement,
         gsm_signal, battery_pct, external_voltage_v, connection_state, updated_at
       ) VALUES (
         :vehicle, :org, :device, :recordedAt, :receivedAt,
         ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
         :speed, :heading, :ignition, :movement,
         :gsm, :battery, :voltage, 'online', now()
       )
       ON CONFLICT (vehicle_id) DO UPDATE SET
         device_id = EXCLUDED.device_id,
         recorded_at = EXCLUDED.recorded_at,
         received_at = EXCLUDED.received_at,
         location = EXCLUDED.location,
         speed_kph = EXCLUDED.speed_kph,
         heading_deg = EXCLUDED.heading_deg,
         ignition = EXCLUDED.ignition,
         movement = EXCLUDED.movement,
         gsm_signal = EXCLUDED.gsm_signal,
         battery_pct = EXCLUDED.battery_pct,
         external_voltage_v = EXCLUDED.external_voltage_v,
         connection_state = 'online',
         updated_at = now()
       WHERE vehicle_last_positions.recorded_at < EXCLUDED.recorded_at`,
      {
        vehicle: r.vehicleId,
        org: r.organizationId,
        device: r.deviceId,
        recordedAt: r.recordedAt.toISOString(),
        receivedAt: r.receivedAt.toISOString(),
        lng: r.longitude,
        lat: r.latitude,
        speed: r.speedKph,
        heading: r.headingDeg,
        ignition: r.ignition,
        movement: r.movement,
        gsm: r.gsmSignal,
        battery: r.batteryPct,
        voltage: r.externalVoltageV,
      } as never
    )
  }
}

// ===========================================================================
//  JOURNAL D'INGESTION
// ===========================================================================

export class LucidIngestMessageRepository implements IngestMessageRepository {
  /**
   * Journal des trames brutes, idempotent sur `(source, external_id)`.
   *
   * Il permet deux choses irremplaçables : rejouer après correction d'un bug
   * du parseur, et exploiter a posteriori les trames arrivées avant
   * l'enregistrement d'un boîtier. Rétention 30 jours.
   *
   * ⚠ `received_at` fait partie de la clé de partitionnement : il doit figurer
   * dans toutes les clauses, y compris les mises à jour.
   */
  async record(
    input: {
      source: string
      externalId: string
      deviceIdent: string | null
      deviceId: string | null
      payload: unknown
      receivedAt: Date
    },
    tx?: TransactionScope
  ): Promise<void> {
    await client(tx).rawQuery(
      `INSERT INTO ingest_messages
         (source, external_id, device_ident, device_id, received_at, status, payload)
       VALUES (:source, :externalId, :ident, :device, :receivedAt, 'pending', :payload)
       ON CONFLICT (source, external_id, received_at) DO NOTHING`,
      {
        source: input.source,
        externalId: input.externalId,
        ident: input.deviceIdent,
        device: input.deviceId,
        receivedAt: input.receivedAt.toISOString(),
        payload: JSON.stringify(input.payload ?? {}),
      } as never
    )
  }

  async markProcessed(externalId: string, receivedAt: Date, tx?: TransactionScope): Promise<void> {
    await client(tx).rawQuery(
      `UPDATE ingest_messages
          SET status = 'processed', processed_at = now()
        WHERE external_id = :externalId AND received_at = :receivedAt`,
      { externalId, receivedAt: receivedAt.toISOString() }
    )
  }

  async markRejected(
    externalId: string,
    receivedAt: Date,
    error: string,
    tx?: TransactionScope
  ): Promise<void> {
    await client(tx).rawQuery(
      `UPDATE ingest_messages
          SET status = 'rejected', processed_at = now(), error_message = :error
        WHERE external_id = :externalId AND received_at = :receivedAt`,
      { externalId, receivedAt: receivedAt.toISOString(), error: error.slice(0, 500) } as never
    )
  }

  /** Trames à rejouer sur une fenêtre — utilisé par `sisbm:replay`. */
  async findForReplay(input: {
    from: Date
    to: Date
    deviceIdent?: string
    limit: number
  }): Promise<Array<{ externalId: string; receivedAt: Date; payload: unknown }>> {
    const r = await db.rawQuery(
      `SELECT external_id, received_at, payload
         FROM ingest_messages
        WHERE received_at >= :from
          AND received_at <= :to
          ${input.deviceIdent ? 'AND device_ident = :ident' : ''}
        ORDER BY received_at
        LIMIT :limit`,
      {
        from: input.from.toISOString(),
        to: input.to.toISOString(),
        ident: input.deviceIdent ?? null,
        limit: input.limit,
      } as never
    )
    return (r.rows ?? []).map((l: Record<string, unknown>) => ({
      externalId: String(l.external_id),
      receivedAt: new Date(l.received_at as string),
      payload: l.payload,
    }))
  }
}

export const nowSql = () => DateTime.now().toSQL()
