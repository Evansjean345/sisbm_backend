import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Organisation cliente (locataire).
 *
 * Toutes les données métier — véhicules, boîtiers, comptes, alertes — portent
 * un `organization_id` : c'est la frontière de cloisonnement entre clients.
 */
export default class OrganizationModel extends BaseModel {
  static table = 'organizations'

  @column({ isPrimary: true }) declare id: string
  @column() declare code: string
  @column() declare name: string
  @column({ columnName: 'contact_email' }) declare contactEmail: string | null
  @column({ columnName: 'contact_phone' }) declare contactPhone: string | null
  @column({ columnName: 'country_code' }) declare countryCode: string
  @column() declare timezone: string
  @column() declare currency: string
  @column({ columnName: 'is_active' }) declare isActive: boolean

  /** jsonb : le pilote pg le relit en objet ; on le sérialise à l'écriture. */
  @column({ prepare: (value: unknown) => JSON.stringify(value ?? {}) })
  declare settings: Record<string, unknown>

  @column.dateTime({ autoCreate: true, columnName: 'created_at' }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime
  @column.dateTime({ columnName: 'deleted_at', serializeAs: null })
  declare deletedAt: DateTime | null
}
