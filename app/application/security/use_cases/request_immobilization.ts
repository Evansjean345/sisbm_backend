import { inject } from '@adonisjs/core'
import { Err, Ok, type DomainError, type Result, NotFoundError } from '#domain/kernel'
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
import {
  CommandAlreadyInFlightError,
  DeviceNotEquippedError,
  ImmobilizationDisabledError,
  StalePositionError,
} from '#domain/security/errors'

export interface RequestImmobilizationInput {
  context: ExecutionContext
  vehicleId: string
  reason: string
  origin?: 'manual' | 'policy' | 'api'
  policyId?: string | null
  alertId?: string | null
}

export interface RequestImmobilizationOutput {
  commandId: string
  status: string
  expiresAt: Date
  requiresValidation: boolean
}

export interface ImmobilizationSettings {
  safetySpeedKph: number
  requireValidation: boolean
  commandTtlMinutes: number
  /** Au-delà de cet âge, la dernière position ne prouve plus rien. */
  maxPositionAgeSeconds: number
}

/**
 * =========================================================================
 *  CAS D'USAGE — Demander l'immobilisation d'un véhicule
 * =========================================================================
 *
 * Orchestration pure : ce cas d'usage ne DÉCIDE rien. Il rassemble le contexte,
 * délègue la décision à l'agrégat, persiste et trace. Toute règle de sécurité
 * qui apparaîtrait ici serait au mauvais endroit.
 *
 * Isolation SERIALIZABLE : le volume est négligeable (quelques commandes par
 * mois), l'enjeu est maximal. Deux opérateurs demandant simultanément une
 * coupure sur le même véhicule doivent produire un conflit, pas deux commandes.
 */
@inject()
export class RequestImmobilization implements UseCase<
  RequestImmobilizationInput,
  RequestImmobilizationOutput
> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly commands: DeviceCommandRepository,
    private readonly vehicles: VehicleStateReader,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly audit: AuditLogger,
    private readonly settings: ImmobilizationSettings
  ) {}

  async execute(
    input: RequestImmobilizationInput
  ): Promise<Result<RequestImmobilizationOutput, DomainError>> {
    const now = this.clock.now()

    // ---- 1. motif (CM-08), validé avant toute lecture
    const reason = Reason.create(input.reason)
    if (!reason.ok) return reason

    // ---- 2. état de sécurité du véhicule
    const state = await this.vehicles.readSafetyState(input.vehicleId)
    if (!state) {
      return Err(new NotFoundError('Véhicule', input.vehicleId))
    }
    if (!state.immobilizationEnabled) {
      return Err(new ImmobilizationDisabledError(input.vehicleId))
    }
    if (!state.deviceId || !state.deviceHasRelay) {
      return Err(new DeviceNotEquippedError(state.deviceId ?? 'aucun'))
    }

    // ---- 3. fraîcheur de la position
    // Une position vieille de dix minutes ne prouve pas que le véhicule est
    // à l'arrêt. Refuser est le comportement sûr.
    const ageSeconds = Math.floor((now.getTime() - state.recordedAt.getTime()) / 1000)
    if (ageSeconds > this.settings.maxPositionAgeSeconds) {
      return Err(new StalePositionError(ageSeconds, this.settings.maxPositionAgeSeconds))
    }

    const safetyLimit = Speed.fromKph(this.settings.safetySpeedKph)
    if (!safetyLimit.ok) return safetyLimit

    // ---- 4. transaction sérialisable
    return this.unitOfWork.run(
      async (tx) => {
        const deviceId = DeviceId.from(state.deviceId!)

        // CM-09 : une seule commande en vol par tracker
        const inFlight = await this.commands.findInFlightByDevice(deviceId, tx)
        if (inFlight) {
          return Err(new CommandAlreadyInFlightError(deviceId.value, inFlight.id.value))
        }

        const created = DeviceCommand.requestImmobilization({
          id: CommandId.from(this.ids.generate()),
          organizationId: input.context.organizationId,
          deviceId,
          vehicleId: VehicleId.from(input.vehicleId),
          reason: reason.value,
          origin: input.origin ?? 'manual',
          requestedBy: input.context.actorId ? ActorId.from(input.context.actorId) : null,
          currentSpeed: state.speed,
          ignition: state.ignition,
          safetySpeedLimit: safetyLimit.value,
          requiresValidation: this.settings.requireValidation,
          ttlMinutes: this.settings.commandTtlMinutes,
          now,
          policyId: input.policyId,
          alertId: input.alertId,
        })
        if (!created.ok) return created

        const command = created.value
        await this.commands.save(command, tx)
        tx.collect(command.pullDomainEvents())

        await this.audit.record({
          context: input.context,
          action: 'security.immobilization.requested',
          resourceType: 'device_command',
          resourceId: command.id.value,
          after: command.snapshot() as unknown as Record<string, unknown>,
          metadata: { speedAtRequestKph: state.speed.kph, positionAgeSeconds: ageSeconds },
        })

        return Ok({
          commandId: command.id.value,
          status: command.status,
          expiresAt: command.expiresAt,
          requiresValidation: this.settings.requireValidation,
        })
      },
      { isolationLevel: 'serializable' }
    )
  }
}
