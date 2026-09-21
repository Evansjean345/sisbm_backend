import { inject } from '@adonisjs/core'
import { Err, Ok, NotFoundError, type DomainError, type Result } from '#domain/kernel'
import type { AuditLogger, Clock, ExecutionContext, UnitOfWork, UseCase } from '#application/ports'
import type { DeviceCommandRepository } from '#domain/security/repositories/device_command_repository'
import type {
  DeviceCommandGateway,
  DeviceProviderReader,
  VehicleStateReader,
} from '#application/security/ports'
import { CommandId } from '#domain/security/value_objects'
import {
  DeviceNotEquippedError,
  ImmobilizationDisabledError,
  NoPositionError,
  StalePositionError,
} from '#domain/security/errors'

export interface DispatchEngineCommandInput {
  context: ExecutionContext
  commandId: string
}

export interface DispatchEngineCommandOutput {
  commandId: string
  commandType: string
  status: string
  providerCommandId: string | null
}

export interface DispatchSettings {
  /** IMMOBILIZATION_ENABLED : interrupteur général, `false` tant que le Jalon 3 n'est pas recetté. */
  enabled: boolean
  maxPositionAgeSeconds: number
}

/**
 * =========================================================================
 *  CAS D'USAGE — Transmettre la commande au boîtier
 * =========================================================================
 *
 * C'est le seul endroit du système qui agit physiquement sur un véhicule.
 * Il n'est atteignable qu'après `RequestImmobilization` (garde-fou de vitesse
 * à la demande) puis `ValidateImmobilization` (second opérateur, vitesse
 * revérifiée). Ici a lieu le TROISIÈME contrôle, juste avant l'émission.
 *
 * Deux temps, volontairement séparés :
 *
 *  ① EN TRANSACTION — dernier contrôle de vitesse et de fraîcheur, puis
 *    passage en `queued`. Si la transaction échoue, rien n'a été envoyé.
 *
 *  ② HORS TRANSACTION — appel à la passerelle, puis `sent` ou `failed`.
 *    Un appel réseau ne tient JAMAIS une transaction ouverte : flespi qui
 *    répond en 10 s bloquerait la ligne et, avec elle, toute tentative
 *    concurrente sur le même boîtier.
 *
 * En cas de doute sur l'aboutissement (réponse perdue, timeout), la commande
 * est marquée `failed` avec le motif : le rétablissement reste possible, et
 * l'état réel du relais se lit dans la télémétrie du boîtier.
 */
@inject()
export class DispatchEngineCommand implements UseCase<
  DispatchEngineCommandInput,
  DispatchEngineCommandOutput
> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly commands: DeviceCommandRepository,
    private readonly vehicles: VehicleStateReader,
    private readonly devices: DeviceProviderReader,
    private readonly gateway: DeviceCommandGateway,
    private readonly clock: Clock,
    private readonly audit: AuditLogger,
    private readonly settings: DispatchSettings
  ) {}

  async execute(
    input: DispatchEngineCommandInput
  ): Promise<Result<DispatchEngineCommandOutput, DomainError>> {
    const now = this.clock.now()
    const commandId = CommandId.from(input.commandId)

    // ---- ① mise en file, sous transaction
    const prepare = await this.unitOfWork.run(
      async (tx) => {
        const command = await this.commands.findById(commandId, tx)
        if (!command) return Err(new NotFoundError('Commande', input.commandId))

        const coupure = command.commandType === 'engine_cut'
        if (coupure && !this.settings.enabled) {
          return Err(new ImmobilizationDisabledError(command.vehicleId?.value ?? 'global'))
        }

        const provider = await this.devices.readProviderDevice(command.deviceId.value)
        if (!provider?.externalDeviceId) {
          return Err(new DeviceNotEquippedError(command.deviceId.value))
        }

        /**
         * Troisième contrôle de vitesse, sur la position la plus récente.
         * Il n'est exigé que pour la coupure : un rétablissement ne doit
         * jamais être bloqué par l'absence d'une position fraîche.
         */
        let vitesse = null
        if (coupure) {
          const state = command.vehicleId
            ? await this.vehicles.readSafetyState(command.vehicleId.value)
            : null
          if (!state) return Err(new NotFoundError('État véhicule', input.commandId))
          if (!state.recordedAt || !state.speed) {
            return Err(new NoPositionError(command.vehicleId?.value ?? input.commandId))
          }

          const age = Math.floor((now.getTime() - state.recordedAt.getTime()) / 1000)
          if (age > this.settings.maxPositionAgeSeconds) {
            return Err(new StalePositionError(age, this.settings.maxPositionAgeSeconds))
          }
          vitesse = state.speed
        }

        const queued = command.queue({ currentSpeed: vitesse, now })
        if (!queued.ok) return queued

        await this.commands.save(command, tx)
        tx.collect(command.pullDomainEvents())

        await this.audit.record({
          context: input.context,
          action: `security.${command.commandType}.queued`,
          resourceType: 'device_command',
          resourceId: command.id.value,
          after: command.snapshot() as unknown as Record<string, unknown>,
        })

        return Ok({
          commandType: command.commandType,
          deviceId: command.deviceId.value,
          externalDeviceId: provider.externalDeviceId,
        })
      },
      { isolationLevel: 'serializable' }
    )
    if (!prepare.ok) return prepare

    // ---- ② émission, HORS transaction
    const cible = {
      deviceId: prepare.value.deviceId,
      externalDeviceId: prepare.value.externalDeviceId,
      commandId: input.commandId,
    }

    try {
      const envoi =
        prepare.value.commandType === 'engine_cut'
          ? await this.gateway.sendEngineCut(cible)
          : await this.gateway.sendEngineRestore(cible)

      return this.conclure(input, commandId, (command) =>
        command.markSent({ providerCommandId: envoi.providerCommandId, now: this.clock.now() })
      )
    } catch (err) {
      const motif = (err as Error).message
      const echec = await this.conclure(input, commandId, (command) =>
        command.markFailed({ errorMessage: motif, now: this.clock.now() })
      )
      if (!echec.ok) return echec
      return Ok({ ...echec.value, providerCommandId: null })
    }
  }

  /** Transaction courte : n'écrit QUE le résultat de l'émission. */
  private async conclure(
    input: DispatchEngineCommandInput,
    commandId: CommandId,
    transition: (
      command: Awaited<ReturnType<DeviceCommandRepository['findById']>> & object
    ) => Result<void>
  ): Promise<Result<DispatchEngineCommandOutput, DomainError>> {
    return this.unitOfWork.run(async (tx) => {
      const command = await this.commands.findById(commandId, tx)
      if (!command) return Err(new NotFoundError('Commande', input.commandId))

      const applied = transition(command)
      if (!applied.ok) return applied

      await this.commands.save(command, tx)
      tx.collect(command.pullDomainEvents())

      const snapshot = command.snapshot()
      await this.audit.record({
        context: input.context,
        action: `security.${command.commandType}.${command.status}`,
        resourceType: 'device_command',
        resourceId: command.id.value,
        after: snapshot as unknown as Record<string, unknown>,
      })

      return Ok({
        commandId: command.id.value,
        commandType: command.commandType,
        status: command.status,
        providerCommandId: snapshot.providerCommandId,
      })
    })
  }
}
