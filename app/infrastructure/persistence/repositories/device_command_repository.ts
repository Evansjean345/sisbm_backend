import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import DeviceCommandModel from '#infrastructure/persistence/models/device_command_model'
import { DeviceCommand } from '#domain/security/entities/device_command'
import type { DeviceCommandRepository } from '#domain/security/repositories/device_command_repository'
import {
  ActorId,
  CommandId,
  DeviceId,
  Reason,
  Speed,
  VehicleId,
  IN_FLIGHT_STATUSES,
  type CommandOrigin,
  type CommandStatus,
  type CommandType,
} from '#domain/security/value_objects'
import type { TransactionScope } from '#application/ports'

/**
 * Adaptateur de persistance.
 *
 * Sa seule responsabilité est la TRADUCTION entre l'agrégat et la table.
 * Il ne contient aucune règle : pas de contrôle de vitesse, pas de transition
 * d'état. S'il fallait en ajouter une ici, c'est qu'elle manque au domaine.
 */
export class LucidDeviceCommandRepository implements DeviceCommandRepository {
  async findById(id: CommandId, tx?: TransactionScope): Promise<DeviceCommand | null> {
    const query = DeviceCommandModel.query()
    if (tx) query.useTransaction(tx.raw as TransactionClientContract)
    const row = await query.where('id', id.value).first()
    return row ? this.toDomain(row) : null
  }

  /**
   * Lecture sous verrou (`FOR UPDATE`) : couplée à l'isolation SERIALIZABLE
   * du cas d'usage, elle empêche deux demandes concurrentes de passer le
   * contrôle CM-09 en même temps.
   */

  async findInFlightByDevice(
    deviceId: DeviceId,
    tx?: TransactionScope
  ): Promise<DeviceCommand | null> {
    const query = DeviceCommandModel.query()
    if (tx) {
      query.useTransaction(tx.raw as TransactionClientContract).forUpdate()
    }
    const row = await query
      .where('device_id', deviceId.value)
      .whereIn('status', [...IN_FLIGHT_STATUSES])
      .first()
    return row ? this.toDomain(row) : null
  }

  async save(command: DeviceCommand, tx?: TransactionScope): Promise<void> {
    const s = command.snapshot()
    const payload = {
      id: s.id,
      organizationId: s.organizationId,
      deviceId: s.deviceId,
      vehicleId: s.vehicleId,
      commandType: s.commandType,
      status: s.status,
      reason: s.reason,
      origin: s.origin,
      policyId: s.policyId,
      alertId: s.alertId,
      requestedBy: s.requestedBy,
      requestedAt: DateTime.fromJSDate(s.requestedAt),
      safetySpeedLimitKph: s.safetySpeedLimitKph,
      speedAtRequestKph: s.speedAtRequestKph,
      ignitionAtRequest: s.ignitionAtRequest,
      requiresValidation: s.requiresValidation,
      validatedBy: s.validatedBy,
      validatedAt: s.validatedAt ? DateTime.fromJSDate(s.validatedAt) : null,
      rejectionReason: s.rejectionReason,
      queuedAt: s.queuedAt ? DateTime.fromJSDate(s.queuedAt) : null,
      sentAt: s.sentAt ? DateTime.fromJSDate(s.sentAt) : null,
      acknowledgedAt: s.acknowledgedAt ? DateTime.fromJSDate(s.acknowledgedAt) : null,
      failedAt: s.failedAt ? DateTime.fromJSDate(s.failedAt) : null,
      errorMessage: s.errorMessage,
      providerCommandId: s.providerCommandId,
      attempts: s.attempts,
      expiresAt: DateTime.fromJSDate(s.expiresAt),
    }

    const model = new DeviceCommandModel()
    model.merge(payload)
    if (tx) model.useTransaction(tx.raw as TransactionClientContract)

    const exists = await DeviceCommandModel.query()
      .if(tx, (q) => q.useTransaction(tx!.raw as TransactionClientContract))
      .where('id', s.id)
      .first()

    if (exists) {
      exists.merge(payload)
      if (tx) exists.useTransaction(tx.raw as TransactionClientContract)
      await exists.save()
    } else {
      model.$attributes.id = s.id
      await model.save()
    }
  }

  async findExpirable(now: Date, limit: number): Promise<DeviceCommand[]> {
    const rows = await DeviceCommandModel.query()
      .whereIn('status', ['pending_validation', 'approved', 'queued'])
      .where('expires_at', '<', DateTime.fromJSDate(now).toSQL()!)
      .limit(limit)
    return rows.map((r) => this.toDomain(r))
  }

  // ------------------------------------------------------------- mapping
  private toDomain(row: DeviceCommandModel): DeviceCommand {
    return DeviceCommand.rehydrate(CommandId.from(row.id), {
      organizationId: row.organizationId,
      deviceId: DeviceId.from(row.deviceId),
      vehicleId: row.vehicleId ? VehicleId.from(row.vehicleId) : null,
      commandType: row.commandType as CommandType,
      status: row.status as CommandStatus,
      // `trusted` : la donnée vient de la base, déjà validée par les CHECK SQL.
      reason: Reason.trusted(row.reason),
      origin: row.origin as CommandOrigin,
      requestedBy: row.requestedBy ? ActorId.from(row.requestedBy) : null,
      requestedAt: row.requestedAt.toJSDate(),
      safetySpeedLimit: Speed.trusted(Number(row.safetySpeedLimitKph)),
      speedAtRequest:
        row.speedAtRequestKph === null ? null : Speed.trusted(Number(row.speedAtRequestKph)),
      ignitionAtRequest: row.ignitionAtRequest,
      requiresValidation: row.requiresValidation,
      validatedBy: row.validatedBy ? ActorId.from(row.validatedBy) : null,
      validatedAt: row.validatedAt?.toJSDate() ?? null,
      rejectionReason: row.rejectionReason,
      queuedAt: row.queuedAt?.toJSDate() ?? null,
      sentAt: row.sentAt?.toJSDate() ?? null,
      acknowledgedAt: row.acknowledgedAt?.toJSDate() ?? null,
      failedAt: row.failedAt?.toJSDate() ?? null,
      errorMessage: row.errorMessage,
      providerCommandId: row.providerCommandId,
      attempts: row.attempts,
      expiresAt: row.expiresAt.toJSDate(),
      policyId: row.policyId,
      alertId: row.alertId,
    })
  }
}
