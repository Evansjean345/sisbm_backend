import type { JsonSchema } from '#infrastructure/gateways/flespi/flespi_types'

/**
 * =========================================================================
 *  VALIDATION DES PROPRIÉTÉS DE COMMANDE — contre le schéma publié par flespi
 * =========================================================================
 *
 * flespi décrit chaque commande par un JSON-Schema (cf. `?fields=commands`).
 * On valide AVANT d'émettre : une commande mal formée est refusée en 422 avec
 * un message précis, au lieu de consommer une tentative, d'être tracée en
 * échec et de remonter un 400 opaque.
 *
 * Sous-ensemble couvert — exactement celui employé par les schémas flespi :
 * type, properties, required, additionalProperties, enum, const, minimum,
 * maximum, minLength, maxLength, pattern, anyOf.
 */

export function validateAgainstSchema(valeur: unknown, schema: JsonSchema, chemin = ''): string[] {
  const ici = chemin || 'properties'

  if (schema.anyOf?.length) {
    const essais = schema.anyOf.map((s) => validateAgainstSchema(valeur, s, chemin))
    if (essais.some((e) => e.length === 0)) return []
    const titres = schema.anyOf
      .map((s) => s.title)
      .filter(Boolean)
      .join(' | ')
    // On remonte les erreurs de la variante la plus proche.
    const meilleure = essais.reduce((a, b) => (b.length < a.length ? b : a))
    return [`${ici} : ne correspond à aucune variante (${titres || 'anyOf'})`, ...meilleure]
  }

  if (schema.const !== undefined && valeur !== schema.const) {
    return [`${ici} doit valoir ${JSON.stringify(schema.const)}`]
  }
  if (schema.enum && !schema.enum.includes(valeur)) {
    return [`${ici} doit être l'une des valeurs ${JSON.stringify(schema.enum)}`]
  }

  switch (schema.type) {
    case 'object': {
      if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) {
        return [`${ici} doit être un objet`]
      }
      const o = valeur as Record<string, unknown>
      const erreurs: string[] = []
      for (const r of schema.required ?? []) {
        if (o[r] === undefined) erreurs.push(`${prefixe(chemin)}${r} est requis`)
      }
      const props = schema.properties ?? {}
      for (const [cle, v] of Object.entries(o)) {
        const sous = props[cle]
        if (!sous) {
          if (schema.additionalProperties === false) {
            erreurs.push(`${prefixe(chemin)}${cle} n'est pas une propriété autorisée`)
          }
          continue
        }
        erreurs.push(...validateAgainstSchema(v, sous, `${prefixe(chemin)}${cle}`))
      }
      return erreurs
    }
    case 'string': {
      if (typeof valeur !== 'string') return [`${ici} doit être une chaîne`]
      const e: string[] = []
      if (schema.minLength !== undefined && valeur.length < schema.minLength)
        e.push(`${ici} : ${schema.minLength} caractères minimum`)
      if (schema.maxLength !== undefined && valeur.length > schema.maxLength)
        e.push(`${ici} : ${schema.maxLength} caractères maximum`)
      if (schema.pattern) {
        try {
          if (!new RegExp(schema.pattern).test(valeur))
            e.push(`${ici} ne respecte pas ${schema.pattern}`)
        } catch {
          /* motif non supporté par JS : flespi tranchera */
        }
      }
      return e
    }
    case 'integer':
    case 'number': {
      if (typeof valeur !== 'number' || !Number.isFinite(valeur))
        return [`${ici} doit être un nombre`]
      if (schema.type === 'integer' && !Number.isInteger(valeur))
        return [`${ici} doit être un entier`]
      const e: string[] = []
      if (schema.minimum !== undefined && valeur < schema.minimum)
        e.push(`${ici} ≥ ${schema.minimum}`)
      if (schema.maximum !== undefined && valeur > schema.maximum)
        e.push(`${ici} ≤ ${schema.maximum}`)
      return e
    }
    case 'boolean':
      return typeof valeur === 'boolean' ? [] : [`${ici} doit être un booléen`]
    default:
      return []
  }
}

const prefixe = (c: string) => (c ? `${c}.` : '')
