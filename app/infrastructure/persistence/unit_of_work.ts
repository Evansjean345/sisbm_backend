import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { DomainEvent } from '#domain/kernel'
import type { IsolationLevel, TransactionScope, UnitOfWork } from '#application/ports'

class LucidTransactionScope implements TransactionScope {
  readonly events: DomainEvent[] = []

  constructor(readonly raw: TransactionClientContract) {}

  collect(events: DomainEvent[]): void {
    this.events.push(...events)
  }
}

/**
 * Unit of Work adossé aux transactions Lucid.
 *
 * Deux garanties :
 *
 *  1. Le niveau d'isolation est explicite par cas d'usage. PostgreSQL exige
 *     que `SET TRANSACTION ISOLATION LEVEL` soit la première instruction de
 *     la transaction — d'où son émission immédiate après le BEGIN.
 *
 *  2. Les événements de domaine sont écrits dans `outbox_messages` AVANT le
 *     commit, et publiés seulement après (pattern Transactional Outbox).
 *     Aucun appel réseau n'a lieu pendant la transaction : c'est ce qui évite
 *     qu'un SMS parte pour une alerte dont le COMMIT a finalement échoué.
 */
export class LucidUnitOfWork implements UnitOfWork {
  async run<T>(
    handler: (tx: TransactionScope) => Promise<T>,
    options: { isolationLevel?: IsolationLevel } = {}
  ): Promise<T> {
    const trx = await db.transaction()
    const scope = new LucidTransactionScope(trx)

    try {
      if (options.isolationLevel) {
        await trx.rawQuery(
          `SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel.toUpperCase()}`
        )
      }

      const result = await handler(scope)

      if (scope.events.length > 0) {
        await trx.table('outbox_messages').multiInsert(
          scope.events.map((event) => ({
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

      await trx.commit()
      return result
    } catch (error) {
      await trx.rollback()
      throw error
    }
  }
}
