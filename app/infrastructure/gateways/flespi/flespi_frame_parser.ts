import type { TelemetryFrame } from '#application/telemetry/dto/telemetry_frame'

/**
 * =========================================================================
 *  ANALYSEUR DE TRAMES FLESPI
 * =========================================================================
 *
 * SEUL fichier du projet qui connaît les noms de champs Flespi. Au-delà, tout
 * le système manipule un `TelemetryFrame` neutre.
 *
 * Le jour où SISBM ajoute un second fournisseur, ou passe en connexion directe
 * des boîtiers, on écrit un second analyseur : le domaine, les cas d'usage et
 * la base ne bougent pas.
 *
 * Flespi normalise déjà les trames binaires du MV730 en JSON à plat, avec des
 * clés pointées :
 *
 *   position.latitude · position.longitude · position.speed ·
 *   position.direction · position.satellites · position.valid ·
 *   engine.ignition.status · battery.level · gsm.signal.level ·
 *   timestamp · server.timestamp
 */

export class FlespiParseError extends Error {
  constructor(
    readonly detail: string,
    readonly raw: unknown
  ) {
    super(`Trame Flespi illisible : ${detail}`)
  }
}

type Brut = Record<string, unknown>

const nombre = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

const booleen = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v
  if (v === 1 || v === '1') return true
  if (v === 0 || v === '0') return false
  return null
}

/**
 * Flespi horodate en SECONDES (parfois décimales), JavaScript en millisecondes.
 * Confondre les deux place les positions en 1970 — l'erreur silencieuse
 * classique sur ce type d'intégration.
 */

const versDate = (v: unknown): Date | null => {
  const n = nombre(v)
  if (n === null) return null
  const ms = n > 1e12 ? n : n * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Première clé présente parmi les variantes possibles. */
const premier = (o: Brut, ...cles: string[]): unknown => {
  for (const c of cles) {
    if (o[c] !== undefined && o[c] !== null) return o[c]
  }
  return null
}

export class FlespiFrameParser {
  /**
   * Analyse une charge utile MQTT.
   *
   * Flespi peut publier un objet unique ou un tableau selon la configuration du
   * forward. Les deux formes sont acceptées.
   */
  parse(payload: string, topic?: string): TelemetryFrame[] {
    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      throw new FlespiParseError('JSON invalide', payload.slice(0, 200))
    }

    const items = Array.isArray(json) ? json : [json]
    return items
      .filter((i): i is Brut => typeof i === 'object' && i !== null)
      .map((i) => this.parseOne(i, topic))
  }

  private parseOne(brut: Brut, topic?: string): TelemetryFrame {
    // L'identifiant peut venir de la trame ou du topic `sisbm/telemetry/{ident}/data`.
    const identBrut =
      (premier(brut, 'ident', 'device.id', 'imei') as string | null) ??
      (topic ? (topic.split('/')[2] ?? null) : null)

    if (!identBrut) {
      throw new FlespiParseError('identifiant de boîtier absent', brut)
    }

    const recordedAt = versDate(premier(brut, 'timestamp', 'position.timestamp'))
    if (!recordedAt) {
      throw new FlespiParseError('horodatage absent ou invalide', brut)
    }
    const receivedAt = versDate(premier(brut, 'server.timestamp')) ?? new Date()

    const latitude = nombre(premier(brut, 'position.latitude', 'latitude'))
    const longitude = nombre(premier(brut, 'position.longitude', 'longitude'))
    if (latitude === null || longitude === null) {
      throw new FlespiParseError('coordonnées absentes', brut)
    }

    /**
     * `position.valid` peut être absent selon le protocole. Absence ≠ invalide :
     * le défaut est `true`, et les filtres qualité (hdop, satellites, point nul)
     * prennent le relais. Défaut à `false` rejetterait tout le trafic d'un
     * boîtier qui ne transmet simplement pas ce champ.
     */
    const isValidFix = booleen(premier(brut, 'position.valid', 'gps.valid')) ?? true

    return {
      ident: String(identBrut),
      externalId: this.externalId(brut, String(identBrut), recordedAt),
      recordedAt,
      receivedAt,
      latitude,
      longitude,
      altitudeM: nombre(premier(brut, 'position.altitude', 'altitude')),
      speedKph: nombre(premier(brut, 'position.speed', 'speed')) ?? 0,
      headingDeg: nombre(premier(brut, 'position.direction', 'direction', 'course')),
      satellites: nombre(premier(brut, 'position.satellites', 'satellites')),
      hdop: nombre(premier(brut, 'position.hdop', 'hdop', 'position.pdop')),
      isValidFix,
      ignition: booleen(premier(brut, 'engine.ignition.status', 'ignition')),
      movement: booleen(premier(brut, 'movement.status', 'movement')),
      engineBlocked: booleen(premier(brut, 'engine.blocked.status')),
      gsmSignal: nombre(premier(brut, 'gsm.signal.level', 'gsm.signal.quality')),
      batteryPct: nombre(premier(brut, 'battery.level', 'battery.percentage')),
      externalVoltageV: nombre(
        premier(brut, 'external.powersource.voltage', 'power.supply.voltage')
      ),
      raw: brut,
    }
  }

  /**
   * Clé d'idempotence de la trame.
   *
   * Flespi fournit parfois un identifiant de message ; sinon
   * `{ident}:{timestamp}` suffit — c'est exactement la granularité de la
   * contrainte d'unicité `(device_id, recorded_at)` posée au Jalon 1.
   */
  private externalId(brut: Brut, ident: string, recordedAt: Date): string {
    const fourni = premier(brut, 'message.id', 'id', 'flespi.message.id')
    if (fourni !== null) return `${ident}:${String(fourni)}`
    return `${ident}:${recordedAt.getTime()}`
  }
}
