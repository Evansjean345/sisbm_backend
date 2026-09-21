import { BaseDomainEvent } from '#domain/kernel'

/**
 * Événements du contexte Télémétrie.
 *
 * Écrits dans `outbox_messages` DANS la transaction d'ingestion, publiés après
 * le COMMIT. Ce sont eux qui alimenteront le moteur de règles (Jalon 3) et la
 * diffusion temps réel, sans que l'ingestion ait à les connaître.
 */
export class PositionRecorded extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.position.recorded', id, p)
  }
}

export class PositionRejected extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.position.rejected', id, p)
  }
}

export class IgnitionTurnedOn extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.ignition.on', id, p)
  }
}

export class IgnitionTurnedOff extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.ignition.off', id, p)
  }
}

export class TripStarted extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.trip.started', id, p)
  }
}

export class TripClosed extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.trip.closed', id, p)
  }
}

export class DeviceWentSilent extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.device.silent', id, p)
  }
}
