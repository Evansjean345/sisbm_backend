import { inject } from '@adonisjs/core'
import DeviceGroupModel from '#infrastructure/persistence/models/device_group_model'
import { LucidDeviceGroupMembership } from '#infrastructure/persistence/repositories/group_membership_repository'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { LucidAuditLogReader } from '#infrastructure/persistence/readers/audit_log_reader'
import { GroupControllerBase } from '#presentation/http/controllers/fleet/group_controller_base'

/**
 * Groupes de boîtiers.
 *
 * Habilitations `device:read` / `device:write`, distinctes de celles des
 * véhicules : un parc de trackers se gère souvent par une équipe technique
 * qui n'a pas à toucher au référentiel véhicules.
 */
@inject()
export default class DeviceGroupController extends GroupControllerBase {
  constructor(
    membership: LucidDeviceGroupMembership,
    audit: LucidAuditLogger,
    auditLogs: LucidAuditLogReader
  ) {
    super(
      {
        model: DeviceGroupModel,
        resourceType: 'device_group',
        memberResourceType: 'device',
        memberPayloadKey: 'deviceIds',
        read: 'viewDevices',
        write: 'manageDevices',
        libelle: 'boîtier',
      },
      membership,
      audit,
      auditLogs
    )
  }
}
