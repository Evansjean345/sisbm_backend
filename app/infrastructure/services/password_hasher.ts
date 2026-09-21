import hash from '@adonisjs/core/services/hash'
import type { PasswordHasher } from '#application/identity/ports'

/** Adaptateur du port de hachage : délègue au driver configuré dans `config/hash.ts`. */
export class AdonisPasswordHasher implements PasswordHasher {
  make(plain: string): Promise<string> {
    return hash.make(plain)
  }
}
