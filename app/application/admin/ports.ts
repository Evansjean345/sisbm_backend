/**
 * =========================================================================
 *  PORT DE LECTURE — ACTIVITÉ DE LA PLATEFORME (tableau de bord admin)
 * =========================================================================
 *
 * Séries JOURNALIÈRES pour les courbes du tableau de bord. Un point par jour
 * de la fenêtre, jours sans activité compris (valeur 0) : le front trace sans
 * avoir à combler les trous.
 *
 * Les jours sont découpés en UTC — c'est aussi l'heure légale d'Abidjan.
 * La fenêtre est BORNÉE (90 jours max) : `positions` est partitionnée par
 * mois, une lecture non bornée balaierait tout l'historique.
 */

export interface ActivityQuery {
  /** Nombre de jours, aujourd'hui inclus. */
  days: number
  /** Absent = toutes les organisations. */
  organizationId?: string
}

export interface ActivityDay {
  /** Jour au format AAAA-MM-JJ (UTC). */
  date: string
  /** Positions GPS valides reçues. */
  positions: number
  /** Véhicules distincts ayant émis au moins une position. */
  activeVehicles: number
  trips: number
  distanceKm: number
  commands: {
    total: number
    acknowledged: number
    /** failed + expired */
    failed: number
    /** en file, envoyées, annulées, à valider… */
    other: number
  }
  alerts: number
  /** Créations du jour (lignes non supprimées). */
  created: { vehicles: number; devices: number; users: number }
  /** Effectifs cumulés en fin de journée. */
  totals: { vehicles: number; devices: number; users: number }
}

export interface ActivityReport {
  from: string
  to: string
  days: ActivityDay[]
}

export interface ActivityReader {
  daily(query: ActivityQuery): Promise<ActivityReport>
}
