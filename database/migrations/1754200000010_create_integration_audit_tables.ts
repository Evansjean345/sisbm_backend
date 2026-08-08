import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Ouverture (API / webhooks, TDR §IV.4), traçabilité et rapports asynchrones.
 *
 * outbox_messages implémente le pattern Transactional Outbox :
 * l'intention d'envoi est écrite DANS la transaction métier, l'envoi réel
 * est fait ensuite par un worker. C'est ce qui garantit
 * « l'alerte existe <=> la notification part » sans transaction distribuée.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE api_clients (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        name            text NOT NULL,
        description     text,
        key_prefix      text NOT NULL,
        key_hash        text NOT NULL,
        scopes          text[] NOT NULL DEFAULT '{}',
        allowed_ips     inet[],
        rate_limit_per_minute integer NOT NULL DEFAULT 120,
        is_active       boolean NOT NULL DEFAULT true,
        last_used_at    timestamptz,
        expires_at      timestamptz,
        created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        revoked_at      timestamptz,
        CONSTRAINT ck_api_clients_rate CHECK (rate_limit_per_minute BETWEEN 1 AND 10000)
      );
      CREATE UNIQUE INDEX uq_api_clients_prefix ON api_clients (key_prefix);
      CREATE INDEX idx_api_clients_org ON api_clients (organization_id) WHERE revoked_at IS NULL;
      CREATE TRIGGER trg_api_clients_updated_at BEFORE UPDATE ON api_clients
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE webhook_endpoints (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        name            text NOT NULL,
        url             text NOT NULL,
        secret_hash     text NOT NULL,
        event_types     text[] NOT NULL DEFAULT '{}',
        is_active       boolean NOT NULL DEFAULT true,
        max_attempts    smallint NOT NULL DEFAULT 5,
        timeout_ms      integer NOT NULL DEFAULT 5000,
        last_success_at timestamptz,
        last_failure_at timestamptz,
        consecutive_failures smallint NOT NULL DEFAULT 0,
        created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        deleted_at      timestamptz,
        CONSTRAINT ck_webhook_endpoints_url CHECK (url ~* '^https://'),
        CONSTRAINT ck_webhook_endpoints_timeout CHECK (timeout_ms BETWEEN 500 AND 30000)
      );
      CREATE INDEX idx_webhook_endpoints_org ON webhook_endpoints (organization_id)
        WHERE is_active AND deleted_at IS NULL;
      CREATE TRIGGER trg_webhook_endpoints_updated_at BEFORE UPDATE ON webhook_endpoints
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE webhook_deliveries (
        id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        webhook_endpoint_id uuid NOT NULL REFERENCES webhook_endpoints (id) ON DELETE CASCADE,
        event_id            uuid REFERENCES events (id) ON DELETE SET NULL,
        event_type          text NOT NULL,
        payload             jsonb NOT NULL,
        status              text NOT NULL DEFAULT 'pending',
        attempts            smallint NOT NULL DEFAULT 0,
        http_status         smallint,
        response_body       text,
        error_message       text,
        next_retry_at       timestamptz,
        created_at          timestamptz NOT NULL DEFAULT now(),
        delivered_at        timestamptz,
        CONSTRAINT ck_webhook_deliveries_status CHECK (status IN ('pending','delivered','failed','abandoned'))
      );
      CREATE INDEX idx_webhook_deliveries_pending ON webhook_deliveries (next_retry_at)
        WHERE status = 'pending';
      CREATE INDEX idx_webhook_deliveries_endpoint ON webhook_deliveries (webhook_endpoint_id, created_at DESC);
    `)

    this.schema.raw(`
      CREATE TABLE outbox_messages (
        id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        aggregate_type text NOT NULL,
        aggregate_id   uuid,
        topic          text NOT NULL,
        payload        jsonb NOT NULL,
        status         text NOT NULL DEFAULT 'pending',
        attempts       smallint NOT NULL DEFAULT 0,
        available_at   timestamptz NOT NULL DEFAULT now(),
        locked_by      text,
        locked_at      timestamptz,
        published_at   timestamptz,
        last_error     text,
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_outbox_status CHECK (status IN ('pending','processing','published','failed','abandoned'))
      );
      CREATE INDEX idx_outbox_dispatch ON outbox_messages (available_at, id)
        WHERE status = 'pending';
      CREATE INDEX idx_outbox_stuck ON outbox_messages (locked_at) WHERE status = 'processing';
    `)

    this.schema.raw(`
      CREATE TABLE report_jobs (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        report_type     text NOT NULL,
        format          text NOT NULL DEFAULT 'pdf',
        parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
        status          text NOT NULL DEFAULT 'queued',
        requested_by    uuid REFERENCES users (id) ON DELETE SET NULL,
        file_path       text,
        file_size_bytes bigint,
        rows_count      integer,
        started_at      timestamptz,
        finished_at     timestamptz,
        error_message   text,
        expires_at      timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
        created_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_report_jobs_format CHECK (format IN ('pdf','xlsx','csv')),
        CONSTRAINT ck_report_jobs_status CHECK (status IN ('queued','running','completed','failed','expired')),
        CONSTRAINT ck_report_jobs_type CHECK (report_type IN (
          'trips','positions','alerts','events','fleet_activity','sms_consumption','geofence_activity','vehicle_summary'
        ))
      );
      CREATE INDEX idx_report_jobs_org ON report_jobs (organization_id, created_at DESC);
      CREATE INDEX idx_report_jobs_queued ON report_jobs (created_at) WHERE status = 'queued';
    `)

    /**
     * Journal d'audit APPEND-ONLY (TDR §II.5 « journalisation complète »).
     * Partitionné par mois : c'est une table qui ne se purge jamais mais
     * dont on n'interroge presque jamais l'ancien.
     */
    this.schema.raw(`
      CREATE TABLE audit_logs (
        id              bigint GENERATED ALWAYS AS IDENTITY,
        organization_id uuid,
        actor_id        uuid,
        actor_type      text NOT NULL DEFAULT 'user',
        actor_label     text,
        actor_ip        inet,
        user_agent      text,
        action          text NOT NULL,
        resource_type   text NOT NULL,
        resource_id     text,
        before_state    jsonb,
        after_state     jsonb,
        metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (id, occurred_at),
        CONSTRAINT ck_audit_logs_actor CHECK (actor_type IN ('user','system','policy','api','anonymous'))
      ) PARTITION BY RANGE (occurred_at);

      CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id, occurred_at DESC);
      CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id, occurred_at DESC);
      CREATE INDEX idx_audit_logs_org ON audit_logs (organization_id, occurred_at DESC);
    `)

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
          PERFORM sisbm_ensure_month_partition('audit_logs', m);
        END LOOP;
      END $$;
    `)
  }

  async down() {
    this.schema.raw('DROP TABLE IF EXISTS audit_logs')
    this.schema.raw('DROP TABLE IF EXISTS report_jobs')
    this.schema.raw('DROP TABLE IF EXISTS outbox_messages')
    this.schema.raw('DROP TABLE IF EXISTS webhook_deliveries')
    this.schema.raw('DROP TABLE IF EXISTS webhook_endpoints')
    this.schema.raw('DROP TABLE IF EXISTS api_clients')
  }
}
