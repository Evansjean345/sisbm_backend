import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Notifications multicanal + facturation SMS légère (TDR §II.6).
 *
 * sms_accounts     : solde courant, verrouillé en SELECT ... FOR UPDATE lors d'un débit
 * sms_transactions : grand livre APPEND-ONLY, chaîné par balance_after
 *                    -> rapprochement possible à tout instant avec le solde
 */

export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE notification_templates (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid REFERENCES organizations (id) ON DELETE CASCADE,
        code            text NOT NULL,
        channel         text NOT NULL,
        locale          char(2) NOT NULL DEFAULT 'fr',
        subject         text,
        body            text NOT NULL,
        is_active       boolean NOT NULL DEFAULT true,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_notification_templates_channel CHECK (channel IN ('email','sms','whatsapp','web','push'))
      );
      CREATE UNIQUE INDEX uq_notification_templates_global
        ON notification_templates (code, channel, locale) WHERE organization_id IS NULL;
      CREATE UNIQUE INDEX uq_notification_templates_org
        ON notification_templates (organization_id, code, channel, locale) WHERE organization_id IS NOT NULL;
      CREATE TRIGGER trg_notification_templates_updated_at BEFORE UPDATE ON notification_templates
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE user_notification_preferences (
        user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        channel        text NOT NULL,
        is_enabled     boolean NOT NULL DEFAULT true,
        min_severity   text NOT NULL DEFAULT 'warning',
        quiet_from     time,
        quiet_to       time,
        updated_at     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, channel),
        CONSTRAINT ck_unp_channel  CHECK (channel IN ('email','sms','whatsapp','web','push')),
        CONSTRAINT ck_unp_severity CHECK (min_severity IN ('info','warning','critical')),
        CONSTRAINT ck_unp_quiet    CHECK (num_nonnulls(quiet_from, quiet_to) <> 1)
      );
    `)

    this.schema.raw(`
      CREATE TABLE notifications (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        alert_id          uuid REFERENCES alerts (id) ON DELETE SET NULL,
        incident_id       uuid REFERENCES incidents (id) ON DELETE SET NULL,
        channel           text NOT NULL,
        recipient_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
        recipient_address text NOT NULL,
        template_code     text,
        subject           text,
        body              text NOT NULL,
        status            text NOT NULL DEFAULT 'queued',
        attempts          smallint NOT NULL DEFAULT 0,
        provider          text,
        provider_message_id text,
        segments          smallint NOT NULL DEFAULT 1,
        cost_amount       numeric(14,4),
        currency          char(3),
        dedup_key         text,
        queued_at         timestamptz NOT NULL DEFAULT now(),
        sent_at           timestamptz,
        delivered_at      timestamptz,
        failed_at         timestamptz,
        next_retry_at     timestamptz,
        error_message     text,
        payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT ck_notifications_channel CHECK (channel IN ('email','sms','whatsapp','web','push')),
        CONSTRAINT ck_notifications_status  CHECK (status IN ('queued','sending','sent','delivered','failed','cancelled')),
        CONSTRAINT ck_notifications_attempts CHECK (attempts >= 0 AND attempts <= 10),
        CONSTRAINT ck_notifications_segments CHECK (segments >= 1),
        CONSTRAINT ck_notifications_sms_addr CHECK (
          channel NOT IN ('sms','whatsapp') OR recipient_address ~ '^\\+[1-9][0-9]{7,14}$'
        )
      );
      CREATE UNIQUE INDEX uq_notifications_dedup ON notifications (dedup_key) WHERE dedup_key IS NOT NULL;
      CREATE INDEX idx_notifications_alert ON notifications (alert_id);
      CREATE INDEX idx_notifications_pending ON notifications (next_retry_at)
        WHERE status IN ('queued','sending');
      CREATE INDEX idx_notifications_org_channel_queued ON notifications (organization_id, channel, queued_at DESC);
    `)

    // ------------------------------------------------------------- facturation SMS
    this.schema.raw(`
      CREATE TABLE sms_accounts (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        provider              text NOT NULL,
        label                 text,
        balance_credits       numeric(14,2) NOT NULL DEFAULT 0,
        unit_price_amount     numeric(14,4) NOT NULL DEFAULT 0,
        currency              char(3) NOT NULL DEFAULT 'XOF',
        low_balance_threshold numeric(14,2) NOT NULL DEFAULT 100,
        is_active             boolean NOT NULL DEFAULT true,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_sms_accounts_balance   CHECK (balance_credits >= 0),
        CONSTRAINT ck_sms_accounts_price     CHECK (unit_price_amount >= 0),
        CONSTRAINT ck_sms_accounts_threshold CHECK (low_balance_threshold >= 0)
      );
      CREATE UNIQUE INDEX uq_sms_accounts_org_provider ON sms_accounts (organization_id, provider);
      CREATE TRIGGER trg_sms_accounts_updated_at BEFORE UPDATE ON sms_accounts
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE sms_transactions (
        id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        sms_account_id    uuid NOT NULL REFERENCES sms_accounts (id) ON DELETE RESTRICT,
        organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
        transaction_type  text NOT NULL,
        quantity          numeric(14,2) NOT NULL,
        unit_price_amount numeric(14,4) NOT NULL DEFAULT 0,
        total_amount      numeric(14,4) NOT NULL DEFAULT 0,
        currency          char(3) NOT NULL DEFAULT 'XOF',
        balance_after     numeric(14,2) NOT NULL,
        notification_id   uuid REFERENCES notifications (id) ON DELETE SET NULL,
        reference         text,
        note              text,
        created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_sms_tx_type CHECK (transaction_type IN ('topup','consumption','adjustment','refund')),
        CONSTRAINT ck_sms_tx_balance CHECK (balance_after >= 0),
        -- une consommation débite (quantity < 0), une recharge crédite (quantity > 0)
        CONSTRAINT ck_sms_tx_sign CHECK (
          (transaction_type = 'consumption' AND quantity < 0) OR
          (transaction_type IN ('topup','refund') AND quantity > 0) OR
          (transaction_type = 'adjustment')
        )
      );
      CREATE INDEX idx_sms_tx_account ON sms_transactions (sms_account_id, created_at DESC);
      CREATE INDEX idx_sms_tx_org_period ON sms_transactions (organization_id, created_at DESC);
      CREATE UNIQUE INDEX uq_sms_tx_notification ON sms_transactions (notification_id)
        WHERE notification_id IS NOT NULL;
    `)
  }

  async down() {
    this.schema.raw('DROP TABLE IF EXISTS sms_transactions')
    this.schema.raw('DROP TABLE IF EXISTS sms_accounts')
    this.schema.raw('DROP TABLE IF EXISTS notifications')
    this.schema.raw('DROP TABLE IF EXISTS user_notification_preferences')
    this.schema.raw('DROP TABLE IF EXISTS notification_templates')
  }
}
