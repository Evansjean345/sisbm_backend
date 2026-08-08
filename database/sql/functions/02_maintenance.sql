-- =============================================================================
--  SISBM CORE — Maintenance : partitions, rétention, contrôles qualité
--  Appelées par le scheduler AdonisJS (ou pg_cron si disponible).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Création anticipée des partitions.
--    À exécuter le 1er de chaque mois. Crée les 3 mois à venir : si le job
--    saute un mois, l'ingestion continue de fonctionner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sisbm_maintain_partitions()
RETURNS TABLE (parent text, partition_name text)
LANGUAGE plpgsql AS $$
DECLARE
  v_parent text;
  v_month  date;
BEGIN
  FOREACH v_parent IN ARRAY ARRAY['positions', 'ingest_messages', 'audit_logs'] LOOP
    FOR v_month IN
      SELECT generate_series(
        date_trunc('month', now()),
        date_trunc('month', now()) + interval '3 month',
        interval '1 month'
      )::date
    LOOP
      parent := v_parent;
      partition_name := sisbm_ensure_month_partition(v_parent, v_month);
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Rétention.
--    On DETACH avant de DROP : la partition détachée reste exportable
--    (COPY ... TO) tant qu'elle n'a pas été formellement archivée.
--    Rétentions par défaut, à confirmer par SISBM :
--      positions        : 24 mois
--      ingest_messages  : 1 mois   (journal technique de rejeu)
--      audit_logs       : jamais purgé (valeur probante)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sisbm_detach_old_partitions(
  p_parent text,
  p_keep_months integer
)
RETURNS TABLE (detached text)
LANGUAGE plpgsql AS $$
DECLARE
  v_cutoff date := (date_trunc('month', now()) - make_interval(months => p_keep_months))::date;
  r record;
BEGIN
  IF p_parent = 'audit_logs' THEN
    RAISE EXCEPTION 'audit_logs ne doit jamais etre purge (valeur probante)';
  END IF;

  FOR r IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c    ON c.oid = i.inhrelid
    JOIN pg_class p    ON p.oid = i.inhparent
    WHERE p.relname = p_parent
      AND c.relname ~ (p_parent || '_[0-9]{6}$')
      AND to_date(right(c.relname, 6), 'YYYYMM') < v_cutoff
  LOOP
    EXECUTE format('ALTER TABLE %I DETACH PARTITION %I', p_parent, r.relname);
    detached := r.relname;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Contrôles qualité quotidiens (cf. doc gouvernance §e).
--    Renvoie une ligne par anomalie détectée. Un résultat vide = base saine.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sisbm_data_quality_report()
RETURNS TABLE (check_name text, severity text, details text, affected bigint)
LANGUAGE plpgsql AS $$
BEGIN
  -- trajets ouverts depuis plus de 24 h
  RETURN QUERY
  SELECT 'stale_open_trips', 'warning',
         'Trajets ouverts depuis plus de 24h (ignition OFF probablement manquant)',
         count(*)
  FROM trips WHERE status = 'open' AND started_at < now() - interval '24 hours'
  HAVING count(*) > 0;

  -- trackers muets
  RETURN QUERY
  SELECT 'silent_devices', 'warning',
         'Trackers actifs sans trame depuis plus de 6h',
         count(*)
  FROM devices
  WHERE status = 'active' AND deleted_at IS NULL
    AND (last_seen_at IS NULL OR last_seen_at < now() - interval '6 hours')
  HAVING count(*) > 0;

  -- véhicules actifs sans tracker affecté
  RETURN QUERY
  SELECT 'vehicles_without_device', 'info',
         'Véhicules actifs sans tracker affecté',
         count(*)
  FROM vehicles v
  WHERE v.status = 'active' AND v.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM device_assignments da
      WHERE da.vehicle_id = v.id AND upper_inf(da.period)
    )
  HAVING count(*) > 0;

  -- rapprochement comptable SMS : solde vs grand livre
  RETURN QUERY
  SELECT 'sms_balance_mismatch', 'critical',
         'Écart entre sms_accounts.balance_credits et la somme du grand livre',
         count(*)
  FROM (
    SELECT a.id
    FROM sms_accounts a
    LEFT JOIN (
      SELECT sms_account_id, sum(quantity) AS total FROM sms_transactions GROUP BY 1
    ) t ON t.sms_account_id = a.id
    WHERE a.balance_credits <> coalesce(t.total, 0)
  ) x
  HAVING count(*) > 0;

  -- outbox bloquée
  RETURN QUERY
  SELECT 'stuck_outbox', 'critical',
         'Messages outbox verrouillés depuis plus de 10 minutes',
         count(*)
  FROM outbox_messages
  WHERE status = 'processing' AND locked_at < now() - interval '10 minutes'
  HAVING count(*) > 0;

  -- taux de positions invalides par device (matériel suspect au-delà de 5 %)
  RETURN QUERY
  SELECT 'high_invalid_position_rate', 'warning',
         'Trackers dépassant 5 % de positions invalides sur 24h',
         count(*)
  FROM (
    SELECT device_id
    FROM positions
    WHERE recorded_at >= now() - interval '24 hours'
    GROUP BY device_id
    HAVING count(*) FILTER (WHERE NOT is_valid)::numeric / nullif(count(*), 0) > 0.05
  ) y
  HAVING count(*) > 0;
END;
$$;