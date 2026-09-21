import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Relâche la contrainte de longueur sur `devices.imei`.
 *
 * La contrainte initiale imposait exactement 15 chiffres — la longueur d'un
 * IMEI Micodus. Or le parc SISBM comprend aussi des Teltonika, et d'autres
 * protocoles emploient des identifiants de longueurs différentes. Figer 15
 * rejetait du matériel parfaitement valide.
 *
 * On conserve le contrôle de NATURE (que des chiffres) : il suffit à écarter
 * les chaînes vides, les identifiants tronqués et les injections, sans
 * présumer du constructeur.
 *
 * Migration ADDITIVE : la nouvelle règle est plus permissive que l'ancienne,
 * aucune ligne existante ne peut la violer.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`ALTER TABLE devices DROP CONSTRAINT IF EXISTS ck_devices_imei`)
    this.schema.raw(`ALTER TABLE devices ADD CONSTRAINT ck_devices_imei CHECK (imei ~ '^[0-9]+$')`)
  }

  async down() {
    this.schema.raw(`ALTER TABLE devices DROP CONSTRAINT IF EXISTS ck_devices_imei`)
    // Retour à la règle stricte : possible uniquement si aucun boîtier hors
    // format 15 chiffres n'a été enregistré entre-temps.
    this.schema.raw(
      `ALTER TABLE devices ADD CONSTRAINT ck_devices_imei CHECK (imei ~ '^[0-9]{15}$')`
    )
  }
}
