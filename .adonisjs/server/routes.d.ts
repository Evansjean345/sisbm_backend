import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
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
    'device.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.unassign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.sync_flespi': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.flespi_catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
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
    'auth.me': { paramsTuple?: []; params?: {} }
    'user.roles': { paramsTuple?: []; params?: {} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.index': { paramsTuple?: []; params?: {} }
    'vehicle.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.index': { paramsTuple?: []; params?: {} }
    'device.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.flespi_catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
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
    'auth.me': { paramsTuple?: []; params?: {} }
    'user.roles': { paramsTuple?: []; params?: {} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.index': { paramsTuple?: []; params?: {} }
    'vehicle.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.index': { paramsTuple?: []; params?: {} }
    'device.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.flespi_catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
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
    'auth.login': { paramsTuple?: []; params?: {} }
    'auth.logout': { paramsTuple?: []; params?: {} }
    'user.change_password': { paramsTuple?: []; params?: {} }
    'user.store': { paramsTuple?: []; params?: {} }
    'user.suspend': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.store': { paramsTuple?: []; params?: {} }
    'device.store': { paramsTuple?: []; params?: {} }
    'device.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.sync_flespi': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
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
    'user.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'user.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.unassign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commandId': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}