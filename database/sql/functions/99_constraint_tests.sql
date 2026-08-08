-- =============================================================================
--  SISBM CORE — Tests des contraintes critiques
--  Chaque bloc DOIT lever l'exception annoncée. Si un bloc passe sans erreur,
--  la contrainte correspondante est absente ou inopérante.
--  Exécution : psql -d sisbm_core -f 99_constraint_tests.sql
-- =============================================================================

BEGIN;

-- ------------------------------------------------------------------ fixtures
INSERT INTO organizations (id, code, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'sisbm', 'SISBM');

INSERT INTO users (id, organization_id, role_id, email, password_hash, full_name)
SELECT '22222222-2222-2222-2222-222222222222',
       '11111111-1111-1111-1111-111111111111', r.id,
       'admin@sisbm.ci', 'x', 'Admin'
FROM roles r WHERE r.code = 'admin';

INSERT INTO users (id, organization_id, role_id, email, password_hash, full_name)
SELECT '33333333-3333-3333-3333-333333333333',
       '11111111-1111-1111-1111-111111111111', r.id,
       'sup@sisbm.ci', 'x', 'Superviseur'
FROM roles r WHERE r.code = 'supervisor';

INSERT INTO vehicles (id, organization_id, registration) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1234 AB 01'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '5678 CD 01');

INSERT INTO devices (id, organization_id, imei, model, has_relay) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '868120200000001', 'MV730', true);

-- =============================================================================
-- CM-01 : un tracker ne peut pas équiper deux véhicules simultanément
-- =============================================================================
INSERT INTO device_assignments (device_id, vehicle_id, period)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', tstzrange(now(), NULL));

DO $$
BEGIN
  INSERT INTO device_assignments (device_id, vehicle_id, period)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000002', tstzrange(now(), NULL));
  RAISE EXCEPTION 'ECHEC CM-01 : double affectation acceptee';
EXCEPTION WHEN exclusion_violation THEN
  RAISE NOTICE 'OK CM-01 : double affectation rejetee';
END $$;

-- =============================================================================
-- CM-16 : idempotence Store & Forward — rejeu sans doublon
-- =============================================================================
INSERT INTO positions (organization_id, device_id, vehicle_id, recorded_at, location, speed_kph)
VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', now(),
        ST_SetSRID(ST_MakePoint(-4.0083, 5.3600), 4326)::geography, 42.5);

INSERT INTO positions (organization_id, device_id, vehicle_id, recorded_at, location, speed_kph)
SELECT organization_id, device_id, vehicle_id, recorded_at, location, speed_kph
FROM positions
ON CONFLICT (device_id, recorded_at) DO NOTHING;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM positions;
  IF n <> 1 THEN RAISE EXCEPTION 'ECHEC CM-16 : % lignes au lieu de 1', n; END IF;
  RAISE NOTICE 'OK CM-16 : rejeu idempotent';
END $$;

-- =============================================================================
-- CM-06 : un seul trajet ouvert par véhicule
-- =============================================================================
INSERT INTO trips (organization_id, vehicle_id, started_at)
VALUES ('11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '1 hour');

DO $$
BEGIN
  INSERT INTO trips (organization_id, vehicle_id, started_at)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'aaaaaaaa-0000-0000-0000-000000000001', now());
  RAISE EXCEPTION 'ECHEC CM-06 : deux trajets ouverts acceptes';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'OK CM-06 : second trajet ouvert rejete';
END $$;

-- =============================================================================
-- CM-07 : PAS DE COUPURE MOTEUR AU-DESSUS DU SEUIL DE SECURITE
-- =============================================================================
DO $$
BEGIN
  INSERT INTO device_commands (organization_id, device_id, vehicle_id, command_type,
                               status, reason, requested_by, speed_at_request_kph)
  VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', 'engine_cut',
          'approved', 'Vehicule signale vole', '22222222-2222-2222-2222-222222222222', 90);
  RAISE EXCEPTION 'ECHEC CM-07 : coupure a 90 km/h acceptee';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'OK CM-07 : coupure a 90 km/h rejetee';
END $$;

-- la même commande à l'arrêt doit passer
INSERT INTO device_commands (id, organization_id, device_id, vehicle_id, command_type,
                             status, reason, requested_by, validated_by, validated_at,
                             speed_at_request_kph)
VALUES ('cccccccc-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'engine_cut',
        'approved', 'Vehicule signale vole', '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333', now(), 0);

