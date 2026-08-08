import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { AuditLogger, ExecutionContext } from '#application/ports'

/**
 * Écriture append-only dans `audit_logs` (TDR §II.5).
 *
 * Volontairement HORS de la transaction métier : une panne d'écriture d'audit
 * ne doit pas annuler une opération légitime. En contrepartie, la table est
 * partitionnée et le rôle applicatif n'a ni UPDATE ni DELETE dessus — la
 * garantie d'inaltérabilité vient de la base, pas du code.
 */

export class LucidAuditLogger implements AuditLogger {
  async record(entry: {
    context: ExecutionContext
    action: string
    resourceType: string
    resourceId?: string
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }): Promise<void> {
    await db.table('audit_logs').insert({
      organization_id: entry.context.organizationId,
      actor_id: entry.context.actorId,
      actor_type: entry.context.actorType,
      actor_ip: entry.context.ip ?? null,
      user_agent: entry.context.userAgent ?? null,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      before_state: entry.before ? JSON.stringify(entry.before) : null,
      after_state: entry.after ? JSON.stringify(entry.after) : null,
      metadata: JSON.stringify({ ...entry.metadata, requestId: entry.context.requestId }),
      occurred_at: DateTime.now().toSQL(),
    })
  }
}
