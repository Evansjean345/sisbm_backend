import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class VehicleModel extends BaseModel {
  static table = 'vehicles'

  @column({ isPrimary: true }) declare id: string
  @column({ columnName: 'organization_id' }) declare organizationId: string
  @column() declare registration: string
  @column() declare vin: string | null
  @column() declare label: string | null
  @column() declare brand: string | null
  @column() declare model: string | null
  @column() declare year: number | null
  @column({ columnName: 'vehicle_type' }) declare vehicleType: string
  @column() declare color: string | null
  @column() declare status: string
  @column({ columnName: 'odometer_km' }) declare odometerKm: number
  @column({ columnName: 'speed_limit_kph' }) declare speedLimitKph: number | null
  @column({ columnName: 'immobilization_enabled' }) declare immobilizationEnabled: boolean
  @column() declare notes: string | null
  @column.dateTime({ autoCreate: true, columnName: 'created_at' }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime
  @column.dateTime({ columnName: 'deleted_at', serializeAs: null })
  declare deletedAt: DateTime | null
}