-- =============================================================================
-- CM-09 : une seule commande en vol par tracker
-- =============================================================================
DO $$
BEGIN
  INSERT INTO device_commands (organization_id, device_id, command_type, status,
                               reason, requested_by, speed_at_request_kph)
  VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
          'engine_cut', 'pending_validation', 'Seconde demande concurrente',
          '22222222-2222-2222-2222-222222222222', 0);
  RAISE EXCEPTION 'ECHEC CM-09 : deux commandes en vol acceptees';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'OK CM-09 : seconde commande en vol rejetee';
END $$;

-- =============================================================================
-- Séparation des rôles : le valideur ne peut pas être le demandeur
-- =============================================================================
DO $$
BEGIN
  UPDATE device_commands
  SET validated_by = requested_by
  WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'ECHEC four-eyes : auto-validation acceptee';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'OK four-eyes : auto-validation rejetee';
END $$;

-- =============================================================================
-- CM-08 : motif obligatoire et substantiel
-- =============================================================================
DO $$
BEGIN
  INSERT INTO device_commands (organization_id, device_id, command_type, reason, requested_by)
  VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
          'locate', '  ', '22222222-2222-2222-2222-222222222222');
  RAISE EXCEPTION 'ECHEC CM-08 : motif vide accepte';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'OK CM-08 : motif vide rejete';
END $$;

-- =============================================================================
-- CM-10 : le solde SMS ne peut pas devenir négatif
-- =============================================================================
INSERT INTO sms_accounts (id, organization_id, provider, balance_credits, unit_price_amount)
VALUES ('dddddddd-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'local_gateway', 100, 25);

DO $$
BEGIN
  UPDATE sms_accounts SET balance_credits = balance_credits - 200
  WHERE id = 'dddddddd-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'ECHEC CM-10 : solde negatif accepte';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'OK CM-10 : solde negatif rejete';
END $$;

-- =============================================================================
-- CM-13 : affectation geofence = véhicule OU groupe, pas les deux
-- =============================================================================
INSERT INTO geofences (id, organization_id, name, kind, geom)
VALUES ('eeeeeeee-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'Zone Port Abidjan', 'authorized',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(-4.0083, 5.2800), 4326)::geography, 1500)::geometry)::geography);

INSERT INTO vehicle_groups (id, organization_id, name)
VALUES ('ffffffff-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'Agence Abidjan');

DO $$
BEGIN
  INSERT INTO geofence_assignments (geofence_id, vehicle_id, vehicle_group_id)
  VALUES ('eeeeeeee-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'ECHEC CM-13 : double cible acceptee';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'OK CM-13 : double cible rejetee';
END $$;

-- =============================================================================
-- CM-15 : dédoublonnage des événements
-- =============================================================================
INSERT INTO events (organization_id, vehicle_id, event_type, severity, occurred_at, dedup_key)
VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
        'overspeed', 'warning', now(), 'overspeed:aaaaaaaa:20260803T1200');

DO $$
DECLARE n integer;
BEGIN
  INSERT INTO events (organization_id, vehicle_id, event_type, severity, occurred_at, dedup_key)
  VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
          'overspeed', 'warning', now(), 'overspeed:aaaaaaaa:20260803T1200')
  ON CONFLICT (dedup_key) DO NOTHING;
  SELECT count(*) INTO n FROM events;
  IF n <> 1 THEN RAISE EXCEPTION 'ECHEC CM-15 : % evenements', n; END IF;
  RAISE NOTICE 'OK CM-15 : evenement dedoublonne';
END $$;

-- =============================================================================
-- Requête géospatiale : le véhicule est-il dans la zone ?
-- =============================================================================
DO $$
DECLARE inside boolean;
BEGIN
  SELECT ST_Covers(g.geom, ST_SetSRID(ST_MakePoint(-4.0083, 5.2805), 4326)::geography)
  INTO inside FROM geofences g WHERE g.id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF NOT inside THEN RAISE EXCEPTION 'ECHEC PostGIS : point attendu dans la zone'; END IF;
  RAISE NOTICE 'OK PostGIS : ST_Covers operationnel';
END $$;

-- =============================================================================
-- Format E.164 imposé sur les canaux SMS / WhatsApp
-- =============================================================================
DO $$
BEGIN
  INSERT INTO notifications (organization_id, channel, recipient_address, body)
  VALUES ('11111111-1111-1111-1111-111111111111', 'sms', '0161899990', 'test');
  RAISE EXCEPTION 'ECHEC E.164 : numero national accepte';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'OK E.164 : numero non normalise rejete';
END $$;

ROLLBACK;