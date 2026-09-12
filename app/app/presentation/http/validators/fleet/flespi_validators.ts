import vine from '@vinejs/vine'

/**
 * Validation des endpoints d'administration flespi (canaux, protocoles).
 */

export const createChannelValidator = vine.compile(
  vine.object({
    name: vine
      .string()
      .trim()
      .minLength(2)
      .maxLength(255)
      .regex(/^[\w.\- ]+$/),
    /** `micodus` pour les MV730. Défaut : FLESPI_PROTOCOL_NAME. */
    protocolName: vine
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_\-]+$/)
      .optional(),
    protocolId: vine.number().min(1).optional(),
    /** Tampon du canal, en secondes. 0 = pas de stockage (flux MQTT uniquement). */
    messagesTtl: vine.number().min(0).max(31536000).optional(),
    enabled: vine.boolean().optional(),
  })
)

export const updateChannelValidator = vine.compile(
  vine.object({
    name: vine
      .string()
      .trim()
      .minLength(2)
      .maxLength(255)
      .regex(/^[\w.\- ]+$/)
      .optional(),
    messagesTtl: vine.number().min(0).max(31536000).optional(),
    enabled: vine.boolean().optional(),
  })
)

export const logQueryValidator = vine.compile(
  vine.object({
    /** ISO 8601, ex. 2026-09-10T08:00:00Z */
    from: vine.string().trim().optional(),
    to: vine.string().trim().optional(),
    count: vine.number().min(1).max(1000).optional(),
  })
)

export const channelMessagesValidator = vine.compile(
  vine.object({
    currKey: vine.number().min(0).optional(),
    limit: vine.number().min(1).max(1000).optional(),
  })
)
