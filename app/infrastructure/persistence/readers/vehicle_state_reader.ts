import db from '@adonisjs/lucid/services/db'
import { Speed } from '#domain/security/value_objects'
import type { VehicleSafetyState, VehicleStateReader } from '#application/security/ports'

/**
 * Adaptateur de lecture inter-contextes : Télémétrie → Sécurité.
 *
 * Le contexte Sécurité déclare le port dont il a besoin ; c'est la Télémétrie
 * qui l'implémente. On ne traverse jamais la frontière en important l'agrégat
 * d'en face.
 *
 * La lecture se fait sur `vehicle_last_positions` (une ligne par véhicule),
 * jamais sur `positions` : une décision de sécurité ne peut pas dépendre du
 * scan d'une table partitionnée.
 *
 * Requête écrite en SQL brut : la jointure sur l'affectation COURANTE utilise
 * `upper_inf(period)` sur un tstzrange, que le query builder ne sait pas
 * exprimer dans une clause ON.
 */
export class LucidVehicleStateReader implements VehicleStateReader {
  async readSafetyState(vehicleId: string): Promise<VehicleSafetyState | null> {
    const result = await db.rawQuery(
      `SELECT
         v.id                       AS vehicle_id,
         v.immobilization_enabled,
         d.id                       AS device_id,
         d.has_relay,
         p.speed_kph,
         p.ignition,
         p.recorded_at
       FROM vehicles v
       LEFT JOIN vehicle_last_positions p ON p.vehicle_id = v.id
       LEFT JOIN device_assignments da    ON da.vehicle_id = v.id AND upper_inf(da.period)
       LEFT JOIN devices d                ON d.id = da.device_id
       WHERE v.id = :vehicleId
         AND v.deleted_at IS NULL
       LIMIT 1`,
      { vehicleId }
    )

    const row = result.rows?.[0]
    if (!row) return null

    return {
      vehicleId: row.vehicle_id,
      deviceId: row.device_id ?? null,
      // `trusted` : la valeur vient de la base, déjà bornée par un CHECK SQL.
      speed: Speed.trusted(Number(row.speed_kph ?? 0)),
      ignition: row.ignition ?? null,
      recordedAt: row.recorded_at ? new Date(row.recorded_at) : new Date(0),
      immobilizationEnabled: Boolean(row.immobilization_enabled),
      deviceHasRelay: Boolean(row.has_relay),
    }
  }
}
