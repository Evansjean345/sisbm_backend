import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Moteur de politiques de gestion.
 *
 * Une politique = un déclencheur + des conditions (jsonb) + des cibles + des actions ordonnées.
 * Le jsonb est délibéré : les conditions sont trop variables pour être normalisées,
 * et leur validation est faite par un schéma VineJS côté applicatif.
 * En revanche le DÉCLENCHEUR est une liste fermée (CHECK) : c'est ce qui permet
 * d'indexer et de ne charger que les politiques pertinentes à chaque événement.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE policies (
        id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id           uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        name                      text NOT NULL,
        description               text,
        trigger_type              text NOT NULL,
        conditions                jsonb NOT NULL DEFAULT '{}'::jsonb,
        severity                  text NOT NULL DEFAULT 'warning',
        priority                  smallint NOT NULL DEFAULT 100,
        cooldown_seconds          integer NOT NULL DEFAULT 300,
        usage_schedule_id         uuid REFERENCES usage_schedules (id) ON DELETE SET NULL,
        requires_human_validation boolean NOT NULL DEFAULT true,
        is_active                 boolean NOT NULL DEFAULT true,
        version                   integer NOT NULL DEFAULT 1,
        created_by                uuid REFERENCES users (id) ON DELETE SET NULL,
        created_at                timestamptz NOT NULL DEFAULT now(),
        updated_at                timestamptz NOT NULL DEFAULT now(),
        deleted_at                timestamptz,
        CONSTRAINT ck_policies_trigger CHECK (trigger_type IN (
          'overspeed',
          'geofence_enter',
          'geofence_exit',
          'schedule_violation',
          'ignition_on',
          'ignition_off',
          'unauthorized_start',
          'prolonged_stop',
          'harsh_driving',
          'power_cut',
          'low_battery',
          'sos',
          'device_offline',
          'towing'
        )),
        CONSTRAINT ck_policies_severity CHECK (severity IN ('info','warning','critical')),
        CONSTRAINT ck_policies_cooldown CHECK (cooldown_seconds >= 0 AND cooldown_seconds <= 86400),
        CONSTRAINT ck_policies_priority CHECK (priority BETWEEN 0 AND 1000)
      );
      CREATE UNIQUE INDEX uq_policies_org_name ON policies (organization_id, lower(name))
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_policies_lookup ON policies (organization_id, trigger_type, priority)
        WHERE is_active AND deleted_at IS NULL;
      CREATE TRIGGER trg_policies_updated_at BEFORE UPDATE ON policies
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE policy_targets (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        policy_id        uuid NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
        scope            text NOT NULL DEFAULT 'vehicle',
        vehicle_id       uuid REFERENCES vehicles (id) ON DELETE CASCADE,
        vehicle_group_id uuid REFERENCES vehicle_groups (id) ON DELETE CASCADE,
        geofence_id      uuid REFERENCES geofences (id) ON DELETE CASCADE,
        created_at       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_policy_targets_scope CHECK (scope IN ('all','vehicle','group')),
        CONSTRAINT ck_policy_targets_ref CHECK (
          (scope = 'all'     AND vehicle_id IS NULL AND vehicle_group_id IS NULL) OR
          (scope = 'vehicle' AND vehicle_id IS NOT NULL AND vehicle_group_id IS NULL) OR
          (scope = 'group'   AND vehicle_group_id IS NOT NULL AND vehicle_id IS NULL)
        )
      );
      CREATE INDEX idx_policy_targets_policy  ON policy_targets (policy_id);
      CREATE INDEX idx_policy_targets_vehicle ON policy_targets (vehicle_id) WHERE vehicle_id IS NOT NULL;
      CREATE INDEX idx_policy_targets_group   ON policy_targets (vehicle_group_id) WHERE vehicle_group_id IS NOT NULL;
    `)

    this.schema.raw(`
      CREATE TABLE policy_actions (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        policy_id    uuid NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
        action_type  text NOT NULL,
        config       jsonb NOT NULL DEFAULT '{}'::jsonb,
        order_index  smallint NOT NULL DEFAULT 0,
        is_active    boolean NOT NULL DEFAULT true,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_policy_actions_type CHECK (action_type IN (
          'notify', 'create_incident', 'webhook', 'immobilize', 'log_only'
        ))
      );
      CREATE UNIQUE INDEX uq_policy_actions_order ON policy_actions (policy_id, order_index);
      CREATE TRIGGER trg_policy_actions_updated_at BEFORE UPDATE ON policy_actions
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE policy_executions (
        id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        policy_id     uuid NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
        policy_version integer NOT NULL,
        event_id      uuid,
        vehicle_id    uuid REFERENCES vehicles (id) ON DELETE SET NULL,
        status        text NOT NULL DEFAULT 'pending',
        started_at    timestamptz NOT NULL DEFAULT now(),
        finished_at   timestamptz,
        actions_result jsonb NOT NULL DEFAULT '[]'::jsonb,
        error_message text,
        CONSTRAINT ck_policy_executions_status CHECK (status IN ('pending','running','succeeded','partial','failed','skipped'))
      );
      CREATE INDEX idx_policy_executions_policy ON policy_executions (policy_id, started_at DESC);
      CREATE INDEX idx_policy_executions_event  ON policy_executions (event_id);
    `)
  }

  async down() {
    this.schema.raw('DROP TABLE IF EXISTS policy_executions')
    this.schema.raw('DROP TABLE IF EXISTS policy_actions')
    this.schema.raw('DROP TABLE IF EXISTS policy_targets')
    this.schema.raw('DROP TABLE IF EXISTS policies')
  }
}
