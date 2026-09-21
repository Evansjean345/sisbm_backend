import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Groupes de boîtiers — Jalon 2, extension des routes.
 *
 * Symétrique de `vehicle_groups` / `vehicle_group_members` (migration 003) :
 * mêmes conventions de nommage, mêmes contraintes, même suppression logique.
 * Un boîtier peut appartenir à plusieurs groupes (clé primaire composite) —
 * un groupe « SIM Orange » et un groupe « Lot 2026 » se recoupent légitimement.
 *
 * Ajoute par ailleurs l'habilitation `audit:read` au rôle système `admin` :
 * sans elle, un administrateur client ne pourrait pas consulter le journal
 * d'audit de sa propre organisation (`GET /api/v1/audit-logs`).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE device_groups (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        name            text NOT NULL,
        description     text,
        color           text,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        deleted_at      timestamptz,
        CONSTRAINT ck_device_groups_color CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$')
      );
      CREATE UNIQUE INDEX uq_device_groups_org_name ON device_groups (organization_id, lower(name))
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_device_groups_organization ON device_groups (organization_id)
        WHERE deleted_at IS NULL;
      CREATE TRIGGER trg_device_groups_updated_at BEFORE UPDATE ON device_groups
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE TABLE device_group_members (
        device_group_id uuid NOT NULL REFERENCES device_groups (id) ON DELETE CASCADE,
        device_id       uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
        added_at        timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (device_group_id, device_id)
      );
      CREATE INDEX idx_device_group_members_device ON device_group_members (device_id);
    `)

    /**
     * Le cloisonnement « un membre appartient à l'organisation de son groupe »
     * n'est pas exprimable en FK simple (il traverse deux tables). Il est tenu
     * par le dépôt applicatif, et vérifié ici par un trigger : aucun script
     * lancé à la main ne peut mélanger deux clients.
     */
    this.schema.raw(`
      CREATE OR REPLACE FUNCTION sisbm_check_group_member_tenant()
      RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        org_groupe uuid;
        org_membre uuid;
      BEGIN
        IF TG_TABLE_NAME = 'device_group_members' THEN
          SELECT organization_id INTO org_groupe FROM device_groups WHERE id = NEW.device_group_id;
          SELECT organization_id INTO org_membre FROM devices        WHERE id = NEW.device_id;
        ELSE
          SELECT organization_id INTO org_groupe FROM vehicle_groups WHERE id = NEW.vehicle_group_id;
          SELECT organization_id INTO org_membre FROM vehicles       WHERE id = NEW.vehicle_id;
        END IF;

        IF org_groupe IS DISTINCT FROM org_membre THEN
          RAISE EXCEPTION 'CM-17 : le membre (%) et le groupe (%) appartiennent a des organisations differentes',
            org_membre, org_groupe
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;

      CREATE TRIGGER trg_device_group_members_tenant
        BEFORE INSERT OR UPDATE ON device_group_members
        FOR EACH ROW EXECUTE FUNCTION sisbm_check_group_member_tenant();

      CREATE TRIGGER trg_vehicle_group_members_tenant
        BEFORE INSERT OR UPDATE ON vehicle_group_members
        FOR EACH ROW EXECUTE FUNCTION sisbm_check_group_member_tenant();
    `)

    this.schema.raw(`
      UPDATE roles
         SET permissions = array_append(permissions, 'audit:read')
       WHERE code = 'admin'
         AND organization_id IS NULL
         AND NOT ('audit:read' = ANY (permissions));
    `)
  }

  async down() {
    this.schema.raw(`
      UPDATE roles
         SET permissions = array_remove(permissions, 'audit:read')
       WHERE code = 'admin' AND organization_id IS NULL;
    `)
    this.schema.raw(
      'DROP TRIGGER IF EXISTS trg_vehicle_group_members_tenant ON vehicle_group_members'
    )
    this.schema.raw('DROP TABLE IF EXISTS device_group_members')
    this.schema.raw('DROP TABLE IF EXISTS device_groups')
    this.schema.raw('DROP FUNCTION IF EXISTS sisbm_check_group_member_tenant()')
  }
}
