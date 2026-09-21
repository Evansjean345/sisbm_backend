import type { AuditLogPage } from '#application/audit/ports'

/**
 * Fenêtre temporelle des recherches d'audit.
 *
 * `audit_logs` est partitionnée par mois. Une requête sans borne balaierait
 * toutes les partitions — c'est la requête qui fait tomber la base un
 * vendredi soir. D'où deux garde-fous :
 *
 *   défaut  : 30 jours glissants
 *   plafond : 366 jours (au-delà, c'est un export, pas une consultation)
 */

const JOURS_PAR_DEFAUT = 30
const JOURS_MAX = 366
const JOUR_MS = 24 * 60 * 60 * 1000

export type Window =
  | { ok: true; from: Date; to: Date }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

export function resolveWindow(from?: string, to?: string): Window {
  const fin = to ? new Date(to) : new Date()
  const debut = from ? new Date(from) : new Date(fin.getTime() - JOURS_PAR_DEFAUT * JOUR_MS)

  if (debut >= fin) {
    return {
      ok: false,
      error: {
        code: 'E_INVALID_WINDOW',
        message: '`from` doit être antérieur à `to`',
        details: { from: debut.toISOString(), to: fin.toISOString() },
      },
    }
  }

  const jours = Math.ceil((fin.getTime() - debut.getTime()) / JOUR_MS)
  if (jours > JOURS_MAX) {
    return {
      ok: false,
      error: {
        code: 'E_WINDOW_TOO_WIDE',
        message: `La fenêtre de recherche ne peut excéder ${JOURS_MAX} jours`,
        details: { days: jours, maxDays: JOURS_MAX },
      },
    }
  }

  return { ok: true, from: debut, to: fin }
}

/** Format de pagination identique à celui de Lucid, pour que le front n'ait qu'un seul cas. */
export function serializeAuditPage(page: AuditLogPage, window: { from: Date; to: Date }) {
  return {
    meta: {
      total: page.total,
      perPage: page.perPage,
      currentPage: page.page,
      lastPage: Math.max(1, Math.ceil(page.total / page.perPage)),
      firstPage: 1,
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
    },
    data: page.entries.map((e) => ({
      ...e,
      occurredAt: e.occurredAt instanceof Date ? e.occurredAt.toISOString() : e.occurredAt,
    })),
  }
}
