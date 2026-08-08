import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Domaine flotte.
 *
 * Décision structurante : le VÉHICULE et le TRACKER sont deux entités distinctes,
 * reliées par une affectation DATÉE (device_assignments).
 * Un tracker démonté puis remonté sur un autre véhicule ne déplace pas l'historique.
 */

export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE vehicle_groups (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        name            text NOT NULL,
        description     text,
        color           text,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        deleted_at      timestamptz,
        CONSTRAINT ck_vehicle_groups_color CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$')
      );
      CREATE UNIQUE INDEX uq_vehicle_groups_org_name ON vehicle_groups (organization_id, lower(name))
        WHERE deleted_at IS NULL;
      CREATE TRIGGER trg_vehicle_groups_updated_at BEFORE UPDATE ON vehicle_groups
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE vehicles (
        id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id         uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
        registration            citext NOT NULL,
        vin                     text,
        label                   text,
        brand                   text,
        model                   text,
        year                    smallint,
        vehicle_type            text NOT NULL DEFAULT 'car',
        color                   text,
        status                  text NOT NULL DEFAULT 'active',
        odometer_km             numeric(10,2) NOT NULL DEFAULT 0,
        speed_limit_kph         numeric(6,2),
        immobilization_enabled  boolean NOT NULL DEFAULT false,
        notes                   text,
        metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at              timestamptz NOT NULL DEFAULT now(),
        updated_at              timestamptz NOT NULL DEFAULT now(),
        deleted_at              timestamptz,
        CONSTRAINT ck_vehicles_status CHECK (status IN ('draft','active','maintenance','inactive','archived')),
        CONSTRAINT ck_vehicles_type   CHECK (vehicle_type IN ('car','van','truck','tanker','bus','motorcycle','trailer','machinery','other')),
        CONSTRAINT ck_vehicles_year   CHECK (year IS NULL OR (year BETWEEN 1950 AND 2100)),
        CONSTRAINT ck_vehicles_odo    CHECK (odometer_km >= 0),
        CONSTRAINT ck_vehicles_speed  CHECK (speed_limit_kph IS NULL OR (speed_limit_kph > 0 AND speed_limit_kph <= 300)),
        CONSTRAINT ck_vehicles_vin    CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{11,17}$')
      );
      CREATE UNIQUE INDEX uq_vehicles_org_registration ON vehicles (organization_id, registration)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_vehicles_org_status ON vehicles (organization_id, status) WHERE deleted_at IS NULL;
      CREATE INDEX idx_vehicles_registration_trgm ON vehicles USING gin (registration gin_trgm_ops);
      CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON vehicles
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE vehicle_group_members (
        vehicle_group_id uuid NOT NULL REFERENCES vehicle_groups (id) ON DELETE CASCADE,
        vehicle_id       uuid NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
        added_at         timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (vehicle_group_id, vehicle_id)
      );
      CREATE INDEX idx_vehicle_group_members_vehicle ON vehicle_group_members (vehicle_id);
    `)

    this.schema.raw(`
      CREATE TABLE devices (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
        imei              text NOT NULL,
        serial_number     text,
        manufacturer      text NOT NULL DEFAULT 'micodus',
        model             text NOT NULL,
        protocol          text,
        firmware_version  text,
        has_relay         boolean NOT NULL DEFAULT false,
        sim_msisdn        text,
        sim_iccid         text,
        sim_operator      text,
        flespi_device_id  bigint,
        flespi_channel_id bigint,
        flespi_ident      text,
        status            text NOT NULL DEFAULT 'stock',
        last_seen_at      timestamptz,
        last_gsm_signal   smallint,
        last_battery_pct  numeric(5,2),
        commissioned_on   date,
        notes             text,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        deleted_at        timestamptz,
        CONSTRAINT ck_devices_imei    CHECK (imei ~ '^[0-9]{15}$'),
        CONSTRAINT ck_devices_status  CHECK (status IN ('stock','active','maintenance','decommissioned')),
        CONSTRAINT ck_devices_manufacturer CHECK (manufacturer IN ('micodus','teltonika','concox','queclink','other')),
        CONSTRAINT ck_devices_msisdn  CHECK (sim_msisdn IS NULL OR sim_msisdn ~ '^\\+[1-9][0-9]{7,14}$'),
        CONSTRAINT ck_devices_iccid   CHECK (sim_iccid IS NULL OR sim_iccid ~ '^[0-9]{18,22}$'),
        CONSTRAINT ck_devices_gsm     CHECK (last_gsm_signal IS NULL OR last_gsm_signal BETWEEN 0 AND 31)
      );
      CREATE UNIQUE INDEX uq_devices_imei         ON devices (imei) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_devices_flespi_id    ON devices (flespi_device_id) WHERE flespi_device_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_devices_flespi_ident ON devices (flespi_ident) WHERE flespi_ident IS NOT NULL;
      CREATE INDEX idx_devices_org_status ON devices (organization_id, status) WHERE deleted_at IS NULL;
      CREATE TRIGGER trg_devices_updated_at BEFORE UPDATE ON devices
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    /**
     * CM-01 / CM-02 : les deux contraintes EXCLUDE rendent structurellement impossible
     * qu'un tracker soit sur deux véhicules à la fois, ou qu'un véhicule porte deux
     * trackers actifs sur une même période. Aucune erreur applicative ne peut les contourner.
     * 'period' est un tstzrange ouvert à droite : [installé_le, NULL) = affectation en cours.
     */
    this.schema.raw(`
      CREATE TABLE device_assignments (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id     uuid NOT NULL REFERENCES devices (id) ON DELETE RESTRICT,
        vehicle_id    uuid NOT NULL REFERENCES vehicles (id) ON DELETE RESTRICT,
        period        tstzrange NOT NULL,
        installed_by  uuid REFERENCES users (id) ON DELETE SET NULL,
        removed_by    uuid REFERENCES users (id) ON DELETE SET NULL,
        install_notes text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_device_assignments_period CHECK (NOT isempty(period)),
        CONSTRAINT ex_device_assignments_device  EXCLUDE USING gist (device_id  WITH =, period WITH &&),
        CONSTRAINT ex_device_assignments_vehicle EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
      );
      CREATE INDEX idx_device_assignments_vehicle_period ON device_assignments USING gist (vehicle_id, period);
      CREATE INDEX idx_device_assignments_current ON device_assignments (device_id)
        WHERE upper_inf(period);
      CREATE TRIGGER trg_device_assignments_updated_at BEFORE UPDATE ON device_assignments
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    // Vue de confort : affectation courante device <-> vehicle (très utilisée à l'ingestion)
    this.schema.raw(`
      CREATE VIEW current_device_assignments AS
      SELECT da.id, da.device_id, da.vehicle_id, lower(da.period) AS installed_at,
             d.imei, d.organization_id, v.registration
      FROM device_assignments da
      JOIN devices  d ON d.id = da.device_id
      JOIN vehicles v ON v.id = da.vehicle_id
      WHERE upper_inf(da.period);
    `)
  }

  async down() {
    this.schema.raw('DROP VIEW IF EXISTS current_device_assignments')
    this.schema.raw('DROP TABLE IF EXISTS device_assignments')
    this.schema.raw('DROP TABLE IF EXISTS devices')
    this.schema.raw('DROP TABLE IF EXISTS vehicle_group_members')
    this.schema.raw('DROP TABLE IF EXISTS vehicles')
    this.schema.raw('DROP TABLE IF EXISTS vehicle_groups')
  }
}
