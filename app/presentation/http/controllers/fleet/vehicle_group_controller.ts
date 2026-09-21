import { inject } from '@adonisjs/core'
import VehicleGroupModel from '#infrastructure/persistence/models/vehicle_group_model'
import { LucidVehicleGroupMembership } from '#infrastructure/persistence/repositories/group_membership_repository'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { LucidAuditLogReader } from '#infrastructure/persistence/readers/audit_log_reader'
import { GroupControllerBase } from '#presentation/http/controllers/fleet/group_controller_base'

/**
 * Groupes de véhicules.
 *
 * Habilitations `vehicle:read` / `vehicle:write` : gérer un groupe, c'est
 * gérer sa flotte. Aucune habilitation nouvelle n'est introduite — la matrice
 * des rôles du Jalon 1 reste valable.
 */
@inject()
export default class VehicleGroupController extends GroupControllerBase {
  constructor(
    membership: LucidVehicleGroupMembership,
    audit: LucidAuditLogger,
    auditLogs: LucidAuditLogReader
  ) {
    super(
      {
        model: VehicleGroupModel,
        resourceType: 'vehicle_group',
        memberResourceType: 'vehicle',
        memberPayloadKey: 'vehicleIds',
        read: 'viewVehicles',
        write: 'manageVehicles',
        libelle: 'véhicule',
      },
      membership,
      audit,
      auditLogs
    )
  }
}
