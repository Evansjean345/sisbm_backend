import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Socle d'identité : organisations, rôles (RBAC plat), utilisateurs, jetons d'accès.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE organizations (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code            text NOT NULL,
        name            text NOT NULL,
        contact_email   citext,
        contact_phone   text,
        country_code    char(2) NOT NULL DEFAULT 'CI',
        timezone        text    NOT NULL DEFAULT 'Africa/Abidjan',
        currency        char(3) NOT NULL DEFAULT 'XOF',
        is_active       boolean NOT NULL DEFAULT true,
        settings        jsonb   NOT NULL DEFAULT '{}'::jsonb,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        deleted_at      timestamptz,
        CONSTRAINT ck_organizations_code    CHECK (code ~ '^[a-z0-9_-]{2,40}$'),
        CONSTRAINT ck_organizations_phone   CHECK (contact_phone IS NULL OR contact_phone ~ '^\\+[1-9][0-9]{7,14}$')
      );
      CREATE UNIQUE INDEX uq_organizations_code ON organizations (code) WHERE deleted_at IS NULL;
      CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(
      `
      CREATE TABLE roles (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid REFERENCES organizations (id) ON DELETE CASCADE,
        code            text NOT NULL,
        name            text NOT NULL,
        description     text,
        permissions     text[] NOT NULL DEFAULT '{}',
        is_system       boolean NOT NULL DEFAULT false,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_roles_code CHECK (code ~ '^[a-z0-9_]{2,40}$'),
        -- un rôle système est global (organization_id NULL), un rôle custom appartient à une organisation
        CONSTRAINT ck_roles_scope CHECK (
          (is_system AND organization_id IS NULL) OR (NOT is_system AND organization_id IS NOT NULL)
        )
      );
      CREATE UNIQUE INDEX uq_roles_system_code ON roles (code) WHERE organization_id IS NULL;
      CREATE UNIQUE INDEX uq_roles_org_code    ON roles (organization_id, code) WHERE organization_id IS NOT NULL;
      CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `
    )

    this.schema.raw(`
      CREATE TABLE users (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
        role_id           uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
        email             citext NOT NULL,
        password_hash     text   NOT NULL,
        full_name         text   NOT NULL,
        phone             text,
        status            text   NOT NULL DEFAULT 'pending',
        locale            char(2) NOT NULL DEFAULT 'fr',
        timezone          text    NOT NULL DEFAULT 'Africa/Abidjan',
        last_login_at     timestamptz,
        last_login_ip     inet,
        failed_attempts   smallint NOT NULL DEFAULT 0,
        locked_until      timestamptz,
        password_changed_at timestamptz,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        deleted_at        timestamptz,
        CONSTRAINT ck_users_status CHECK (status IN ('pending','active','suspended')),
        CONSTRAINT ck_users_phone  CHECK (phone IS NULL OR phone ~ '^\\+[1-9][0-9]{7,14}$'),
        CONSTRAINT ck_users_email  CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[a-z]{2,}$')
      );
      CREATE UNIQUE INDEX uq_users_email ON users (email) WHERE deleted_at IS NULL;
      CREATE INDEX idx_users_organization ON users (organization_id) WHERE deleted_at IS NULL;
      CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    // Table attendue par @adonisjs/auth (access tokens guard)
    this.schema.raw(`
      CREATE TABLE auth_access_tokens (
        id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        tokenable_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        type            text NOT NULL,
        name            text,
        hash            text NOT NULL,
        abilities       text NOT NULL DEFAULT '["*"]',
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        last_used_at    timestamptz,
        expires_at      timestamptz
      );
      CREATE INDEX idx_auth_access_tokens_tokenable ON auth_access_tokens (tokenable_id);
      CREATE UNIQUE INDEX uq_auth_access_tokens_hash ON auth_access_tokens (hash);
    `)

    // Rôles système livrés d'office (matrice de permissions à figer avec SISBM au Jalon 2)
    this.schema.raw(`
      INSERT INTO roles (code, name, description, permissions, is_system) VALUES
        ('super_admin', 'Super administrateur', 'Accès total, gestion des organisations', ARRAY['*'], true),
        ('admin',       'Administrateur',       'Gestion complète du périmètre de son organisation',
          ARRAY['vehicle:*','device:*','user:*','geofence:*','policy:*','alert:*','incident:*','report:*','command:*','billing:*'], true),
        ('supervisor',  'Superviseur',          'Supervision, traitement des alertes et incidents',
          ARRAY['vehicle:read','device:read','geofence:read','policy:read','alert:*','incident:*','report:read','command:request'], true),
        ('operator',    'Opérateur',            'Suivi temps réel et consultation',
          ARRAY['vehicle:read','device:read','geofence:read','alert:read','incident:read','report:read'], true),
        ('viewer',      'Consultation',         'Lecture seule',
          ARRAY['vehicle:read','alert:read','incident:read','report:read'], true);
    `)
  }

  async down() {
    this.schema.raw('DROP TABLE IF EXISTS auth_access_tokens')
    this.schema.raw('DROP TABLE IF EXISTS users')
    this.schema.raw('DROP TABLE IF EXISTS roles')
    this.schema.raw('DROP TABLE IF EXISTS organizations')
  }
}
