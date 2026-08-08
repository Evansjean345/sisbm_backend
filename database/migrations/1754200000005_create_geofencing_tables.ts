import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Geofencing et calendriers d'utilisation.
 *
 * geofence_states porte l'état courant dedans/dehors : sans lui on ne peut détecter
 * que la présence, jamais la TRANSITION (entrée / sortie), qui est ce que le TDR demande.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE geofences (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        name            text NOT NULL,
        description     text,
        kind            text NOT NULL DEFAULT 'authorized',
        shape_type      text NOT NULL DEFAULT 'polygon',
        geom            geography(MultiPolygon, 4326) NOT NULL,
        center          geography(Point, 4326),
        radius_m        numeric(10,2),
        area_m2         numeric(16,2),
        color           text,
        is_active       boolean NOT NULL DEFAULT true,
        created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        deleted_at      timestamptz,
        CONSTRAINT ck_geofences_kind   CHECK (kind IN ('authorized','forbidden','poi')),
        CONSTRAINT ck_geofences_shape  CHECK (shape_type IN ('polygon','circle','corridor')),
        CONSTRAINT ck_geofences_circle CHECK (
          shape_type <> 'circle' OR (center IS NOT NULL AND radius_m IS NOT NULL AND radius_m > 0)
        ),
        CONSTRAINT ck_geofences_valid  CHECK (ST_IsValid(geom::geometry))
      );
      CREATE UNIQUE INDEX uq_geofences_org_name ON geofences (organization_id, lower(name))
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_geofences_geom ON geofences USING gist (geom);
      CREATE INDEX idx_geofences_org_active ON geofences (organization_id) WHERE is_active AND deleted_at IS NULL;
      CREATE TRIGGER trg_geofences_updated_at BEFORE UPDATE ON geofences
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE usage_schedules (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        name            text NOT NULL,
        description     text,
        timezone        text NOT NULL DEFAULT 'Africa/Abidjan',
        is_active       boolean NOT NULL DEFAULT true,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        deleted_at      timestamptz
      );
      CREATE UNIQUE INDEX uq_usage_schedules_org_name ON usage_schedules (organization_id, lower(name))
        WHERE deleted_at IS NULL;
      CREATE TRIGGER trg_usage_schedules_updated_at BEFORE UPDATE ON usage_schedules
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE schedule_windows (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        usage_schedule_id uuid NOT NULL REFERENCES usage_schedules (id) ON DELETE CASCADE,
        day_of_week       smallint NOT NULL,
        start_time        time NOT NULL,
        end_time          time NOT NULL,
        CONSTRAINT ck_schedule_windows_dow   CHECK (day_of_week BETWEEN 0 AND 6),
        CONSTRAINT ck_schedule_windows_order CHECK (start_time < end_time)
      );
      CREATE INDEX idx_schedule_windows_schedule ON schedule_windows (usage_schedule_id, day_of_week);
    `)

    this.schema.raw(`
      CREATE TABLE vehicle_schedules (
        vehicle_id        uuid NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
        usage_schedule_id uuid NOT NULL REFERENCES usage_schedules (id) ON DELETE CASCADE,
        mode              text NOT NULL DEFAULT 'allowed',
        created_at        timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (vehicle_id, usage_schedule_id),
        CONSTRAINT ck_vehicle_schedules_mode CHECK (mode IN ('allowed','forbidden'))
      );
    `)

    /**
     * CM-13 : une affectation cible un véhicule OU un groupe, jamais les deux, jamais aucun.
     */
    this.schema.raw(`
      CREATE TABLE geofence_assignments (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        geofence_id       uuid NOT NULL REFERENCES geofences (id) ON DELETE CASCADE,
        vehicle_id        uuid REFERENCES vehicles (id) ON DELETE CASCADE,
        vehicle_group_id  uuid REFERENCES vehicle_groups (id) ON DELETE CASCADE,
        usage_schedule_id uuid REFERENCES usage_schedules (id) ON DELETE SET NULL,
        notify_on_enter   boolean NOT NULL DEFAULT true,
        notify_on_exit    boolean NOT NULL DEFAULT true,
        severity          text NOT NULL DEFAULT 'warning',
        is_active         boolean NOT NULL DEFAULT true,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_geofence_assignments_target CHECK (num_nonnulls(vehicle_id, vehicle_group_id) = 1),
        CONSTRAINT ck_geofence_assignments_severity CHECK (severity IN ('info','warning','critical'))
      );
      CREATE UNIQUE INDEX uq_geofence_assignments_vehicle ON geofence_assignments (geofence_id, vehicle_id)
        WHERE vehicle_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_geofence_assignments_group ON geofence_assignments (geofence_id, vehicle_group_id)
        WHERE vehicle_group_id IS NOT NULL;
      CREATE TRIGGER trg_geofence_assignments_updated_at BEFORE UPDATE ON geofence_assignments
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE geofence_states (
        vehicle_id       uuid NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
        geofence_id      uuid NOT NULL REFERENCES geofences (id) ON DELETE CASCADE,
        is_inside        boolean NOT NULL,
        since            timestamptz NOT NULL,
        last_evaluated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (vehicle_id, geofence_id)
      );
      CREATE INDEX idx_geofence_states_inside ON geofence_states (geofence_id) WHERE is_inside;
    `)
  }

  async down() {
    this.schema.raw('DROP TABLE IF EXISTS geofence_states')
    this.schema.raw('DROP TABLE IF EXISTS geofence_assignments')
    this.schema.raw('DROP TABLE IF EXISTS vehicle_schedules')
    this.schema.raw('DROP TABLE IF EXISTS schedule_windows')
    this.schema.raw('DROP TABLE IF EXISTS usage_schedules')
    this.schema.raw('DROP TABLE IF EXISTS geofences')
  }
}
