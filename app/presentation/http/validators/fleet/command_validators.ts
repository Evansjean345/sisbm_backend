import vine from '@vinejs/vine'

/**
 * Paramètres d'une commande boîtier.
 *
 * `reason` est OBLIGATOIRE sur toutes les commandes, pas seulement les
 * sensibles : une commande sans motif est une trace d'audit inutilisable, et
 * on ne sait pas à l'avance laquelle sera contestée.
 *
 * `data` est libre : sa forme dépend du code constructeur (`"0,1"` pour une
 * sortie, `"2250707070707"` pour un numéro admin, `"1,1,5.36,-4.01,500"` pour
 * une géofence). La validation fine appartient au boîtier.
 */
export const commandParamsValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(5).maxLength(300),
    data: vine.string().trim().maxLength(200).optional(),
  })
)
