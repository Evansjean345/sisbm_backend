import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Ajoute `trips.last_point_at`.
 *
 * L'agrégat `Trip` en a besoin pour deux choses que `ended_at` ne peut pas
 * fournir sur un trajet OUVERT :
 *
 *  ① Rejeter les positions arrivées dans le désordre. Le Store & Forward ne
 *     garantit pas l'ordre : sans repère du dernier point traité, une trame
 *     ancienne rejouée ferait régresser la distance accumulée.
 *
 *  ② Détecter les trajets orphelins. Un trajet dont le contact OFF s'est perdu
 *     reste ouvert indéfiniment et bloque l'ouverture du suivant, à cause de
 *     l'index unique partiel `WHERE status = 'open'`. Le balayage
 *     `close_stale_trips` s'appuie sur cette colonne.
 *
 * Migration additive : valeur initialisée depuis l'existant, aucune perte.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS last_point_at timestamptz`)
    this.schema.raw(
      `UPDATE trips SET last_point_at = COALESCE(ended_at, started_at) WHERE last_point_at IS NULL`
    )
    this.schema.raw(`ALTER TABLE trips ALTER COLUMN last_point_at SET NOT NULL`)
    // Index du balayage des trajets orphelins.
    this.schema.raw(
      `CREATE INDEX IF NOT EXISTS idx_trips_open_last_point
         ON trips (last_point_at) WHERE status = 'open'`
    )
  }

  async down() {
    this.schema.raw(`DROP INDEX IF EXISTS idx_trips_open_last_point`)
    this.schema.raw(`ALTER TABLE trips DROP COLUMN IF EXISTS last_point_at`)
  }
}
