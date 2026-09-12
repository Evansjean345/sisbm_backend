import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * node ace sisbm:flespi:sync-commands
 *
 * Réconcilie toutes les commandes en vol (`queued` / `sent`) avec flespi :
 * acknowledged, failed ou expired. À planifier toutes les minutes (cron,
 * BullMQ repeatable, systemd timer) : sans cela, une commande dont personne
 * ne consulte le résultat bloque son boîtier jusqu'au prochain envoi.
 */
export default class FlespiSyncCommands extends BaseCommand {
  static commandName = 'sisbm:flespi:sync-commands'
  static description = 'Synchronise l’état des commandes boîtier avec flespi'
  static options: CommandOptions = { startApp: true }

  async run() {
    const { FlespiCommandTracker } =
      await import('#infrastructure/gateways/flespi/flespi_command_tracker')
    const tracker = await this.app.container.make(FlespiCommandTracker)
    const r = await tracker.syncAll()
    this.logger.success(
      `${r.devices} boîtier(s) : ${r.acknowledged} acquittée(s), ${r.failed} en échec, ` +
        `${r.expired} expirée(s), ${r.stillPending} en attente`
    )
  }
}
