import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { throttle } from '#start/limiter'

/**
 * =========================================================================
 *  ROUTES DU TABLEAU DE BORD D'ADMINISTRATION — /api/v1/admin/*
 * =========================================================================
 *
 * Périmètre PLATEFORME : toutes les organisations, sans cloisonnement.
 * Réservé au joker `*` (super_admin), contrôlé deux fois :
 *   ① `middleware.platformAdmin()` sur chaque groupe ci-dessous ;
 *   ② `authorizePlatform()` au début de chaque fonction `*All`.
 *
 * Les fonctions `*All` vivent dans les contrôleurs existants et partagent
 * leur implémentation avec les routes client : seul le périmètre change.
 *
 * Tous les noms de route sont préfixés `admin.` (`.as('admin')`) : plusieurs
 * routes réutilisent une fonction déjà montée côté client, et AdonisJS refuse
 * deux noms générés identiques.
 */

const UserController = () => import('#presentation/http/controllers/identity/user_controller')
const OrganizationController = () =>
  import('#presentation/http/controllers/identity/organization_controller')
const VehicleController = () => import('#presentation/http/controllers/fleet/vehicle_controller')
const DeviceController = () => import('#presentation/http/controllers/fleet/device_controller')
const CommandController = () =>
  import('#presentation/http/controllers/fleet/device_command_controller')
const VehicleGroupController = () =>
  import('#presentation/http/controllers/fleet/vehicle_group_controller')
const DeviceGroupController = () =>
  import('#presentation/http/controllers/fleet/device_group_controller')
const AuditLogController = () => import('#presentation/http/controllers/audit/audit_log_controller')

/**
 * Commandes métier acceptées par `POST /admin/devices/:id/commands/:command`.
 * La coupure et le rétablissement moteur n'y figurent PAS : ils passent par
 * `/security/*` (garde-fou de vitesse CM-07, double validation).
 */
const COMMANDES_METIER =
  /^(arm|disarm|request-status|reboot|start-tracking|stop-tracking|set-output|set-admin-number|change-password|reset-password|set-apn|add-geofence|remove-geofence)$/

