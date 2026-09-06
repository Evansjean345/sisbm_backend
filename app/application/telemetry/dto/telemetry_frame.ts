/**
 * =========================================================================
 *  TRAME NORMALISÉE — la frontière avec Flespi
 * =========================================================================
 *
 * Format NEUTRE, indépendant du fournisseur. C'est ici que s'arrête la
 * connaissance de Flespi : au-delà, plus aucun fichier ne sait que
 * `position.latitude` ou `engine.ignition.status` existent.
 *
 * Le jour où SISBM ajoute un second fournisseur — ou passe en connexion
 * directe des boîtiers — on écrit un second analyseur et rien d'autre ne bouge.
 */
export interface TelemetryFrame {
  /** Identifiant du boîtier tel que transmis (IMEI, éventuellement préfixé). */
  ident: string
  /** Clé d'idempotence de la trame côté source. */
  externalId: string
  /** Horodatage du BOÎTIER — le fait métier. */
  recordedAt: Date
  /** Horodatage de RÉCEPTION plateforme — révèle le Store & Forward. */
  receivedAt: Date

  latitude: number
  longitude: number
  altitudeM: number | null
  speedKph: number
  headingDeg: number | null

  satellites: number | null
  hdop: number | null
  isValidFix: boolean

  ignition: boolean | null
  movement: boolean | null
  engineBlocked: boolean | null

  gsmSignal: number | null
  batteryPct: number | null
  externalVoltageV: number | null

  /** Trame brute conservée pour le rejeu et le diagnostic. */
  raw: Record<string, unknown>
}
