import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Domaine télémétrie — le coeur chaud de la plateforme.
 *
 * positions       : partitionnée par mois sur recorded_at (~7 M lignes/mois pour 100 véhicules)
 * clé d'idempotence (device_id, recorded_at) : rend le Store & Forward rejouable sans doublon
 * vehicle_last_positions : sert 100 % du temps réel, jamais 'positions'
 * trips           : pré-agrégation OLAP, calculée une fois à la clôture
 */
export default class extends BaseSchema {
  async up() {
    // ------------------------------------------------------------------ ingestion
    this.schema.raw(
      `
      CREATE TABLE ingest_messages (
        id            bigint GENERATED ALWAYS AS IDENTITY,
        source        text NOT NULL DEFAULT 'flespi',
        external_id   text NOT NULL,
        device_ident  text,
        device_id     uuid REFERENCES devices (id) ON DELETE SET NULL,
        received_at   timestamptz NOT NULL DEFAULT now(),
        processed_at  timestamptz,
        status        text NOT NULL DEFAULT 'pending',
        error_message text,
        payload       jsonb NOT NULL,
        PRIMARY KEY (id, received_at),
        CONSTRAINT ck_ingest_messages_source CHECK (source IN ('flespi','manual','replay')),
        CONSTRAINT ck_ingest_messages_status CHECK (status IN ('pending','processed','duplicate','rejected'))
      ) PARTITION BY RANGE (received_at);

      CREATE UNIQUE INDEX uq_ingest_messages_external ON ingest_messages (source, external_id, received_at);
      CREATE INDEX idx_ingest_messages_pending ON ingest_messages (received_at) WHERE status = 'pending';
    `
    )

    // ------------------------------------------------------------------ positions
    this.schema.raw(
      `
      CREATE TABLE positions (
        id                bigint GENERATED ALWAYS AS IDENTITY,
        organization_id   uuid NOT NULL,
        device_id         uuid NOT NULL,
        vehicle_id        uuid,
        trip_id           uuid,
        recorded_at       timestamptz NOT NULL,
        received_at       timestamptz NOT NULL DEFAULT now(),
        location          geography(Point, 4326) NOT NULL,
        altitude_m        numeric(7,2),
        speed_kph         numeric(6,2),
        heading_deg       numeric(5,2),
        satellites        smallint,
        hdop              numeric(5,2),
        ignition          boolean,
        movement          boolean,
        gsm_signal        smallint,
        battery_pct       numeric(5,2),
        external_voltage_v numeric(6,2),
        is_valid          boolean NOT NULL DEFAULT true,
        invalid_reason    text,
        is_backlog        boolean NOT NULL DEFAULT false,
        source            text NOT NULL DEFAULT 'flespi',
        raw               jsonb,
        PRIMARY KEY (id, recorded_at),
        CONSTRAINT ck_positions_speed     CHECK (speed_kph IS NULL OR (speed_kph >= 0 AND speed_kph <= 400)),
        CONSTRAINT ck_positions_heading   CHECK (heading_deg IS NULL OR (heading_deg >= 0 AND heading_deg < 360)),
        CONSTRAINT ck_positions_hdop      CHECK (hdop IS NULL OR hdop >= 0),
        CONSTRAINT ck_positions_sats      CHECK (satellites IS NULL OR satellites BETWEEN 0 AND 64),
        CONSTRAINT ck_positions_battery   CHECK (battery_pct IS NULL OR battery_pct BETWEEN 0 AND 100),
        CONSTRAINT ck_positions_invalid   CHECK (is_valid OR invalid_reason IS NOT NULL)
      ) PARTITION BY RANGE (recorded_at);
    `
    )

    /**
     * Clé d'idempotence du Store & Forward (contrainte CM-16).
     * Permet INSERT ... ON CONFLICT (device_id, recorded_at) DO NOTHING
     * lors du rejeu des trames mémorisées après une zone blanche.
     * recorded_at doit figurer dans l'index : c'est la clé de partitionnement.
     */
    this.schema.raw(`
       CREATE UNIQUE INDEX uq_positions_device_recorded ON positions (device_id, recorded_at);
      CREATE INDEX idx_positions_vehicle_recorded ON positions (vehicle_id, recorded_at DESC);
      CREATE INDEX idx_positions_trip ON positions (trip_id, recorded_at) WHERE trip_id IS NOT NULL;
      CREATE INDEX idx_positions_location ON positions USING gist (location);
    `)

    // Partitions d'amorçage : mois précédent, mois courant, 3 mois à venir.
    // Une tâche planifiée mensuelle (cf. database/sql/functions) prend le relais.
    this.schema.raw(`
      DO $$
      DECLARE m date;
      BEGIN
        FOR m IN
          SELECT generate_series(
            date_trunc('month', now()) - interval '1 month',
            date_trunc('month', now()) + interval '3 month',
            interval '1 month'
          )::date
        LOOP
          PERFORM sisbm_ensure_month_partition('positions', m);
          PERFORM sisbm_ensure_month_partition('ingest_messages', m);
        END LOOP;
      END $$;
    `)

    // ------------------------------------------------------------------ dernier état
    this.schema.raw(`
      CREATE TABLE vehicle_last_positions (
        vehicle_id        uuid PRIMARY KEY REFERENCES vehicles (id) ON DELETE CASCADE,
        organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        device_id         uuid REFERENCES devices (id) ON DELETE SET NULL,
        recorded_at       timestamptz NOT NULL,
        received_at       timestamptz NOT NULL DEFAULT now(),
        location          geography(Point, 4326) NOT NULL,
        speed_kph         numeric(6,2),
        heading_deg       numeric(5,2),
        ignition          boolean,
        movement          boolean,
        gsm_signal        smallint,
        battery_pct       numeric(5,2),
        external_voltage_v numeric(6,2),
        connection_state  text NOT NULL DEFAULT 'online',
        address           text,
        updated_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_vlp_connection CHECK (connection_state IN ('online','idle','offline','never_seen'))
      );
      CREATE INDEX idx_vlp_org ON vehicle_last_positions (organization_id);
      CREATE INDEX idx_vlp_location ON vehicle_last_positions USING gist (location);
      CREATE INDEX idx_vlp_stale ON vehicle_last_positions (recorded_at);
    `)

    // ------------------------------------------------------------------ trajets
    this.schema.raw(`
      CREATE TABLE trips (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        vehicle_id        uuid NOT NULL REFERENCES vehicles (id) ON DELETE RESTRICT,
        device_id         uuid REFERENCES devices (id) ON DELETE SET NULL,
        status            text NOT NULL DEFAULT 'open',
        started_at        timestamptz NOT NULL,
        ended_at          timestamptz,
        start_location    geography(Point, 4326),
        end_location      geography(Point, 4326),
        start_address     text,
        end_address       text,
        path              geography(LineString, 4326),
        distance_m        numeric(12,2) NOT NULL DEFAULT 0,
        duration_s        integer,
        idle_duration_s   integer NOT NULL DEFAULT 0,
        max_speed_kph     numeric(6,2),
        avg_speed_kph     numeric(6,2),
        positions_count   integer NOT NULL DEFAULT 0,
        close_reason      text,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_trips_status   CHECK (status IN ('open','closed','orphan')),
        CONSTRAINT ck_trips_dates    CHECK (ended_at IS NULL OR ended_at >= started_at),
        CONSTRAINT ck_trips_distance CHECK (distance_m >= 0),
        CONSTRAINT ck_trips_closed   CHECK (status <> 'closed' OR ended_at IS NOT NULL),
        CONSTRAINT ck_trips_reason   CHECK (close_reason IS NULL OR close_reason IN ('ignition_off','timeout','manual','device_removed'))
      );
      -- CM-06 : un seul trajet ouvert par véhicule
      CREATE UNIQUE INDEX uq_trips_open_vehicle ON trips (vehicle_id) WHERE status = 'open';
      CREATE INDEX idx_trips_vehicle_started ON trips (vehicle_id, started_at DESC);
      CREATE INDEX idx_trips_org_started ON trips (organization_id, started_at DESC);
      CREATE TRIGGER trg_trips_updated_at BEFORE UPDATE ON trips
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)
  }

  async down() {
    this.schema.raw('DROP TABLE IF EXISTS trips')
    this.schema.raw('DROP TABLE IF EXISTS vehicle_last_positions')
    this.schema.raw('DROP TABLE IF EXISTS positions')
    this.schema.raw('DROP TABLE IF EXISTS ingest_messages')
  }
}
