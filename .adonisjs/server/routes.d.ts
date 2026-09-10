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
    'command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
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
    'command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
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
    'command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
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
  }
  PATCH: {
    'user.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'user.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.unassign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}