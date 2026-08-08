import db from '@adonisjs/lucid/services/db'
import type { PermissionReader } from '#application/ports'

/**
 * Lecture des permissions portées par le rôle (`roles.permissions text[]`).
 *
 * Le RBAC est plat par conception : une seule lecture suffit, et le résultat
 * est mis en cache pour la durée de la requête par l'appelant.
 */

export class LucidPermissionReader implements PermissionReader {
  async readPermissions(roleId: string): Promise<string[]> {
    const row = await db.from('roles').where('id', roleId).select('permissions').first()
    return (row?.permissions as string[]) ?? []
  }
}
