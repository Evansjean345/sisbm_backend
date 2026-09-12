import { inject } from '@adonisjs/core'
import { Err, Ok, NotFoundError, type DomainError, type Result } from '#domain/kernel'
import type { AuditLogger, Clock, ExecutionContext, UnitOfWork, UseCase } from '#application/ports'
import type { DeviceCommandRepository } from '#domain/security/repositories/device_command_repository'
import type { VehicleStateReader } from '#application/security/ports'
import { ActorId, CommandId } from '#domain/security/value_objects'
import { StalePositionError } from '#domain/security/errors'

export interface ValidateImmobilizationInput {
  context: ExecutionContext
  commandId: string
  decision: 'approve' | 'reject'
  rejectionReason?: string
}

export interface ValidateImmobilizationOutput {
  commandId: string
  status: string
}

/**
 * =========================================================================
 *  CAS D'USAGE — Valider ou refuser une immobilisation (principe des 4 yeux)
 * =========================================================================
 *
 * La vitesse est RE-CONTRÔLÉE ici. Entre la demande et la validation, le
 * véhicule a pu redémarrer : c'est précisément le scénario où un contrôle
 * unique, au moment de la demande, serait dangereux.
 */
@inject()
export class ValidateImmobilization implements UseCase<
  ValidateImmobilizationInput,
  ValidateImmobilizationOutput
> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly commands: DeviceCommandRepository,
    private readonly vehicles: VehicleStateReader,
    private readonly clock: Clock,
    private readonly audit: AuditLogger,
    private readonly maxPositionAgeSeconds: number
  ) {}

  async execute(
    input: ValidateImmobilizationInput
  ): Promise<Result<ValidateImmobilizationOutput, DomainError>> {
    const now = this.clock.now()

    return this.unitOfWork.run(
      async (tx) => {
        const command = await this.commands.findById(CommandId.from(input.commandId), tx)
        if (!command) return Err(new NotFoundError('Commande', input.commandId))

        const actor = ActorId.from(input.context.actorId!)

        if (input.decision === 'reject') {
          const rejected = command.reject({
            rejectedBy: actor,
            rejectionReason: input.rejectionReason ?? 'Refus sans motif précisé',
            now,
          })
          if (!rejected.ok) return rejected
        } else {
          const state = command.vehicleId
            ? await this.vehicles.readSafetyState(command.vehicleId.value)
            : null
          if (!state) return Err(new NotFoundError('État véhicule', input.commandId))

          const ageSeconds = Math.floor((now.getTime() - state.recordedAt.getTime()) / 1000)
          if (ageSeconds > this.maxPositionAgeSeconds) {
            return Err(new StalePositionError(ageSeconds, this.maxPositionAgeSeconds))
          }

          const validated = command.validate({
            validatedBy: actor,
            currentSpeed: state.speed,
            now,
          })
          if (!validated.ok) return validated
        }

        await this.commands.save(command, tx)
        tx.collect(command.pullDomainEvents())

        await this.audit.record({
          context: input.context,
          action: `security.immobilization.${input.decision}`,
          resourceType: 'device_command',
          resourceId: command.id.value,
          after: command.snapshot() as unknown as Record<string, unknown>,
        })

        return Ok({ commandId: command.id.value, status: command.status })
      },
      {
        isolationLevel: 'serializable',
      }
    )
  }
}
