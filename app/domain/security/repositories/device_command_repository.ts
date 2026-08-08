import type { DeviceCommand } from '#domain/security/entities/device_command'
import type { CommandId, DeviceId } from '#domain/security/value_objects'
import type { TransactionScope } from '#domain/kernel'

/**
 * Port de persistance de l'agrégat DeviceCommand.
 *
 * L'interface vit dans le DOMAINE, l'implémentation Lucid dans
 * `infrastructure/`. Le domaine dicte le contrat, l'infrastructure s'y plie.
 *
 * Le repository manipule des agrégats, jamais des lignes SQL ni des DTO :
 * c'est ce qui empêche la logique métier de fuir vers la couche de données.
 */
export interface DeviceCommandRepository {
  findById(id: CommandId, tx?: TransactionScope): Promise<DeviceCommand | null>

  /**
   * Commande occupant actuellement le tracker (contrainte CM-09).
   * Appelée sous verrou dans la transaction d'émission.
   */
  findInFlightByDevice(deviceId: DeviceId, tx?: TransactionScope): Promise<DeviceCommand | null>

  save(command: DeviceCommand, tx?: TransactionScope): Promise<void>

  /** Commandes dont le TTL est dépassé — balayage par tâche planifiée. */
  findExpirable(now: Date, limit: number): Promise<DeviceCommand[]>
}
