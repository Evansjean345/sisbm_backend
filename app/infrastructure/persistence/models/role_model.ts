import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Rôle RBAC. `organization_id` NULL = rôle système, partagé par toutes les
 * organisations (contrainte `ck_roles_scope`).
 */
export default class RoleModel extends BaseModel {
  static table = 'roles'

  @column({ isPrimary: true }) declare id: string
  @column({ columnName: 'organization_id' }) declare organizationId: string | null
  @column() declare code: string
  @column() declare name: string
  @column() declare description: string | null
  @column() declare permissions: string[]
  @column({ columnName: 'is_system' }) declare isSystem: boolean
  @column.dateTime({ autoCreate: true, columnName: 'created_at' }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime
}
