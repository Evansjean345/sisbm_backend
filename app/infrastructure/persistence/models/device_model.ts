import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class DeviceModel extends BaseModel {
  static table = 'devices'

  @column({ isPrimary: true }) declare id: string
  @column({ columnName: 'organization_id' }) declare organizationId: string
  @column() declare imei: string
  @column({ columnName: 'serial_number' }) declare serialNumber: string | null
  @column() declare manufacturer: string
  @column() declare model: string
  @column() declare protocol: string | null
  @column({ columnName: 'firmware_version' }) declare firmwareVersion: string | null
  @column({ columnName: 'has_relay' }) declare hasRelay: boolean
  @column({ columnName: 'sim_msisdn' }) declare simMsisdn: string | null
  @column({ columnName: 'sim_iccid' }) declare simIccid: string | null
  @column({ columnName: 'sim_operator' }) declare simOperator: string | null
  @column({ columnName: 'flespi_device_id' }) declare flespiDeviceId: number | null
  @column({ columnName: 'flespi_channel_id' }) declare flespiChannelId: number | null
  @column({ columnName: 'flespi_ident' }) declare flespiIdent: string | null
  @column() declare status: string
  @column.dateTime({ columnName: 'last_seen_at' }) declare lastSeenAt: DateTime | null
  @column({ columnName: 'last_gsm_signal' }) declare lastGsmSignal: number | null
  @column({ columnName: 'last_battery_pct' }) declare lastBatteryPct: number | null
  @column() declare notes: string | null
  @column.dateTime({ autoCreate: true, columnName: 'created_at' }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime
  @column.dateTime({ columnName: 'deleted_at', serializeAs: null })
  declare deletedAt: DateTime | null
}
