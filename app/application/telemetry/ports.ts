import type { TelemetryFrame } from '#application/telemetry/dto/telemetry_frame'

/**
 * Ports applicatifs du contexte Télémétrie.
 */

/** Contexte d'un boîtier résolu depuis son identifiant. */

export interface ResolvedDevice {
  deviceId: string
  organizationId: string
  vehicleId: string | null
  hasRelay: boolean
  flespiDeviceId: number | null
}

export interface DeviceResolver {
  /** `null` si le boîtier est inconnu. Résultat mis en cache par l'adaptateur. */
  resolve(ident: string): Promise<ResolvedDevice | null>
  invalidate(ident: string): Promise<void>
}

/**
 * Abstraction du transport temps réel.
 *
 * C'est ce port qui rend toute la chaîne testable SANS broker : en test, on
 * injecte une implémentation en mémoire qui pousse des trames à la demande.
 */

export interface TelemetryTransport {
  /**
   * `handler` doit résoudre APRÈS persistance : l'acquittement au broker n'est
   * émis qu'ensuite. Une base indisponible provoque un rejeu, pas une perte.
   */
  subscribe(handler: (raw: string, topic: string) => Promise<void>): Promise<void>
  disconnect(): Promise<void>
  readonly isConnected: boolean
}

/** Diffusion vers les tableaux de bord (SSE). */
export interface RealtimeBroadcaster {
  publishPosition(organizationId: string, payload: Record<string, unknown>): Promise<void>
}

export type { TelemetryFrame }
