import vine from '@vinejs/vine'

/**
 * Validation d'entrée HTTP (VineJS).
 *
 * Elle porte sur la FORME : type, présence, longueur. Les règles MÉTIER
 * (vitesse, quatre yeux, machine à états) restent dans le domaine.
 * Confondre les deux revient à disperser la sécurité dans les contrôleurs.
 */
export const requestImmobilizationValidator = vine.compile(
  vine.object({
    vehicleId: vine.string().uuid(),
    reason: vine.string().trim().minLength(5).maxLength(500),
    alertId: vine.string().uuid().optional(),
  })
)

export const validateImmobilizationValidator = vine.compile(
  vine.object({
    decision: vine.enum(['approve', 'reject'] as const),
    rejectionReason: vine
      .string()
      .trim()
      .minLength(5)
      .maxLength(500)
      .optional()
      .requiredWhen('decision', '=', 'reject'),
  })
)
