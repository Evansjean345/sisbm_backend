import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'

/**
 * Schéma de recherche dans le journal d'audit.
 *
 * `from` / `to` sont des instants ISO 8601. Ils bornent la lecture d'une
 * table partitionnée par mois : le contrôleur applique une fenêtre par défaut
 * de 30 jours quand l'appelant n'en donne pas, et un plafond de 366 jours.
 */

const isoInstant = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (Number.isNaN(Date.parse(value))) {
    field.report('Le champ {{ field }} doit être une date ISO 8601', 'isoInstant', field)
  }
})

const isoDate = () => vine.string().trim().maxLength(40).use(isoInstant())

export const listAuditLogsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(200).optional(),
    from: isoDate().optional(),
    to: isoDate().optional(),
    action: vine.string().trim().maxLength(80).optional(),
    resourceType: vine.string().trim().maxLength(40).optional(),
    resourceId: vine.string().trim().maxLength(64).optional(),
    actorId: vine.string().uuid().optional(),
    /** Réservé à l'exploitant plateforme ; ignoré pour les autres. */
    organizationId: vine.string().uuid().optional(),
  })
)

export const auditWindowValidator = vine.compile(
  vine.object({
    from: isoDate().optional(),
    to: isoDate().optional(),
    organizationId: vine.string().uuid().optional(),
  })
)
