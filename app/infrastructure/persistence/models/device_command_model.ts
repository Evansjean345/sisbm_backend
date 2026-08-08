import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * Modèle Lucid — DÉTAIL D'INFRASTRUCTURE.
 *
 * Il ne sort jamais de la couche `infrastructure/`. Aucun contrôleur, aucun
 * cas d'usage ne l'importe : ils manipulent l'agrégat DeviceCommand.
 * C'est ce qui permet de remplacer Lucid sans toucher au métier — et surtout
 * d'empêcher que des règles de sécurité finissent dans un hook de modèle.
 */
export default class DeviceCommandModel extends BaseModel {
  static table = 'device_commands'

  @column({ isPrimary: true })
  declare id: string

  @column({ columnName: 'organization_id' })
  declare organizationId: string

  @column({ columnName: 'device_id' })
  declare deviceId: string

  @column({ columnName: 'vehicle_id' })
  declare vehicleId: string | null

  @column({ columnName: 'command_type' })
  declare commandType: string

  @column()
  declare status: string

  @column()
  declare reason: string

  @column()
  declare origin: string

  @column({ columnName: 'policy_id' })
  declare policyId: string | null

  @column({ columnName: 'alert_id' })
  declare alertId: string | null

  @column({ columnName: 'requested_by' })
  declare requestedBy: string | null

  @column.dateTime({ columnName: 'requested_at' })
  declare requestedAt: DateTime

  @column({ columnName: 'safety_speed_limit_kph' })
  declare safetySpeedLimitKph: number

  @column({ columnName: 'speed_at_request_kph' })
  declare speedAtRequestKph: number | null

  @column({ columnName: 'ignition_at_request' })
  declare ignitionAtRequest: boolean | null

  @column({ columnName: 'requires_validation' })
  declare requiresValidation: boolean

  @column({ columnName: 'validated_by' })
  declare validatedBy: string | null

  @column.dateTime({ columnName: 'validated_at' })
  declare validatedAt: DateTime | null

  @column({ columnName: 'rejection_reason' })
  declare rejectionReason: string | null

  @column.dateTime({ columnName: 'queued_at' })
  declare queuedAt: DateTime | null

  @column.dateTime({ columnName: 'sent_at' })
  declare sentAt: DateTime | null

  @column.dateTime({ columnName: 'acknowledged_at' })
  declare acknowledgedAt: DateTime | null

  @column.dateTime({ columnName: 'failed_at' })
  declare failedAt: DateTime | null

  @column({ columnName: 'error_message' })
  declare errorMessage: string | null

  @column({ columnName: 'provider_command_id' })
  declare providerCommandId: string | null

  @column()
  declare attempts: number

  @column.dateTime({ columnName: 'expires_at' })
  declare expiresAt: DateTime

  @column.dateTime({ autoCreate: true, columnName: 'created_at' })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime
}
