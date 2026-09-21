/**
 * flespi horodate en SECONDES (parfois décimales), l'API SISBM en ISO 8601.
 * Confondre les deux place les requêtes en 1970 ou en l'an 50 000.
 */
export function toFlespiSeconds(iso?: string | null): number | undefined {
  if (!iso) return undefined
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) {
    throw Object.assign(new Error(`Date invalide : ${iso} (ISO 8601 attendu)`), { status: 422 })
  }
  return Math.floor(ms / 1000)
}
