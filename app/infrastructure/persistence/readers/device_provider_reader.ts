import db from '@adonisjs/lucid/services/db'
import type { DeviceProviderReader, ProviderDevice } from '#application/security/ports'

/**
 * Rattachement d'un boîtier SISBM à son device flespi.
 *
 * Le contexte Sécurité ne connaît que `externalDeviceId` : le jour où la
 * plateforme change de fournisseur télématique, seul cet adaptateur bouge.
 */
export class LucidDeviceProviderReader implements DeviceProviderReader {
  async readProviderDevice(deviceId: string): Promise<ProviderDevice | null> {
    const r = await db.rawQuery(
      `SELECT id, flespi_device_id, has_relay
         FROM devices
        WHERE id = :deviceId AND deleted_at IS NULL
        LIMIT 1`,
      { deviceId }
    )

    const row = r.rows?.[0]
    if (!row) return null

    return {
      deviceId: String(row.id),
      externalDeviceId: row.flespi_device_id ? String(row.flespi_device_id) : null,
      hasRelay: Boolean(row.has_relay),
    }
  }
}
