import db from '@adonisjs/lucid/services/db'
import type {
  ActivityDay,
  ActivityQuery,
  ActivityReader,
  ActivityReport,
} from '#application/admin/ports'

type Row = Record<string, unknown> & { day: string | Date }

/**
 * Séries journalières du tableau de bord admin.
 *
 * Une requête GROUP BY par source, fusionnées en mémoire sur le jour — plus
 * lisible qu'un unique `generate_series` à dix jointures, et chaque requête
 * profite de son propre index / partition pruning :
 *
 *   positions        → partition par mois sur `recorded_at`
 *   trips            → idx_trips_org_started
 *   device_commands  → requested_at
 *   alerts           → triggered_at
 *
 * `count(DISTINCT vehicle_id)` sur `positions` est la requête la plus coûteuse
 * (≈ 7 M lignes / mois pour 100 véhicules) : c'est la raison du plafond de
 * 90 jours imposé par le validateur.
 */
export class LucidActivityReader implements ActivityReader {
  async daily(query: ActivityQuery): Promise<ActivityReport> {
    const days = Math.min(Math.max(Math.trunc(query.days), 1), 90)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const from = new Date(today.getTime() - (days - 1) * 86_400_000)
    const to = new Date(today.getTime() + 86_400_000)

    const org = query.organizationId ?? null
    const scope = (column = 'organization_id') => (org ? `AND ${column} = :org` : '')
    const bindings = { from, to, org } as never
    const jour = (column: string) =>
      `to_char(date_trunc('day', ${column} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`

    const [positions, trips, commands, alerts, created, bases] = await Promise.all([
      this.rows(
        `SELECT ${jour('recorded_at')} AS day,
                count(*) AS positions,
                count(DISTINCT vehicle_id) AS vehicles
           FROM positions
          WHERE recorded_at >= :from AND recorded_at < :to AND is_valid ${scope()}
          GROUP BY 1`,
        bindings
      ),
      this.rows(
        `SELECT ${jour('started_at')} AS day,
                count(*) AS trips,
                COALESCE(sum(distance_m), 0) / 1000.0 AS km
           FROM trips
          WHERE started_at >= :from AND started_at < :to ${scope()}
          GROUP BY 1`,
        bindings
      ),
      this.rows(
        `SELECT ${jour('requested_at')} AS day,
                count(*) AS total,
                count(*) FILTER (WHERE status = 'acknowledged') AS acknowledged,
                count(*) FILTER (WHERE status IN ('failed', 'expired')) AS failed
           FROM device_commands
          WHERE requested_at >= :from AND requested_at < :to ${scope()}
          GROUP BY 1`,
        bindings
      ),
      this.rows(
        `SELECT ${jour('triggered_at')} AS day, count(*) AS alerts
           FROM alerts
          WHERE triggered_at >= :from AND triggered_at < :to ${scope()}
          GROUP BY 1`,
        bindings
      ),
      this.rows(
        ['vehicles', 'devices', 'users']
          .map(
            (t) =>
              `SELECT '${t}' AS kind, ${jour('created_at')} AS day, count(*) AS n
                 FROM ${t}
                WHERE deleted_at IS NULL AND created_at >= :from AND created_at < :to ${scope()}
                GROUP BY 2`
          )
          .join(' UNION ALL '),
        bindings
      ),
      this.rows(
        ['vehicles', 'devices', 'users']
          .map(
            (t) =>
              `SELECT '${t}' AS kind, count(*) AS n
                 FROM ${t}
                WHERE deleted_at IS NULL AND created_at < :from ${scope()}`
          )
          .join(' UNION ALL '),
        bindings
      ),
    ])

    const by = (rows: Row[]) => new Map(rows.map((r) => [String(r.day), r]))
    const p = by(positions)
    const t = by(trips)
    const c = by(commands)
    const a = by(alerts)
    const n = (v: unknown) => Number(v ?? 0)

    const creations = new Map<string, Record<string, number>>()
    for (const r of created) {
      const jourCle = String(r.day)
      const ligne = creations.get(jourCle) ?? {}
      ligne[String(r.kind)] = n(r.n)
      creations.set(jourCle, ligne)
    }
    const totaux: Record<string, number> = { vehicles: 0, devices: 0, users: 0 }
    for (const r of bases) totaux[String(r.kind)] = n(r.n)

    const serie: ActivityDay[] = []
    for (let i = 0; i < days; i++) {
      const date = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10)
      const cr = creations.get(date) ?? {}
      const cmd = c.get(date)
      const total = n(cmd?.total)
      const acknowledged = n(cmd?.acknowledged)
      const failed = n(cmd?.failed)

      totaux.vehicles += n(cr.vehicles)
      totaux.devices += n(cr.devices)
      totaux.users += n(cr.users)

      serie.push({
        date,
        positions: n(p.get(date)?.positions),
        activeVehicles: n(p.get(date)?.vehicles),
        trips: n(t.get(date)?.trips),
        distanceKm: Math.round(n(t.get(date)?.km) * 10) / 10,
        commands: {
          total,
          acknowledged,
          failed,
          other: Math.max(total - acknowledged - failed, 0),
        },
        alerts: n(a.get(date)?.alerts),
        created: { vehicles: n(cr.vehicles), devices: n(cr.devices), users: n(cr.users) },
        totals: { ...totaux } as ActivityDay['totals'],
      })
    }

    return { from: from.toISOString(), to: to.toISOString(), days: serie }
  }

  private async rows(sql: string, bindings: never): Promise<Row[]> {
    const resultat = await db.rawQuery(sql, bindings)
    return (resultat.rows ?? []) as Row[]
  }
}
