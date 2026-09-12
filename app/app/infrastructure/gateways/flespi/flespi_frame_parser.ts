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
 * Source : broker MQTT flespi, topic `flespi/message/gw/devices/{device_id}`,
 * un message JSON par publication (l'API REST renvoie, elle, des tableaux).
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
    /**
     * Identifiant du boîtier :
     *  1. `ident` de la trame — toujours présent sur les messages de device ;
     *  2. à défaut, l'id du device flespi (`device.id` ou topic
     *     `flespi/message/gw/devices/{id}`), transmis sous la forme
     *     `flespi:{id}` que le résolveur sait rapprocher de `flespi_device_id`.
     *
     * ⚠ `device.id` n'est PAS un IMEI : l'ancienne version le traitait comme tel.
     */
    const flespiId = nombre(brut['device.id']) ?? FlespiFrameParser.deviceIdFromTopic(topic)
    const identTrame = premier(brut, 'ident', 'imei')
    const identBrut =
      identTrame !== null && String(identTrame).trim() !== ''
        ? String(identTrame).trim()
        : flespiId !== null
          ? `flespi:${flespiId}`
          : null

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
      /**
       * Moteur coupé.
       *
       * `engine.blocked.status` n'existe pas dans le protocole micodus. Le
       * MV730 encode l'état du relais dans le masque `vehicle.state`, relevé
       * sur boîtier réel le 12/09/2026 :
       *
       *   S20 1,1 (coupure)        → vehicle.state F7FFFBFF
       *   S20 0,0 (rétablissement) → vehicle.state FFFFFBFF
       *
       * Seul le bit 0x08000000 change, et il vaut 0 quand le moteur est
       * coupé (convention du protocole HQ : un bit à 0 = état actif).
       */
      engineBlocked: this.moteurCoupe(brut),
      gsmSignal: nombre(premier(brut, 'gsm.signal.level', 'gsm.signal.quality', 'gsm.signal.dbm')),
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
  private externalId(_brut: Brut, ident: string, recordedAt: Date): string {
    // Les messages flespi ne portent pas d'identifiant propre : `id` ou
    // `device.id` désignent le DEVICE, pas le message — les utiliser faisait
    // de toutes les trames d'un boîtier des doublons de la première.
    return `${ident}:${recordedAt.getTime()}`
  }

  /** Bit du masque `vehicle.state` portant l'état du relais de coupure. */
  static readonly MASQUE_COUPURE_MOTEUR = 0x08000000

  /**
   * `null` si la trame ne porte pas le masque : on ne DEVINE jamais l'état
   * d'une coupure moteur, c'est la donnée la plus sensible du système.
   */
  private moteurCoupe(brut: Brut): boolean | null {
    const explicite = booleen(premier(brut, 'engine.blocked.status'))
    if (explicite !== null) return explicite

    const masque = nombre(premier(brut, 'vehicle.state.bitmask'))
    if (masque === null) return null
    return (masque & FlespiFrameParser.MASQUE_COUPURE_MOTEUR) === 0
  }

  /** `flespi/message/gw/devices/8958982` → 8958982 */
  static deviceIdFromTopic(topic?: string): number | null {
    const m = topic?.match(/(?:^|\/)gw\/devices\/(\d+)(?:\/|$)/)
    return m ? Number(m[1]) : null
  }
}
