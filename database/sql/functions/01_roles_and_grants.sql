-- =============================================================================
--  SISBM CORE — Rôles PostgreSQL et privilèges
--  À exécuter UNE FOIS par le superutilisateur, APRÈS les migrations.
--  Remplacer les mots de passe par des secrets générés (jamais commités).
-- =============================================================================

-- ---------------------------------------------------------------- rôles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sisbm_app') THEN
    CREATE ROLE sisbm_app      LOGIN PASSWORD 'CHANGE_ME_APP';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sisbm_readonly') THEN
    CREATE ROLE sisbm_readonly LOGIN PASSWORD 'CHANGE_ME_RO';
  END IF;
END $$;

-- ---------------------------------------------------------------- base
GRANT CONNECT ON DATABASE sisbm_core TO sisbm_app, sisbm_readonly;
GRANT USAGE   ON SCHEMA public       TO sisbm_app, sisbm_readonly;

-- ---------------------------------------------------------------- application
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO sisbm_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO sisbm_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sisbm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sisbm_app;

-- ---------------------------------------------------------------- APPEND-ONLY
-- Transforme une règle de gouvernance en garantie technique :
-- même une erreur de code ne peut pas effacer une preuve.
REVOKE UPDATE, DELETE ON positions        FROM sisbm_app;
REVOKE UPDATE, DELETE ON audit_logs       FROM sisbm_app;
REVOKE UPDATE, DELETE ON sms_transactions FROM sisbm_app;
REVOKE         DELETE ON events           FROM sisbm_app;
REVOKE UPDATE, DELETE ON device_command_logs FROM sisbm_app;
REVOKE         DELETE ON incident_timeline   FROM sisbm_app;

-- positions : seule exception, l'ingestion doit pouvoir rattacher un trip_id
-- a posteriori lors de la clôture d'un trajet.
GRANT UPDATE (trip_id) ON positions TO sisbm_app;

-- ---------------------------------------------------------------- lecture seule
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sisbm_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sisbm_readonly;

-- ---------------------------------------------------------------- garde-fous
-- Aucune transaction applicative ne doit dépasser 5 s : une transaction longue
-- sur 'positions' fait exploser la table par accumulation de tuples morts.
ALTER ROLE sisbm_app      SET statement_timeout = '5s';
ALTER ROLE sisbm_app      SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE sisbm_readonly SET statement_timeout = '60s';
ALTER ROLE sisbm_app      SET timezone = 'UTC';
ALTER ROLE sisbm_readonly SET timezone = 'UTC';