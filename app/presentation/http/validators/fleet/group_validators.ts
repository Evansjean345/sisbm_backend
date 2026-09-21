import vine from '@vinejs/vine'

/**
 * Schémas des groupes (véhicules et boîtiers).
 *
 * Les deux familles partagent la même forme : les tables sont symétriques
 * (migrations 003 et 013), les schémas le restent aussi.
 */

const COLOR = /^#[0-9a-fA-F]{6}$/

/** Plafond d'une affectation en lot : au-delà, c'est un import, pas une affectation. */
const MAX_MEMBRES = 200

const groupFields = {
  name: vine.string().trim().minLength(2).maxLength(80),
  description: vine.string().trim().maxLength(300).optional(),
  color: vine.string().trim().regex(COLOR).optional(),
}

export const createGroupValidator = vine.compile(vine.object(groupFields))

export const updateGroupValidator = vine.compile(
  vine.object({
    name: groupFields.name.clone().optional(),
    description: groupFields.description,
    color: groupFields.color,
  })
)

export const listGroupsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    search: vine.string().trim().minLength(1).maxLength(80).optional(),
  })
)

export const assignVehiclesValidator = vine.compile(
  vine.object({
    vehicleIds: vine.array(vine.string().uuid()).minLength(1).maxLength(MAX_MEMBRES).distinct(),
  })
)

export const assignDevicesValidator = vine.compile(
  vine.object({
    deviceIds: vine.array(vine.string().uuid()).minLength(1).maxLength(MAX_MEMBRES).distinct(),
  })
)
