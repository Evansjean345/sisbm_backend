import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Groupe de boîtiers d'une organisation (table `device_groups`, migration 013). */
export default class DeviceGroupModel extends BaseModel {
  static table = 'device_groups'

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