// --------------------------------------------------------------- lecture et gestion
router
  .group(() => {
    // ---- vue d'ensemble
    router.get('/overview', [OrganizationController, 'overviewAll'])
    router.get('/stats/activity', [OrganizationController, 'activityAll'])

    // ---- organisations
    // `/stats` AVANT `/:id` : l'ordre reste explicite même si le matcher uuid
    // empêche déjà la collision.
    router.get('/organizations/stats', [OrganizationController, 'statsAll'])
    router.get('/organizations', [OrganizationController, 'index'])
    router.post('/organizations', [OrganizationController, 'store'])
    router.get('/organizations/:id', [OrganizationController, 'show'])
    router.patch('/organizations/:id', [OrganizationController, 'update'])
    router.get('/organizations/:id/users', [OrganizationController, 'users'])
    router.post('/organizations/:id/users', [OrganizationController, 'storeUser'])
    router.get('/organizations/:id/roles', [OrganizationController, 'roles'])
    router.get('/organizations/:id/audit-logs', [AuditLogController, 'byOrganization'])

    // ---- utilisateurs
    router.get('/users/stats', [UserController, 'statsAll'])
    router.get('/users', [UserController, 'indexAll'])
    router.post('/users', [UserController, 'storeAll'])
    router.get('/users/:id', [UserController, 'showAll'])
    router.patch('/users/:id', [UserController, 'updateAll'])
    router.post('/users/:id/suspend', [UserController, 'suspendAll'])
    router.post('/users/:id/activate', [UserController, 'activateAll'])
    router.delete('/users/:id', [UserController, 'destroyAll'])

    // ---- véhicules
    router.get('/vehicles/stats', [VehicleController, 'statsAll'])
    router.get('/vehicles', [VehicleController, 'indexAll'])
    router.post('/vehicles', [VehicleController, 'storeAll'])
    router.get('/vehicles/:id', [VehicleController, 'showAll'])
    router.patch('/vehicles/:id', [VehicleController, 'updateAll'])
    router.delete('/vehicles/:id', [VehicleController, 'destroyAll'])

    // ---- boîtiers
    router.get('/devices/stats', [DeviceController, 'statsAll'])
    router.get('/devices', [DeviceController, 'indexAll'])
    router.post('/devices', [DeviceController, 'storeAll'])
    router.get('/devices/:id', [DeviceController, 'showAll'])
    router.patch('/devices/:id', [DeviceController, 'updateAll'])
    router.delete('/devices/:id', [DeviceController, 'destroyAll'])
    router.post('/devices/:id/assignment', [DeviceController, 'assignAll'])
    router.delete('/devices/:id/assignment', [DeviceController, 'unassignAll'])

    // ---- boîtiers : diagnostic flespi
    router.get('/devices/:id/telemetry', [DeviceController, 'liveTelemetryAll'])
    router.get('/devices/:id/telemetry/history', [DeviceController, 'liveHistoryAll'])
    router.post('/devices/:id/flespi/sync', [DeviceController, 'syncFlespiAll'])
    router.get('/devices/:id/flespi', [DeviceController, 'flespiStatusAll'])
    router.get('/devices/:id/flespi/logs', [DeviceController, 'flespiLogsAll'])
    router.get('/devices/:id/flespi/telemetry', [DeviceController, 'flespiTelemetryAll'])
    router.get('/devices/:id/flespi/commands', [CommandController, 'flespiCatalogAll'])

    // ---- commandes : lecture
    router.get('/commands/stats', [CommandController, 'statsAll'])
    router.get('/commands', [CommandController, 'indexAll'])
    // Catalogue métier statique (aucune lecture du boîtier) : fonction client réutilisée.
    router.get('/devices/:id/commands', [CommandController, 'catalog'])
    router.get('/devices/:id/commands/history', [CommandController, 'historyAll'])
    router.get('/devices/:id/commands/results', [CommandController, 'resultsAll'])

    // ---- groupes de véhicules
    // Liste et création : fonctions `*All`. Le reste réutilise les fonctions
    // client, dont la recherche du groupe est déjà ouverte au joker `*`.
    router.get('/vehicle-groups', [VehicleGroupController, 'indexAll'])
    router.post('/vehicle-groups', [VehicleGroupController, 'storeAll'])
    router.get('/vehicle-groups/:id', [VehicleGroupController, 'show'])
    router.patch('/vehicle-groups/:id', [VehicleGroupController, 'update'])
    router.delete('/vehicle-groups/:id', [VehicleGroupController, 'destroy'])
    router.get('/vehicle-groups/:id/vehicles', [VehicleGroupController, 'members'])
    router.post('/vehicle-groups/:id/vehicles', [VehicleGroupController, 'assign'])
    router.delete('/vehicle-groups/:id/vehicles/:memberId', [VehicleGroupController, 'unassign'])
    router.get('/vehicle-groups/:id/audit-logs', [VehicleGroupController, 'auditLogsOfGroup'])

    // ---- groupes de boîtiers
    router.get('/device-groups', [DeviceGroupController, 'indexAll'])
    router.post('/device-groups', [DeviceGroupController, 'storeAll'])
    router.get('/device-groups/:id', [DeviceGroupController, 'show'])
    router.patch('/device-groups/:id', [DeviceGroupController, 'update'])
    router.delete('/device-groups/:id', [DeviceGroupController, 'destroy'])
    router.get('/device-groups/:id/devices', [DeviceGroupController, 'members'])
    router.post('/device-groups/:id/devices', [DeviceGroupController, 'assign'])
    router.delete('/device-groups/:id/devices/:memberId', [DeviceGroupController, 'unassign'])
    router.get('/device-groups/:id/audit-logs', [DeviceGroupController, 'auditLogsOfGroup'])

    // ---- journal d'audit (toutes organisations, ou ?organizationId=)
    router.get('/audit-logs', [AuditLogController, 'index'])
    router.get('/audit-logs/actions', [AuditLogController, 'actions'])
  })
  .prefix('/api/v1/admin')
  .as('admin')
  // Un :id mal formé serait rejeté par PostgreSQL (22P02 → 500) : 404 d'emblée.
  .where('id', router.matchers.uuid())
  .where('memberId', router.matchers.uuid())
  .use([middleware.auth(), middleware.platformAdmin()])

// --------------------------------------------------------------- commandes boîtier
/**
 * Agissent sur du MATÉRIEL RÉEL : même limiteur que les routes client.
 * Règle du tableau de bord : chaque commande envoyée est suivie d'un
 * `POST /admin/devices/:id/commands/sync`.
 */
router
  .group(() => {
    router.post('/devices/:id/commands/sync', [CommandController, 'syncAll'])
    router.post('/devices/:id/commands/send', [CommandController, 'sendAll'])
    router
      .delete('/devices/:id/commands/:commandId', [CommandController, 'cancelAll'])
      .where('commandId', router.matchers.uuid())
    router
      .post('/devices/:id/commands/:command', [CommandController, 'executeAll'])
      .where('command', COMMANDES_METIER)

    // Coupure / rétablissement moteur : refus explicite plutôt qu'un 404.
    router
      .post('/devices/:id/commands/cut-engine', [CommandController, 'engineForbidden'])
      .as('commands.cutEngineForbidden')
    router
      .post('/devices/:id/commands/restore-engine', [CommandController, 'engineForbidden'])
      .as('commands.restoreEngineForbidden')
  })
  .prefix('/api/v1/admin')
  .as('admin')
  .where('id', router.matchers.uuid())
  .use([middleware.auth(), middleware.platformAdmin(), throttle.sensitive])
