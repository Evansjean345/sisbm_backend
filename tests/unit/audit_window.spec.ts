import { test } from '@japa/runner'
import { resolveWindow, serializeAuditPage } from '#presentation/http/support/audit_window'

/**
 * =========================================================================
 *  FENÊTRE D'AUDIT — le garde-fou du partitionnement
 * =========================================================================
 *
 * `audit_logs` est partitionnée par mois. Une recherche sans borne balaierait
 * toutes les partitions ; ces règles l'empêchent, et se testent sans base.
 */

const JOUR = 24 * 60 * 60 * 1000

test.group('Audit — fenêtre de recherche', () => {
  test('sans borne : 30 jours glissants', ({ assert }) => {
    const w = resolveWindow()
    assert.isTrue(w.ok)
    if (!w.ok) return
    const jours = Math.round((w.to.getTime() - w.from.getTime()) / JOUR)
    assert.equal(jours, 30)
  })

  test('bornes explicites conservées', ({ assert }) => {
    const w = resolveWindow('2026-09-01T00:00:00Z', '2026-09-10T00:00:00Z')
    assert.isTrue(w.ok)
    if (!w.ok) return
    assert.equal(w.from.toISOString(), '2026-09-01T00:00:00.000Z')
    assert.equal(w.to.toISOString(), '2026-09-10T00:00:00.000Z')
  })

  test('`from` postérieur à `to` : refusé', ({ assert }) => {
    const w = resolveWindow('2026-09-19T00:00:00Z', '2026-09-01T00:00:00Z')
    assert.isFalse(w.ok)
    if (!w.ok) assert.equal(w.error.code, 'E_INVALID_WINDOW')
  })

  test('au-delà de 366 jours : refusé', ({ assert }) => {
    const w = resolveWindow('2020-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    assert.isFalse(w.ok)
    if (!w.ok) assert.equal(w.error.code, 'E_WINDOW_TOO_WIDE')
  })

  test('exactement 366 jours : accepté (limite incluse)', ({ assert }) => {
    const to = new Date('2026-09-19T00:00:00Z')
    const from = new Date(to.getTime() - 366 * JOUR)
    assert.isTrue(resolveWindow(from.toISOString(), to.toISOString()).ok)
  })

  test('367 jours : refusé', ({ assert }) => {
    const to = new Date('2026-09-19T00:00:00Z')
    const from = new Date(to.getTime() - 367 * JOUR)
    assert.isFalse(resolveWindow(from.toISOString(), to.toISOString()).ok)
  })
})

test.group('Audit — sérialisation de page', () => {
  const fenetre = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-19T00:00:00Z') }

  test('meta compatible avec la pagination Lucid, fenêtre rappelée', ({ assert }) => {
    const page = serializeAuditPage(
      {
        entries: [
          {
            id: '42',
            organizationId: 'org',
            actorId: null,
            actorType: 'system',
            actorEmail: null,
            actorName: null,
            actorIp: null,
            action: 'fleet.vehicle_group.created',
            resourceType: 'vehicle_group',
            resourceId: 'grp',
            before: null,
            after: { name: 'Flotte Nord' },
            metadata: {},
            occurredAt: new Date('2026-09-10T08:00:00Z'),
          },
        ],
        total: 51,
        page: 2,
        perPage: 25,
      },
      fenetre
    )

    assert.equal(page.meta.total, 51)
    assert.equal(page.meta.currentPage, 2)
    assert.equal(page.meta.lastPage, 3)
    assert.equal(page.meta.window.from, '2026-09-01T00:00:00.000Z')
    // L'identifiant reste une CHAÎNE : `audit_logs.id` est un bigint.
    assert.equal(page.data[0].id, '42')
    assert.equal(page.data[0].occurredAt, '2026-09-10T08:00:00.000Z')
  })

  test('page vide : lastPage reste à 1', ({ assert }) => {
    const page = serializeAuditPage({ entries: [], total: 0, page: 1, perPage: 25 }, fenetre)
    assert.equal(page.meta.lastPage, 1)
    assert.lengthOf(page.data, 0)
  })
})
