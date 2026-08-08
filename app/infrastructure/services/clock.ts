import type { Clock } from '#application/ports'

/**
 * Le temps est une dépendance, pas un fait global.
 *
 * Sans ce port, aucune règle temporelle — expiration d'une commande, fenêtre
 * horaire, cooldown d'une politique — ne serait testable sans attendre.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}

/** Horloge figée, pour les tests. Rend les règles temporelles déterministes. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }

  set(date: Date): void {
    this.current = date
  }
}
