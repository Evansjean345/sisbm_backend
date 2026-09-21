import vine from '@vinejs/vine'

/**
 * Paramètres d'une commande boîtier.
 *
 * `reason` est OBLIGATOIRE sur toutes les commandes, pas seulement les
 * sensibles : une commande sans motif est une trace d'audit inutilisable, et
 * on ne sait pas à l'avance laquelle sera contestée.
 *
 * `mode` :
 *   - `queue` (défaut) : mise en file flespi, remise dès que le boîtier se
 *     connecte, dans la limite de `ttl` secondes ;
 *   - `instant` : exécution immédiate, échoue si le boîtier n'est pas
 *     connecté. Réservé au diagnostic interactif.
 */
const MODE = ['queue', 'instant'] as const

export const commandParamsValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(5).maxLength(300),
    data: vine.string().trim().maxLength(200).optional(),
    mode: vine.enum(MODE).optional(),
    /** Durée de vie en file, en secondes (60 s à 30 jours). */
    ttl: vine.number().min(60).max(2592000).optional(),
  })
)

/**
 * Commande flespi BRUTE — `{ name, properties }` tels que publiés par
 * `GET /api/v1/devices/:id/flespi/commands`. Les propriétés sont validées
 * contre le schéma flespi du boîtier, pas ici.
 */
export const flespiCommandValidator = vine.compile(
  vine.object({
    name: vine
      .string()
      .trim()
      .regex(/^[a-z0-9_.]+$/i)
      .maxLength(100),
    properties: vine.object({}).allowUnknownProperties().optional(),
    reason: vine.string().trim().minLength(5).maxLength(300),
    mode: vine.enum(MODE).optional(),
    ttl: vine.number().min(60).max(2592000).optional(),
    /** Confirmation explicite, exigée pour les réglages qui peuvent couper le lien boîtier ↔ flespi. */
    confirm: vine.boolean().optional(),
  })
)
