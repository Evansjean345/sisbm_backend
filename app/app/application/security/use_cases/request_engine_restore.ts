import { inject } from '@adonisjs/core'
import { Err, Ok, NotFoundError, type DomainError, type Result } from '#domain/kernel'
import type {
  AuditLogger,
  Clock,
  ExecutionContext,
  IdGenerator,
  UnitOfWork,
  UseCase,
} from '#application/ports'
import { DeviceCommand } from '#domain/security/entities/device_command'
import type { DeviceCommandRepository } from '#domain/security/repositories/device_command_repository'
import type { VehicleStateReader } from '#application/security/ports'
import {
  ActorId,
  CommandId,
  DeviceId,
  Reason,
  Speed,
  VehicleId,
} from '#domain/security/value_objects'
import { CommandAlreadyInFlightError, DeviceNotEquippedError } from '#domain/security/errors'

export interface RequestEngineRestoreInput {
  context: ExecutionContext
  vehicleId: string
  reason: string
  origin?: 'manual' | 'policy' | 'api'
}

export interface RequestEngineRestoreOutput {
  commandId: string
  status: string
  expiresAt: Date
}

/**
 * =========================================================================
 *  CAS D'USAGE — Rétablir le moteur
 * =========================================================================
 *
 * Symétrique de l'immobilisation, avec des garde-fous volontairement plus
 * légers : rendre l'alimentation est l'opération SÛRE. Elle ne demande donc
 * ni second valideur, ni position fraîche, ni véhicule à l'arrêt.
 *
 * Ce qui est conservé : le motif obligatoire, la traçabilité complète et la
 * règle d'une seule commande en vol par boîtier (CM-09).
 *
 * `IMMOBILIZATION_ENABLED` ne conditionne PAS le rétablissement : si le
 * réglage est coupé alors qu'un véhicule est immobilisé, il faut pouvoir le
 * libérer.
 */
@inject()
export class RequestEngineRestore implements UseCase<
  RequestEngineRestoreInput,
  RequestEngineRestoreOutput
> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly commands: DeviceCommandRepository,
    private readonly vehicles: VehicleStateReader,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly audit: AuditLogger,
    private readonly settings: { safetySpeedKph: number; commandTtlMinutes: number }
  ) {}

  async execute(
    input: RequestEngineRestoreInput
  ): Promise<Result<RequestEngineRestoreOutput, DomainError>> {
    const now = this.clock.now()

    const reason = Reason.create(input.reason)
    if (!reason.ok) return reason

    const state = await this.vehicles.readSafetyState(input.vehicleId)
    if (!state) return Err(new NotFoundError('Véhicule', input.vehicleId))
    if (!state.deviceId || !state.deviceHasRelay) {
      return Err(new DeviceNotEquippedError(state.deviceId ?? 'aucun'))
    }

    const safetyLimit = Speed.fromKph(this.settings.safetySpeedKph)
    if (!safetyLimit.ok) return safetyLimit

    return this.unitOfWork.run(
      async (tx) => {
        const deviceId = DeviceId.from(state.deviceId!)

        // CM-09 : la coupure précédente doit être aboutie (acknowledged ou failed).
        const inFlight = await this.commands.findInFlightByDevice(deviceId, tx)
        if (inFlight) {
          return Err(new CommandAlreadyInFlightError(deviceId.value, inFlight.id.value))
        }

        const created = DeviceCommand.requestEngineRestore({
          id: CommandId.from(this.ids.generate()),
          organizationId: input.context.organizationId,
          deviceId,
          vehicleId: VehicleId.from(input.vehicleId),
          reason: reason.value,
          origin: input.origin ?? 'manual',
          requestedBy: input.context.actorId ? ActorId.from(input.context.actorId) : null,
          safetySpeedLimit: safetyLimit.value,
          ttlMinutes: this.settings.commandTtlMinutes,
          now,
        })
        if (!created.ok) return created

        const command = created.value
        await this.commands.save(command, tx)
        tx.collect(command.pullDomainEvents())

        await this.audit.record({
          context: input.context,
          action: 'security.engine_restore.requested',
          resourceType: 'device_command',
          resourceId: command.id.value,
          after: command.snapshot() as unknown as Record<string, unknown>,
        })

        return Ok({
          commandId: command.id.value,
          status: command.status,
          expiresAt: command.expiresAt,
        })
      },
      { isolationLevel: 'serializable' }
    )
  }
}
