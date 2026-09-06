import transmit from '@adonisjs/transmit/services/main'
import logger from '@adonisjs/core/services/logger'
import type { RealtimeBroadcaster } from '#application/telemetry/ports'

/**
 * Diffusion temps réel vers les tableaux de bord (SSE).
 *
 * Le canal est cloisonné par organisation : un client ne peut pas s'abonner au
 * flux d'une autre entité.
 *
 * Best-effort volontaire : un échec de diffusion ne doit JAMAIS faire échouer
 * l'ingestion. La position est déjà persistée — perdre un rafraîchissement
 * d'écran est sans conséquence, perdre une position ne l'est pas.
 */
export class TransmitBroadcaster implements RealtimeBroadcaster {
  async publishPosition(organizationId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      transmit.broadcast(`org/${organizationId}/positions`, payload as never)
    } catch (err) {
      logger.warn({ err, organizationId }, '[realtime] diffusion en échec — sans incidence')
    }
  }
}

/** Diffuseur muet, pour les tests. */
export class NoopBroadcaster implements RealtimeBroadcaster {
  readonly published: Array<{ organizationId: string; payload: Record<string, unknown> }> = []

  async publishPosition(organizationId: string, payload: Record<string, unknown>): Promise<void> {
    this.published.push({ organizationId, payload })
  }
}
