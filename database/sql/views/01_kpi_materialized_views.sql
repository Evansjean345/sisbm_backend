-- =============================================================================
--  SISBM CORE — Couche OLAP : vues matérialisées pour les tableaux de bord
--  Rafraîchies la nuit en CONCURRENTLY (ne bloque pas les lecteurs).
--  Elles lisent 'trips' et 'events', JAMAIS 'positions'.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Activité quotidienne par véhicule — socle de tous les KPI de flotte
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_vehicle_daily_stats;

CREATE MATERIALIZED VIEW mv_vehicle_daily_stats AS
SELECT
  t.organization_id,
  t.vehicle_id,
  (t.started_at AT TIME ZONE 'Africa/Abidjan')::date AS activity_date,
  count(*)                                    AS trips_count,
  sum(t.distance_m) / 1000.0                  AS distance_km,
  sum(t.duration_s)                           AS driving_seconds,
  sum(t.idle_duration_s)                      AS idle_seconds,
  max(t.max_speed_kph)                        AS max_speed_kph,
  avg(t.avg_speed_kph)                        AS avg_speed_kph,
  min(t.started_at)                           AS first_departure_at,
  max(coalesce(t.ended_at, t.started_at))     AS last_arrival_at
FROM trips t
WHERE t.status = 'closed'
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX uq_mv_vehicle_daily_stats
  ON mv_vehicle_daily_stats (vehicle_id, activity_date);
CREATE INDEX idx_mv_vehicle_daily_stats_org
  ON mv_vehicle_daily_stats (organization_id, activity_date DESC);

-- ---------------------------------------------------------------------------
-- Événements quotidiens par type — alimente les graphiques d'alertes
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_event_daily_stats;

CREATE MATERIALIZED VIEW mv_event_daily_stats AS
SELECT
  e.organization_id,
  e.vehicle_id,
  e.event_type,
  e.severity,
  (e.occurred_at AT TIME ZONE 'Africa/Abidjan')::date AS activity_date,
  count(*) AS events_count
FROM events e
GROUP BY 1, 2, 3, 4, 5;

CREATE UNIQUE INDEX uq_mv_event_daily_stats
  ON mv_event_daily_stats (organization_id, vehicle_id, event_type, severity, activity_date);
CREATE INDEX idx_mv_event_daily_stats_date
  ON mv_event_daily_stats (organization_id, activity_date DESC);

-- ---------------------------------------------------------------------------
-- Consommation SMS mensuelle — module facturation (TDR §II.6)
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sms_monthly_usage;

CREATE MATERIALIZED VIEW mv_sms_monthly_usage AS
SELECT
  st.organization_id,
  st.sms_account_id,
  date_trunc('month', st.created_at AT TIME ZONE 'Africa/Abidjan')::date AS period_month,
  sum(-st.quantity)     FILTER (WHERE st.transaction_type = 'consumption') AS credits_consumed,
  sum(st.quantity)      FILTER (WHERE st.transaction_type = 'topup')       AS credits_purchased,
  sum(st.total_amount)  FILTER (WHERE st.transaction_type = 'consumption') AS cost_amount,
  count(*)              FILTER (WHERE st.transaction_type = 'consumption') AS messages_count
FROM sms_transactions st
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX uq_mv_sms_monthly_usage
  ON mv_sms_monthly_usage (sms_account_id, period_month);

-- ---------------------------------------------------------------------------
-- Rafraîchissement (tâche planifiée nocturne)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sisbm_refresh_kpi_views()
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_vehicle_daily_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_event_daily_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sms_monthly_usage;
END;
$$;