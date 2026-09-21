import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Extensions PostgreSQL requises par SISBM CORE.
 *
 * - postgis      : types geography/geometry, index GIST, calculs de distance en mètres
 * - btree_gist   : indispensable aux contraintes EXCLUDE mêlant '=' (uuid) et '&&' (tstzrange)
 *                  sur device_assignments (contraintes CM-01 / CM-02)
 * - citext       : comparaison insensible à la casse (emails, immatriculations)
 * - pgcrypto     : gen_random_uuid()  (natif dès PG13, l'extension reste utile pour digest())
 * - pg_trgm      : recherche floue sur immatriculations / noms de véhicules
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw('CREATE EXTENSION IF NOT EXISTS postgis')
    this.schema.raw('CREATE EXTENSION IF NOT EXISTS btree_gist')
    this.schema.raw('CREATE EXTENSION IF NOT EXISTS citext')
    this.schema.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    this.schema.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm')

    // Trigger technique unique du projet : maintien de updated_at.
    // Aucune logique métier n'est placée en trigger (cf. doc §2-b).
    this.schema.raw(`
      CREATE OR REPLACE FUNCTION sisbm_set_updated_at()
      RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END;
      $$;
    `)

    // Création idempotente d'une partition mensuelle.
    // Appelée par la tâche planifiée mensuelle et par les migrations d'amorçage.
    this.schema.raw(`
      CREATE OR REPLACE FUNCTION sisbm_ensure_month_partition(p_parent text, p_month date)
      RETURNS text
      LANGUAGE plpgsql AS $$
      DECLARE
        v_start date := date_trunc('month', p_month)::date;
        v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
        v_name  text := p_parent || '_' || to_char(v_start, 'YYYYMM');
      BEGIN
        IF to_regclass(v_name) IS NULL THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            v_name, p_parent, v_start, v_end
          );
        END IF;
        RETURN v_name;
      END;
      $$;
    `)
  }

  async down() {
    this.schema.raw('DROP FUNCTION IF EXISTS sisbm_ensure_month_partition(text, date)')
    this.schema.raw('DROP FUNCTION IF EXISTS sisbm_set_updated_at()')
    // Les extensions ne sont volontairement pas supprimées :
    // d'autres objets de la base peuvent en dépendre.
  }
}
