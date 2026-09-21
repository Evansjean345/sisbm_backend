import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { HttpFlespiCommandGateway } from '#infrastructure/gateways/flespi/flespi_command_gateway'
import type { FlespiCommandResult } from '#infrastructure/gateways/flespi/flespi_types'

/**
 * =========================================================================
 *  SUIVI DES COMMANDES — réconciliation SISBM ↔ flespi
 * =========================================================================
 *
 * Défaut corrigé : une commande passait à `sent` et n'en sortait JAMAIS. Or
 * l'index `uq_device_commands_in_flight` (CM-09) n'autorise qu'UNE commande
 * `queued|sent` par boîtier : après la première commande, le boîtier était
 * bloqué définitivement (violation de contrainte → 409 à chaque essai).
 *
 * Ce service fait avancer la machine à états à partir de ce que flespi sait :
 *
 *   commands-result : executed=true   → acknowledged
 *                     executed=false  → failed (motif flespi / boîtier)
 *   absent de la file ET du résultat, échéance passée → expired
 *
 * Il est appelé : avant chaque nouvelle commande (le boîtier se débloque
 * de lui-même), à la demande (`POST /devices/:id/commands/sync`) et
 * périodiquement par `node ace sisbm:flespi:sync-commands`.
 */

interface LigneEnVol {
  id: string
  status: string
  provider_command_id: string | null
  expires_at: Date
}

export interface SyncReport {
  acknowledged: number
  failed: number
  expired: number
  stillPending: number
}

export class FlespiCommandTracker {
  constructor(private readonly gateway: HttpFlespiCommandGateway) {}

  async sync(deviceId: string, flespiDeviceId: number): Promise<SyncReport> {
    const rapport: SyncReport = { acknowledged: 0, failed: 0, expired: 0, stillPending: 0 }

    const lignes = (await db
      .from('device_commands')
      .where('device_id', deviceId)
      .whereIn('status', ['queued', 'sent'])
      .select('id', 'status', 'provider_command_id', 'expires_at')) as LigneEnVol[]
    if (lignes.length === 0) return rapport

    let resultats: FlespiCommandResult[] = []
    let enFile = new Set<string>()
    try {
      const [r, p] = await Promise.all([
        this.gateway.results(flespiDeviceId),
        this.gateway.pending(flespiDeviceId),
      ])
      resultats = r
      enFile = new Set(p.map((c) => String(c.id)))
    } catch (err) {
      // flespi injoignable : on n'expire que ce qui est manifestement périmé.
      logger.warn({ err, flespiDeviceId }, '[commands] synchronisation flespi impossible')
    }

    const parId = new Map<string, FlespiCommandResult>()
    for (const r of resultats) {
      parId.set(String(r.id), r)
      if (r.command_id !== undefined) parId.set(String(r.command_id), r)
    }

    for (const l of lignes) {
      const res = l.provider_command_id ? parId.get(l.provider_command_id) : undefined

      if (res && res.executed) {
        await this.transition(
          l,
          'acknowledged',
          {
            acknowledged_at: new Date(res.timestamp * 1000),
          },
          { response: res.response ?? null }
        )
        rapport.acknowledged++
      } else if (res && !res.executed) {
        const motif = String(res.reason ?? res.response ?? 'refusée par le boîtier ou flespi')
        await this.transition(
          l,
          'failed',
          { failed_at: new Date(), error_message: motif },
          { flespi: res }
        )
        rapport.failed++
      } else if (
        new Date(l.expires_at).getTime() < Date.now() &&
        !(l.provider_command_id && enFile.has(l.provider_command_id))
      ) {
        await this.transition(l, 'expired', {}, { note: 'échéance dépassée sans résultat flespi' })
        rapport.expired++
      } else {
        rapport.stillPending++
      }
    }

    if (rapport.acknowledged || rapport.failed || rapport.expired) {
      logger.info({ deviceId, flespiDeviceId, ...rapport }, '[commands] synchronisées avec flespi')
    }
    return rapport
  }

  /**
   * Synchronise le boîtier actuellement monté sur un véhicule.
   *
   * Appelé avant un rétablissement : si la coupure précédente est terminée
   * chez flespi mais encore `sent` chez nous, la contrainte CM-09 bloquerait
   * la nouvelle commande.
   */
  async syncVehicle(vehicleId: string): Promise<SyncReport | null> {
    const device = await db
      .from('device_assignments as da')
      .join('devices as d', 'd.id', 'da.device_id')
      .where('da.vehicle_id', vehicleId)
      .whereRaw('upper_inf(da.period)')
      .whereNotNull('d.flespi_device_id')
      .select('d.id', 'd.flespi_device_id')
      .first()

    if (!device) return null
    return this.sync(String(device.id), Number(device.flespi_device_id))
  }

  /** Synchronise tous les boîtiers ayant une commande en vol. */
  async syncAll(): Promise<SyncReport & { devices: number }> {
    const total = { acknowledged: 0, failed: 0, expired: 0, stillPending: 0, devices: 0 }
    const devices = await db
      .from('device_commands as c')
      .join('devices as d', 'd.id', 'c.device_id')
      .whereIn('c.status', ['queued', 'sent'])
      .whereNotNull('d.flespi_device_id')
      .distinct('d.id', 'd.flespi_device_id')

    for (const d of devices as Array<{ id: string; flespi_device_id: number | string }>) {
      const r = await this.sync(String(d.id), Number(d.flespi_device_id))
      total.acknowledged += r.acknowledged
      total.failed += r.failed
      total.expired += r.expired
      total.stillPending += r.stillPending
      total.devices++
    }
    return total
  }

  private async transition(
    l: LigneEnVol,
    vers: 'acknowledged' | 'failed' | 'expired',
    champs: Record<string, unknown>,
    payload: Record<string, unknown>
  ): Promise<void> {
    await db.transaction(async (trx) => {
      const n = await trx
        .from('device_commands')
        .where('id', l.id)
        .where('status', l.status) // garde optimiste : pas de double transition
        .update({ status: vers, ...champs })
      if (!n || (Array.isArray(n) && n.length === 0)) return
      await trx.table('device_command_logs').insert({
        command_id: l.id,
        status_from: l.status,
        status_to: vers,
        actor_type: 'system',
        payload: JSON.stringify(payload),
      })
    })
  }
}
