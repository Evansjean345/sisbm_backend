import { randomUUID } from 'node:crypto'
import type { IdGenerator } from '#application/ports'

/**
 * Génération d'identifiants côté applicatif plutôt que par la base.
 *
 * L'agrégat connaît ainsi son identité avant toute persistance : les
 * événements de domaine peuvent la référencer, et un cas d'usage se teste
 * sans base de données.
 */
export class UuidGenerator implements IdGenerator {
  generate(): string {
    return randomUUID()
  }
}
