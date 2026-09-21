import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Groupe de véhicules d'une organisation (table `vehicle_groups`, migration 003). */
export default class VehicleGroupModel extends BaseModel {
  static table = 'vehicle_groups'

  @column({ isPrimary: true }) declare id: string
  @column({ columnName: 'organization_id' }) declare organizationId: string
  @column() declare name: string
  @column() declare description: string | null
  @column() declare color: string | null
  @column.dateTime({ autoCreate: true, columnName: 'created_at' }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime
  @column.dateTime({ columnName: 'deleted_at', serializeAs: null })
  declare deletedAt: DateTime | null
}
