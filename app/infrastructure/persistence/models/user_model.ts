import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import hash from '@adonisjs/core/services/hash'

/**
 * Modèle utilisateur.
 *
 * Le contexte Identity suit le style PRAGMATIQUE : pas d'agrégat, pas de
 * repository, le modèle Lucid est manipulé directement. Son domaine se réduit
 * à du CRUD et à de l'authentification — l'abstraction n'apporterait ici que
 * du bruit (cf. docs/03-architecture §3).
 */

export default class UserModel extends BaseModel {
  static table = 'users'

  @column({ isPrimary: true })
  declare id: string

  @column({ columnName: 'organization_id' })
  declare organizationId: string

  @column({ columnName: 'role_id' })
  declare roleId: string

  @column()
  declare email: string

  @column({ columnName: 'password_hash', serializeAs: null })
  declare passwordHash: string

  @column({ columnName: 'full_name' })
  declare fullName: string

  @column()
  declare phone: string | null

  @column()
  declare status: 'pending' | 'active' | 'suspended'

  @column()
  declare locale: string

  @column()
  declare timezone: string

  @column.dateTime({ columnName: 'last_login_at' })
  declare lastLoginAt: DateTime | null

  @column({ columnName: 'last_login_ip' })
  declare lastLoginIp: string | null

  @column({ columnName: 'failed_attempts' })
  declare failedAttempts: number

  @column.dateTime({ columnName: 'locked_until' })
  declare lockedUntil: DateTime | null

  @column.dateTime({ autoCreate: true, columnName: 'created_at' })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime

  @column.dateTime({ columnName: 'deleted_at', serializeAs: null })
  declare deletedAt: DateTime | null

  static accessTokens = DbAccessTokensProvider.forModel(UserModel, {
    expiresIn: '7 days',
    prefix: 'sisbm_',
    table: 'auth_access_tokens',
    type: 'auth_token',
    tokenSecretLength: 40,
  })

  async verifyPassword(plain: string): Promise<boolean> {
    return hash.verify(this.passwordHash, plain)
  }

  get isActive(): boolean {
    return this.status === 'active' && this.deletedAt === null
  }

  get isLocked(): boolean {
    return this.lockedUntil !== null && this.lockedUntil > DateTime.now()
  }
}
