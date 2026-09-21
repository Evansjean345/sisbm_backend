/**
 * =========================================================================
 *  PORT DE LECTURE DU JOURNAL D'AUDIT
 * =========================================================================
 *
 * `audit_logs` est append-only et PARTITIONNÉE par mois (migration 010) : le
 * rôle applicatif n'a ni UPDATE ni DELETE dessus. Le port n'expose donc que
 * de la lecture — il n'existe pas d'écriture depuis HTTP, c'est `AuditLogger`
 * qui trace, depuis les cas d'usage.
 *
 * La FENÊTRE TEMPORELLE est obligatoire dans la requête : sans elle,
 * PostgreSQL balaierait toutes les partitions, y compris celles de l'année
 * précédente. L'appelant applique un défaut (30 jours), jamais « tout ».
 */

export interface AuditLogQuery {
  /** Organisations consultables. Vide = toutes (exploitant plateforme). */
  organizationIds: string[]
  from: Date
  to: Date
  action?: string
  resourceType?: string
  resourceId?: string
  actorId?: string
  /** Restreint à un ensemble de ressources — utilisé par les groupes. */
  resourceScope?: { resourceType: string; resourceIds: string[] }[]
  page: number
  perPage: number
}

export interface AuditLogEntry {
  id: string
  organizationId: string | null
  actorId: string | null
  actorType: string
  actorEmail: string | null
  actorName: string | null
  actorIp: string | null
  action: string
  resourceType: string
  resourceId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  metadata: Record<string, unknown>
  occurredAt: Date
}

export interface AuditLogPage {
  entries: AuditLogEntry[]
  total: number
  page: number
  perPage: number
}

export interface AuditLogReader {
  search(query: AuditLogQuery): Promise<AuditLogPage>
  /** Valeurs distinctes d'`action` sur la fenêtre — alimente les filtres du tableau de bord. */
  actions(organizationIds: string[], from: Date, to: Date): Promise<string[]>
}
