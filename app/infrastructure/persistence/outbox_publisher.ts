import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { DomainEvent } from '#domain/kernel'
import type { EventPublisher } from '#application/ports'

/**
 * Publication hors transaction, pour les rares cas où aucun Unit of Work
 * n'est en cours. Le chemin normal reste l'outbox écrite par le UoW.
 */
export class OutboxEventPublisher implements EventPublisher {
  async publish(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return

    await db.table('outbox_messages').multiInsert(
      events.map((event) => ({
        aggregate_type: event.eventName.split('.')[0],
        aggregate_id: event.aggregateId,
        topic: event.eventName,
        payload: JSON.stringify({
          eventName: event.eventName,
          aggregateId: event.aggregateId,
          occurredAt: event.occurredAt.toISOString(),
          ...event.payload,
        }),
        status: 'pending',
        available_at: DateTime.now().toSQL(),
      }))
    )
  }
}
