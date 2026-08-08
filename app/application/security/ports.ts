import type { Speed } from '#domain/security/value_objects'

/**
 * Ports applicatifs du contexte Sécurité.
 *
 * `VehicleStateReader` est un port de LECTURE vers un autre bounded context
 * (Télémétrie). On ne traverse pas les frontières en important son agrégat :
 * on déclare le strict minimum dont on a besoin. Le jour où la télémétrie
 * devient un service séparé, seule l'implémentation change.
 */

export interface VehicleSafetyState {
  vehicleId: string
  deviceId: string | null
  speed: Speed
  ignition: boolean | null
  recordedAt: Date
  immobilizationEnabled: boolean
  deviceHasRelay: boolean
}

export interface VehicleStateReader {
  /** Dernier état connu du véhicule. `null` si aucune position n'a été reçue. */
  readSafetyState(vehicleId: string): Promise<VehicleSafetyState | null>
}

/** Sortie vers la passerelle télématique (Flespi en Phase 1). */
export interface DeviceCommandGateway {
  sendEngineCut(input: {
    deviceId: string
    externalDeviceId: string | null
    commandId: string
  }): Promise<{ providerCommandId: string }>

  sendEngineRestore(input: {
    deviceId: string
    externalDeviceId: string | null
    commandId: string
  }): Promise<{ providerCommandId: string }>
}
