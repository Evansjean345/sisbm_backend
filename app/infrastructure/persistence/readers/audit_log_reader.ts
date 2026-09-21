import db from '@adonisjs/lucid/services/db'
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder'
import type {
  AuditLogEntry,
  AuditLogPage,
  AuditLogQuery,
  AuditLogReader,
} from '#application/audit/ports'

/**
 * Lecture du journal d'audit.
 *
 * Trois points méritent l'attention :
 *
 *  ① `occurred_at` est la clé de partitionnement : l'encadrer dans TOUTES les
 *    requêtes permet le partition pruning. Sans borne, une recherche lirait
 *    quinze partitions pour rendre vingt-cinq lignes.
 *
 *  ② L'acteur est joint en LEFT JOIN sur `users` : un compte supprimé
 *    logiquement doit continuer d'apparaître, sinon l'audit devient anonyme
 *    — exactement ce que la suppression logique des comptes évite.
 *
 *  ③ `resourceScope` traduit « les logs de ce groupe » : une disjonction de
 *    couples (type, identifiants), par exemple le groupe lui-même ET ses
 *    véhicules membres.
 */
export class LucidAuditLogReader implements AuditLogReader {
  async search(query: AuditLogQuery): Promise<AuditLogPage> {
    const base = () => {
      const q = db
        .from('audit_logs as a')
        .where('a.occurred_at', '>=', query.from)
        .where('a.occurred_at', '<', query.to)

      if (query.organizationIds.length > 0) {
        q.whereIn('a.organization_id', query.organizationIds)
      }
      if (query.action) q.where('a.action', query.action)
      if (query.resourceType) q.where('a.resource_type', query.resourceType)
      if (query.resourceId) q.where('a.resource_id', query.resourceId)
      if (query.actorId) q.where('a.actor_id', query.actorId)

      if (query.resourceScope) {
        // Un groupe vide ne doit rien renvoyer : la disjonction reste vide,
        // et `whereRaw('false')` l'exprime sans cas particulier plus haut.
        const scopes = query.resourceScope.filter((s) => s.resourceIds.length > 0)
        if (scopes.length === 0) {
          q.whereRaw('false')
        } else {
          q.where((outer: DatabaseQueryBuilderContract) => {
            for (const scope of scopes) {
              outer.orWhere((inner: DatabaseQueryBuilderContract) => {
                inner
                  .where('a.resource_type', scope.resourceType)
                  .whereIn('a.resource_id', scope.resourceIds)
              })
            }
          })
        }
      }
      return q
    }

    const compte = await base().count('* as total').first()
    const total = Number(compte?.total ?? 0)

    const rows =
      total === 0
        ? []
        : await base()
            .leftJoin('users as u', 'u.id', 'a.actor_id')
            .orderBy('a.occurred_at', 'desc')
            .orderBy('a.id', 'desc')
            .offset((query.page - 1) * query.perPage)
            .limit(query.perPage)
            .select(
              'a.id',
              'a.organization_id',
              'a.actor_id',
              'a.actor_type',
              'a.actor_label',
              'a.actor_ip',
              'a.action',
              'a.resource_type',
              'a.resource_id',
              'a.before_state',
              'a.after_state',
              'a.metadata',
              'a.occurred_at',
              'u.email as actor_email',
              'u.full_name as actor_name'
            )

    return {
      entries: rows.map(toEntry),
      total,
      page: query.page,
      perPage: query.perPage,
    }
  }

  async actions(organizationIds: string[], from: Date, to: Date): Promise<string[]> {
    const q = db
      .from('audit_logs')
      .where('occurred_at', '>=', from)
      .where('occurred_at', '<', to)
      .distinct('action')
      .orderBy('action')
    if (organizationIds.length > 0) q.whereIn('organization_id', organizationIds)

    const rows = await q
    return rows.map((r) => r.action as string)
  }
}

function toEntry(row: Record<string, unknown>): AuditLogEntry {
  return {
    // `id` est un bigint : le pilote pg le rend en chaîne, et c'est heureux —
    // au-delà de 2^53 un number JavaScript perdrait des unités.
    id: String(row.id),
    organizationId: (row.organization_id as string) ?? null,
    actorId: (row.actor_id as string) ?? null,
    actorType: row.actor_type as string,
    actorEmail: (row.actor_email as string) ?? null,
    actorName: ((row.actor_name ?? row.actor_label) as string) ?? null,
    actorIp: (row.actor_ip as string) ?? null,
    action: row.action as string,
    resourceType: row.resource_type as string,
    resourceId: (row.resource_id as string) ?? null,
    before: jsonb(row.before_state),
    after: jsonb(row.after_state),
    metadata: jsonb(row.metadata) ?? {},
    occurredAt: row.occurred_at as Date,
  }
}

function jsonb(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return value as Record<string, unknown>
}
