import type { Coordinates, GpsQuality, Speed } from '#domain/measures'
import type { InvalidReason } from '#domain/telemetry/value_objects'

/**
 * =========================================================================
 *  FILTRES QUALITÉ — service de domaine, FONCTION PURE
 * =========================================================================
 *
 * Aucune entrée/sortie, aucune dépendance : ces règles se testent en
 * microsecondes et sont rejouables à volonté sur des données archivées.
 *
 * C'est le cœur de la fiabilité de la plateforme. Les traceurs bas coût
 * produisent régulièrement des points parasites : dérive au démarrage à froid,
 * réflexion multi-trajets entre les immeubles du Plateau, perte de fix sous un
 * pont. Sans filtrage, un rapport kilométrique devient inexploitable et une
 * geofence déclenche de fausses alertes qui décrédibilisent tout le système
 * auprès des exploitants.
 *
 * Un point rejeté n'est JAMAIS supprimé : il est marqué `is_valid = false` avec
 * son motif. On ne détruit pas une donnée brute, on la qualifie — ce qui permet
 * de rejouer avec d'autres seuils si les essais terrain montrent qu'ils sont
 * trop stricts.
 */

export interface QualityThresholds {
  maxHdop: number
  minSatellites: number
  /** Vitesse implicite au-delà de laquelle le déplacement est jugé impossible. */
  maxPlausibleSpeedKph: number
  /** Tolérance d'horloge : les boîtiers dérivent de quelques secondes. */
  maxClockSkewSeconds: number
}

export interface CandidateReading {
  coordinates: Coordinates
  quality: GpsQuality
  recordedAt: Date
}

/** Dernier point VALIDE connu, référence du contrôle de plausibilité. */
export interface PreviousFix {
  coordinates: Coordinates
  recordedAt: Date
}

export type QualityVerdict =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: InvalidReason; readonly detail: string }

const accepte: QualityVerdict = { valid: true }

const rejette = (reason: InvalidReason, detail: string): QualityVerdict => ({
  valid: false,
  reason,
  detail,
})

/**
 * Les trois filtres, dans cet ordre. L'ordre compte : le point nul est le plus
 * fréquent et le moins coûteux à détecter, la plausibilité est le plus coûteux
 * et exige un point de référence.
 */
export function evaluateQuality(
  reading: CandidateReading,
  previous: PreviousFix | null,
  thresholds: QualityThresholds,
  now: Date
): QualityVerdict {
  // ---- ① Point nul
  if (reading.coordinates.isNullIsland) {
    return rejette('null_island', 'Coordonnées (0, 0)')
  }

  // ---- ② Qualité du fix
  if (!reading.quality.isValidFix) {
    return rejette('invalid_fix', 'Le boîtier signale position.valid = false')
  }

  if (reading.quality.hdop !== null && reading.quality.hdop > thresholds.maxHdop) {
    return rejette('poor_hdop', `hdop ${reading.quality.hdop} > ${thresholds.maxHdop}`)
  }

  if (
    reading.quality.satellites !== null &&
    reading.quality.satellites < thresholds.minSatellites
  ) {
    return rejette(
      'few_satellites',
      `${reading.quality.satellites} satellites < ${thresholds.minSatellites}`
    )
  }

  // ---- Horodatage : une horloge déréglée fausse tout le séquencement
  const skew = (reading.recordedAt.getTime() - now.getTime()) / 1000
  if (skew > thresholds.maxClockSkewSeconds) {
    return rejette('future_timestamp', `Horodatage en avance de ${Math.round(skew)} s`)
  }

  // ---- ③ Plausibilité cinématique
  if (previous) {
    const seconds = (reading.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000

    // Deux points au même instant, ou antérieur : pas de vitesse calculable.
    // Ce n'est pas une anomalie — c'est un rejeu de Store & Forward.
    if (seconds > 0) {
      const meters = previous.coordinates.distanceTo(reading.coordinates)
      const impliedKph = (meters / seconds) * 3.6

      // Sous 5 secondes, l'imprécision GPS (quelques dizaines de mètres) suffit
      // à produire une vitesse implicite énorme sur un véhicule à l'arrêt.
      // On n'applique le contrôle qu'au-delà, sinon il rejette des points sains.
      if (seconds >= 5 && impliedKph > thresholds.maxPlausibleSpeedKph) {
        return rejette(
          'implausible_jump',
          `${Math.round(meters)} m en ${Math.round(seconds)} s ` +
            `(${Math.round(impliedKph)} km/h implicites)`
        )
      }
    }
  }

  return accepte
}

/**
 * Une trame remontée longtemps après son horodatage vient du Store & Forward :
 * le boîtier a mémorisé pendant une zone blanche puis rejoué.
 *
 * Elle doit être HISTORISÉE mais EXCLUE du flux temps réel : sinon un véhicule
 * clignote sur la carte à une position qu'il a quittée depuis une heure.
 */
export function isBacklog(recordedAt: Date, receivedAt: Date, thresholdSeconds: number): boolean {
  return (receivedAt.getTime() - recordedAt.getTime()) / 1000 > thresholdSeconds
}

/**
 * Vitesse implicite entre deux points. Exposée pour le diagnostic et les
 * rapports de qualité, pas utilisée par le filtre lui-même.
 */
export function impliedSpeedKph(from: PreviousFix, to: CandidateReading): number | null {
  const seconds = (to.recordedAt.getTime() - from.recordedAt.getTime()) / 1000
  if (seconds <= 0) return null
  return (from.coordinates.distanceTo(to.coordinates) / seconds) * 3.6
}

export type { Speed }
