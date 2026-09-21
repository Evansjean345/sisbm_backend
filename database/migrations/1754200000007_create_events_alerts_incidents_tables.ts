import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Chaîne événementielle : event -> alert -> incident.
 *
 * event    : fait brut normalisé, immuable, dédoublonné par dedup_key
 * alert    : fait qualifié par une politique, avec cycle de traitement
 * incident : dossier agrégeant une ou plusieurs alertes
 *
 * Cette séparation en trois niveaux est ce qui permet le dédoublonnage
 * (100 positions en survitesse consécutives = 1 alerte, pas 100).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE events (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        vehicle_id      uuid REFERENCES vehicles (id) ON DELETE SET NULL,
        device_id       uuid REFERENCES devices (id) ON DELETE SET NULL,
        trip_id         uuid REFERENCES trips (id) ON DELETE SET NULL,
        geofence_id     uuid REFERENCES geofences (id) ON DELETE SET NULL,
        position_id     bigint,
        event_type      text NOT NULL,
        severity        text NOT NULL DEFAULT 'info',
        occurred_at     timestamptz NOT NULL,
        received_at     timestamptz NOT NULL DEFAULT now(),
        location        geography(Point, 4326),
        speed_kph       numeric(6,2),
        threshold_value numeric(12,2),
        actual_value    numeric(12,2),
        dedup_key       text NOT NULL,
        payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_events_type CHECK (event_type IN (
          'overspeed','geofence_enter','geofence_exit','schedule_violation',
          'ignition_on','ignition_off','unauthorized_start','prolonged_stop',
          'harsh_acceleration','harsh_braking','harsh_cornering',
          'power_cut','low_battery','sos','towing',
          'device_online','device_offline','gps_lost','gps_restored',
          'immobilization_executed','immobilization_restored'
        )),
        CONSTRAINT ck_events_severity CHECK (severity IN ('info','warning','critical'))
      );
      CREATE UNIQUE INDEX uq_events_dedup ON events (dedup_key);
      CREATE INDEX idx_events_vehicle_occurred ON events (vehicle_id, occurred_at DESC);
      CREATE INDEX idx_events_org_type_occurred ON events (organization_id, event_type, occurred_at DESC);
      CREATE INDEX idx_events_location ON events USING gist (location);
    `)

    this.schema.raw(`
      CREATE TABLE incidents (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        reference        text NOT NULL,
        vehicle_id       uuid REFERENCES vehicles (id) ON DELETE SET NULL,
        category         text NOT NULL DEFAULT 'other',
        severity         text NOT NULL DEFAULT 'warning',
        status           text NOT NULL DEFAULT 'open',
        title            text NOT NULL,
        description      text,
        location         geography(Point, 4326),
        occurred_at      timestamptz NOT NULL DEFAULT now(),
        opened_at        timestamptz NOT NULL DEFAULT now(),
        opened_by        uuid REFERENCES users (id) ON DELETE SET NULL,
        assigned_to      uuid REFERENCES users (id) ON DELETE SET NULL,
        acknowledged_at  timestamptz,
        resolved_at      timestamptz,
        resolved_by      uuid REFERENCES users (id) ON DELETE SET NULL,
        closed_at        timestamptz,
        resolution       text,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_incidents_status   CHECK (status IN ('open','in_progress','resolved','closed')),
        CONSTRAINT ck_incidents_severity CHECK (severity IN ('info','warning','critical')),
        CONSTRAINT ck_incidents_category CHECK (category IN (
          'theft','accident','breakdown','speeding','unauthorized_use','geofence_breach','device_issue','other'
        )),
        CONSTRAINT ck_incidents_resolved CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),
        CONSTRAINT ck_incidents_closed   CHECK (status <> 'closed'   OR closed_at   IS NOT NULL)
      );
      CREATE UNIQUE INDEX uq_incidents_reference ON incidents (organization_id, reference);
      CREATE INDEX idx_incidents_org_status ON incidents (organization_id, status, opened_at DESC);
      CREATE INDEX idx_incidents_vehicle ON incidents (vehicle_id, opened_at DESC);
      CREATE INDEX idx_incidents_assignee ON incidents (assigned_to) WHERE status IN ('open','in_progress');
      CREATE TRIGGER trg_incidents_updated_at BEFORE UPDATE ON incidents
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();

      -- Séquence de numérotation lisible des dossiers : INC-2026-000123
      CREATE SEQUENCE incidents_reference_seq;
    `)

    this.schema.raw(`
      CREATE TABLE alerts (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        event_id         uuid REFERENCES events (id) ON DELETE SET NULL,
        policy_id        uuid REFERENCES policies (id) ON DELETE SET NULL,
        vehicle_id       uuid REFERENCES vehicles (id) ON DELETE SET NULL,
        incident_id      uuid REFERENCES incidents (id) ON DELETE SET NULL,
        alert_type       text NOT NULL,
        severity         text NOT NULL DEFAULT 'warning',
        status           text NOT NULL DEFAULT 'new',
        title            text NOT NULL,
        message          text,
        location         geography(Point, 4326),
        triggered_at     timestamptz NOT NULL,
        acknowledged_at  timestamptz,
        acknowledged_by  uuid REFERENCES users (id) ON DELETE SET NULL,
        resolved_at      timestamptz,
        resolved_by      uuid REFERENCES users (id) ON DELETE SET NULL,
        resolution_note  text,
        occurrences      integer NOT NULL DEFAULT 1,
        last_occurred_at timestamptz,
        context          jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_alerts_severity CHECK (severity IN ('info','warning','critical')),
        CONSTRAINT ck_alerts_status   CHECK (status IN ('new','acknowledged','resolved','closed','false_positive')),
        CONSTRAINT ck_alerts_ack      CHECK (status = 'new' OR acknowledged_at IS NOT NULL),
        CONSTRAINT ck_alerts_occurrences CHECK (occurrences >= 1)
      );
      CREATE INDEX idx_alerts_org_status ON alerts (organization_id, status, triggered_at DESC);
      CREATE INDEX idx_alerts_vehicle ON alerts (vehicle_id, triggered_at DESC);
      CREATE INDEX idx_alerts_open ON alerts (organization_id, severity, triggered_at DESC)
        WHERE status IN ('new','acknowledged');
      CREATE INDEX idx_alerts_incident ON alerts (incident_id) WHERE incident_id IS NOT NULL;
      CREATE TRIGGER trg_alerts_updated_at BEFORE UPDATE ON alerts
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE incident_alerts (
        incident_id uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
        alert_id    uuid NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
        linked_at   timestamptz NOT NULL DEFAULT now(),
        linked_by   uuid REFERENCES users (id) ON DELETE SET NULL,
        PRIMARY KEY (incident_id, alert_id)
      );
      CREATE INDEX idx_incident_alerts_alert ON incident_alerts (alert_id);
    `)

    this.schema.raw(`
      CREATE TABLE incident_timeline (
        id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        incident_id uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
        author_id   uuid REFERENCES users (id) ON DELETE SET NULL,
        kind        text NOT NULL DEFAULT 'comment',
        content     text,
        metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_incident_timeline_kind CHECK (kind IN ('comment','status_change','assignment','attachment','system'))
      );
      CREATE INDEX idx_incident_timeline_incident ON incident_timeline (incident_id, created_at);
    `)

    // Rattachement de policy_executions aux événements (FK différée à cette migration)
    this.schema.raw(`
      ALTER TABLE policy_executions
        ADD CONSTRAINT fk_policy_executions_events
        FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE SET NULL;
    `)
  }

  async down() {
    this.schema.raw(
      'ALTER TABLE policy_executions DROP CONSTRAINT IF EXISTS fk_policy_executions_events'
    )
    this.schema.raw('DROP TABLE IF EXISTS incident_timeline')
    this.schema.raw('DROP TABLE IF EXISTS incident_alerts')
    this.schema.raw('DROP TABLE IF EXISTS alerts')
    this.schema.raw('DROP SEQUENCE IF EXISTS incidents_reference_seq')
    this.schema.raw('DROP TABLE IF EXISTS incidents')
    this.schema.raw('DROP TABLE IF EXISTS events')
  }
}
