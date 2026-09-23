import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'admin.organization.overview_all': { paramsTuple?: []; params?: {} }
    'admin.organization.activity_all': { paramsTuple?: []; params?: {} }
    'admin.organization.stats_all': { paramsTuple?: []; params?: {} }
    'admin.organization.index': { paramsTuple?: []; params?: {} }
    'admin.organization.store': { paramsTuple?: []; params?: {} }
    'admin.organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.store_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.stats_all': { paramsTuple?: []; params?: {} }
    'admin.user.index_all': { paramsTuple?: []; params?: {} }
    'admin.user.store_all': { paramsTuple?: []; params?: {} }
    'admin.user.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.suspend_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.activate_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.stats_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.store_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.stats_all': { paramsTuple?: []; params?: {} }
    'admin.device.index_all': { paramsTuple?: []; params?: {} }
    'admin.device.store_all': { paramsTuple?: []; params?: {} }
    'admin.device.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.assign_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.unassign_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.sync_flespi_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_status_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_logs_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.flespi_catalog_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.stats_all': { paramsTuple?: []; params?: {} }
    'admin.command.index_all': { paramsTuple?: []; params?: {} }
    'admin.command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.results_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle_group.store_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.device_group.store_all': { paramsTuple?: []; params?: {} }
    'admin.device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.audit_log.index': { paramsTuple?: []; params?: {} }
    'admin.audit_log.actions': { paramsTuple?: []; params?: {} }
    'admin.command.sync_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.send_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.cancel_all': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commandId': ParamValue} }
    'admin.command.execute_all': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'command': ParamValue} }
    'admin.commands.cutEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.commands.restoreEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'auth.login': { paramsTuple?: []; params?: {} }
    'auth.me': { paramsTuple?: []; params?: {} }
    'auth.logout': { paramsTuple?: []; params?: {} }
    'user.change_password': { paramsTuple?: []; params?: {} }
    'user.roles': { paramsTuple?: []; params?: {} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.store': { paramsTuple?: []; params?: {} }
    'user.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.suspend': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.index': { paramsTuple?: []; params?: {} }
    'vehicle.store': { paramsTuple?: []; params?: {} }
    'vehicle.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.index': { paramsTuple?: []; params?: {} }
    'device.store': { paramsTuple?: []; params?: {} }
    'device.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'audit_log.index': { paramsTuple?: []; params?: {} }
    'audit_log.actions': { paramsTuple?: []; params?: {} }
    'device.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.unassign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.sync_flespi': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.flespi_catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.index': { paramsTuple?: []; params?: {} }
    'organization.store': { paramsTuple?: []; params?: {} }
    'organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.store_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organizations.vehicleGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.vehicleGroups.store': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.deviceGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.deviceGroups.store': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'vehicle_group.index': { paramsTuple?: []; params?: {} }
    'vehicle_group.store': { paramsTuple?: []; params?: {} }
    'vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.index': { paramsTuple?: []; params?: {} }
    'device_group.store': { paramsTuple?: []; params?: {} }
    'device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.health': { paramsTuple?: []; params?: {} }
    'flespi_channel.protocols': { paramsTuple?: []; params?: {} }
    'flespi_channel.device_types': { paramsTuple: [ParamValue]; params: {'protocol': ParamValue} }
    'flespi_channel.device_type': { paramsTuple: [ParamValue,ParamValue]; params: {'protocol': ParamValue,'typeId': ParamValue} }
    'flespi_channel.index': { paramsTuple?: []; params?: {} }
    'flespi_channel.store': { paramsTuple?: []; params?: {} }
    'flespi_channel.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.messages': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.connections': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.idents': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.sync': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.send': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commandId': ParamValue} }
    'command.arm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.disarm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.request_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.reboot': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.start_tracking': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.stop_tracking': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set_output': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set_admin_number': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.change_password': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.reset_password': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set_apn': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.add_geofence': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.remove_geofence': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.cutEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.restoreEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'immobilization.store': { paramsTuple?: []; params?: {} }
    'immobilization.validate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'immobilization.dispatch': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'immobilization.restore': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'admin.organization.overview_all': { paramsTuple?: []; params?: {} }
    'admin.organization.activity_all': { paramsTuple?: []; params?: {} }
    'admin.organization.stats_all': { paramsTuple?: []; params?: {} }
    'admin.organization.index': { paramsTuple?: []; params?: {} }
    'admin.organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.stats_all': { paramsTuple?: []; params?: {} }
    'admin.user.index_all': { paramsTuple?: []; params?: {} }
    'admin.user.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.stats_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.stats_all': { paramsTuple?: []; params?: {} }
    'admin.device.index_all': { paramsTuple?: []; params?: {} }
    'admin.device.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_status_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_logs_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.flespi_catalog_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.stats_all': { paramsTuple?: []; params?: {} }
    'admin.command.index_all': { paramsTuple?: []; params?: {} }
    'admin.command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.results_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.audit_log.index': { paramsTuple?: []; params?: {} }
    'admin.audit_log.actions': { paramsTuple?: []; params?: {} }
    'auth.me': { paramsTuple?: []; params?: {} }
    'user.roles': { paramsTuple?: []; params?: {} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.index': { paramsTuple?: []; params?: {} }
    'vehicle.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.index': { paramsTuple?: []; params?: {} }
    'device.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'audit_log.index': { paramsTuple?: []; params?: {} }
    'audit_log.actions': { paramsTuple?: []; params?: {} }
    'device.live_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.flespi_catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.index': { paramsTuple?: []; params?: {} }
    'organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organizations.vehicleGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.deviceGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'vehicle_group.index': { paramsTuple?: []; params?: {} }
    'vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.index': { paramsTuple?: []; params?: {} }
    'device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.health': { paramsTuple?: []; params?: {} }
    'flespi_channel.protocols': { paramsTuple?: []; params?: {} }
    'flespi_channel.device_types': { paramsTuple: [ParamValue]; params: {'protocol': ParamValue} }
    'flespi_channel.device_type': { paramsTuple: [ParamValue,ParamValue]; params: {'protocol': ParamValue,'typeId': ParamValue} }
    'flespi_channel.index': { paramsTuple?: []; params?: {} }
    'flespi_channel.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.messages': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.connections': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.idents': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  HEAD: {
    'admin.organization.overview_all': { paramsTuple?: []; params?: {} }
    'admin.organization.activity_all': { paramsTuple?: []; params?: {} }
    'admin.organization.stats_all': { paramsTuple?: []; params?: {} }
    'admin.organization.index': { paramsTuple?: []; params?: {} }
    'admin.organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.stats_all': { paramsTuple?: []; params?: {} }
    'admin.user.index_all': { paramsTuple?: []; params?: {} }
    'admin.user.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.stats_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.stats_all': { paramsTuple?: []; params?: {} }
    'admin.device.index_all': { paramsTuple?: []; params?: {} }
    'admin.device.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_status_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_logs_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.flespi_catalog_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.stats_all': { paramsTuple?: []; params?: {} }
    'admin.command.index_all': { paramsTuple?: []; params?: {} }
    'admin.command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.results_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.audit_log.index': { paramsTuple?: []; params?: {} }
    'admin.audit_log.actions': { paramsTuple?: []; params?: {} }
    'auth.me': { paramsTuple?: []; params?: {} }
    'user.roles': { paramsTuple?: []; params?: {} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.index': { paramsTuple?: []; params?: {} }
    'vehicle.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.index': { paramsTuple?: []; params?: {} }
    'device.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'audit_log.index': { paramsTuple?: []; params?: {} }
    'audit_log.actions': { paramsTuple?: []; params?: {} }
    'device.live_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.flespi_catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.index': { paramsTuple?: []; params?: {} }
    'organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organizations.vehicleGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.deviceGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'vehicle_group.index': { paramsTuple?: []; params?: {} }
    'vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.index': { paramsTuple?: []; params?: {} }
    'device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.health': { paramsTuple?: []; params?: {} }
    'flespi_channel.protocols': { paramsTuple?: []; params?: {} }
    'flespi_channel.device_types': { paramsTuple: [ParamValue]; params: {'protocol': ParamValue} }
    'flespi_channel.device_type': { paramsTuple: [ParamValue,ParamValue]; params: {'protocol': ParamValue,'typeId': ParamValue} }
    'flespi_channel.index': { paramsTuple?: []; params?: {} }
    'flespi_channel.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.messages': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.connections': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.idents': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  POST: {
    'admin.organization.store': { paramsTuple?: []; params?: {} }
    'admin.organization.store_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.store_all': { paramsTuple?: []; params?: {} }
    'admin.user.suspend_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.activate_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.store_all': { paramsTuple?: []; params?: {} }
    'admin.device.store_all': { paramsTuple?: []; params?: {} }
    'admin.device.assign_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.sync_flespi_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.store_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.store_all': { paramsTuple?: []; params?: {} }
    'admin.device_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.sync_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.send_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.execute_all': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'command': ParamValue} }
    'admin.commands.cutEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.commands.restoreEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'auth.login': { paramsTuple?: []; params?: {} }
    'auth.logout': { paramsTuple?: []; params?: {} }
    'user.change_password': { paramsTuple?: []; params?: {} }
    'user.store': { paramsTuple?: []; params?: {} }
    'user.suspend': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.store': { paramsTuple?: []; params?: {} }
    'device.store': { paramsTuple?: []; params?: {} }
    'device.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.sync_flespi': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.store': { paramsTuple?: []; params?: {} }
    'organization.store_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organizations.vehicleGroups.store': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.deviceGroups.store': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'vehicle_group.store': { paramsTuple?: []; params?: {} }
    'vehicle_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.store': { paramsTuple?: []; params?: {} }
    'device_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.store': { paramsTuple?: []; params?: {} }
    'command.sync': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.send': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.arm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.disarm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.request_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.reboot': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.start_tracking': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.stop_tracking': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set_output': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set_admin_number': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.change_password': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.reset_password': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set_apn': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.add_geofence': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.remove_geofence': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.cutEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.restoreEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'immobilization.store': { paramsTuple?: []; params?: {} }
    'immobilization.validate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'immobilization.dispatch': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'immobilization.restore': { paramsTuple?: []; params?: {} }
  }
  PATCH: {
    'admin.organization.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'admin.user.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.unassign_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.device_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.command.cancel_all': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commandId': ParamValue} }
    'user.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.unassign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'device_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'flespi_channel.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commandId': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}