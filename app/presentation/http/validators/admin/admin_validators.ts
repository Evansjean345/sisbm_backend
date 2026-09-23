import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'

/**
 * =========================================================================
 *  SCHÉMAS DU TABLEAU DE BORD D'ADMINISTRATION (/api/v1/admin/*)
 * =========================================================================
 *
 * Mêmes filtres que les routes client, plus `organizationId` : en périmètre
 * plateforme, il RESTREINT la lecture à un client au lieu de la cloisonner.
 * Les schémas d'écriture (création/mise à jour) sont ceux des routes client :
 * seule l'organisation CIBLE est ajoutée, par `targetOrganizationValidator`.
 */

const USER_STATUS = ['pending', 'active', 'suspended'] as const
const VEHICLE_STATUS = ['draft', 'active', 'maintenance', 'inactive', 'archived'] as const
const DEVICE_STATUS = ['stock', 'active', 'maintenance', 'decommissioned'] as const
const COMMAND_STATUS = [
  'pending_validation',
  'approved',
  'rejected',
  'queued',
  'sent',
  'acknowledged',
  'failed',
  'expired',
  'cancelled',
] as const

const isoInstant = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (Number.isNaN(Date.parse(value))) {
    field.report('Le champ {{ field }} doit être une date ISO 8601', 'isoInstant', field)
  }
})

const pagination = {
  page: vine.number().min(1).optional(),
  perPage: vine.number().min(1).max(100).optional(),
}

/** Organisation cible d'une CRÉATION faite depuis le tableau de bord. */
export const targetOrganizationValidator = vine.compile(
  vine.object({
    organizationId: vine.string().uuid(),
  })
)

/** Filtre optionnel par organisation (statistiques, compteurs). */
export const adminOrganizationFilterValidator = vine.compile(
  vine.object({
    organizationId: vine.string().uuid().optional(),
  })
)

export const adminListUsersValidator = vine.compile(
  vine.object({
    ...pagination,
    organizationId: vine.string().uuid().optional(),
    roleId: vine.string().uuid().optional(),
    status: vine.enum(USER_STATUS).optional(),
    /** Nom complet ou e-mail. */
    search: vine.string().trim().minLength(1).maxLength(80).optional(),
  })
)

export const adminListVehiclesValidator = vine.compile(
  vine.object({
    ...pagination,
    organizationId: vine.string().uuid().optional(),
    status: vine.enum(VEHICLE_STATUS).optional(),
    search: vine.string().trim().minLength(1).maxLength(40).optional(),
  })
)

export const adminListDevicesValidator = vine.compile(
  vine.object({
    ...pagination,
    organizationId: vine.string().uuid().optional(),
    status: vine.enum(DEVICE_STATUS).optional(),
    search: vine.string().trim().minLength(3).maxLength(20).optional(),
    unassigned: vine.boolean().optional(),
    /** true : rattachés à flespi · false : jamais synchronisés. */
    linked: vine.boolean().optional(),
  })
)

export const adminListGroupsValidator = vine.compile(
  vine.object({
    ...pagination,
    organizationId: vine.string().uuid().optional(),
    search: vine.string().trim().minLength(1).maxLength(80).optional(),
  })
)

export const adminListCommandsValidator = vine.compile(
  vine.object({
    ...pagination,
    organizationId: vine.string().uuid().optional(),
    deviceId: vine.string().uuid().optional(),
    vehicleId: vine.string().uuid().optional(),
    status: vine.enum(COMMAND_STATUS).optional(),
    commandType: vine.string().trim().maxLength(40).optional(),
    from: vine.string().trim().maxLength(40).use(isoInstant()).optional(),
    to: vine.string().trim().maxLength(40).use(isoInstant()).optional(),
  })
)

/** GET /admin/stats/activity — fenêtre des courbes (90 jours max : `positions` est partitionnée). */
export const adminActivityValidator = vine.compile(
  vine.object({
    days: vine.number().min(7).max(90).optional(),
    organizationId: vine.string().uuid().optional(),
  })
)
