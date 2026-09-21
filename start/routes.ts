import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { throttle } from '#start/limiter'

const AuthController = () => import('#presentation/http/controllers/identity/auth_controller')
const UserController = () => import('#presentation/http/controllers/identity/user_controller')
const OrganizationController = () =>
  import('#presentation/http/controllers/identity/organization_controller')
const VehicleGroupController = () =>
  import('#presentation/http/controllers/fleet/vehicle_group_controller')
const DeviceGroupController = () =>
  import('#presentation/http/controllers/fleet/device_group_controller')
const AuditLogController = () => import('#presentation/http/controllers/audit/audit_log_controller')
const VehicleController = () => import('#presentation/http/controllers/fleet/vehicle_controller')
const DeviceController = () => import('#presentation/http/controllers/fleet/device_controller')
const CommandController = () =>
  import('#presentation/http/controllers/fleet/device_command_controller')
const FlespiChannelController = () =>
  import('#presentation/http/controllers/fleet/flespi_channel_controller')
const ImmobilizationController = () =>
  import('#presentation/http/controllers/security/immobilization_controller')

/**
 * Routage de l'API — versionné dès le premier jour.
 *
 * Le TDR prévoit des intégrations ERP, logistiques et SIEM : faire évoluer un
 * contrat déjà consommé par un système tiers, sans versionnement, n'est pas
 * rattrapable.
 */

// --------------------------------------------------------------- santé
router.get('/health', async ({ response }) => {
  return response.ok({ status: 'ok', service: 'sisbm-core', time: new Date().toISOString() })
})

// --------------------------------------------------------------- connexion
router
  .group(() => {
    router.post('/auth/login', [AuthController, 'login']).use(throttle.auth)
  })
  .prefix('/api/v1')

// --------------------------------------------------------------- API authentifiée
router
  .group(() => {
    // ---- session
    router.get('/auth/me', [AuthController, 'me'])
    router.post('/auth/logout', [AuthController, 'logout'])
    router.post('/users/me/password', [UserController, 'changePassword'])

    // ---- utilisateurs et rôles
    router.get('/roles', [UserController, 'roles'])
    router.get('/users', [UserController, 'index'])
    router.post('/users', [UserController, 'store'])
    router.get('/users/:id', [UserController, 'show'])
    router.patch('/users/:id', [UserController, 'update'])
    router.post('/users/:id/suspend', [UserController, 'suspend'])
    router.delete('/users/:id', [UserController, 'destroy'])

    // ---- véhicules
    router.get('/vehicles', [VehicleController, 'index'])
    router.post('/vehicles', [VehicleController, 'store'])
    router.get('/vehicles/:id', [VehicleController, 'show'])
    router.patch('/vehicles/:id', [VehicleController, 'update'])
    router.delete('/vehicles/:id', [VehicleController, 'destroy'])

    // ---- boîtiers
    router.get('/devices', [DeviceController, 'index'])
    router.post('/devices', [DeviceController, 'store'])
    router.get('/devices/:id', [DeviceController, 'show'])
    router.patch('/devices/:id', [DeviceController, 'update'])
    router.delete('/devices/:id', [DeviceController, 'destroy'])

    // ---- journal d'audit
    /**
     * Lecture seule : `audit_logs` est append-only, le rôle applicatif n'a
     * ni UPDATE ni DELETE dessus. La route `/actions` précède `/:id`
     * éventuels — aucun conflit ici, mais l'ordre reste explicite.
     */
    router.get('/audit-logs', [AuditLogController, 'index'])
    router.get('/audit-logs/actions', [AuditLogController, 'actions'])

    // ---- affectation datée boîtier <-> véhicule
    router.post('/devices/:id/assignment', [DeviceController, 'assign'])
    router.delete('/devices/:id/assignment', [DeviceController, 'unassign'])

    // ---- diagnostic : interroge FLESPI, pas notre base
    router.get('/devices/:id/telemetry', [DeviceController, 'liveTelemetry'])
    router.get('/devices/:id/telemetry/history', [DeviceController, 'liveHistory'])

    // ---- rattachement flespi du boîtier
    router.post('/devices/:id/flespi/sync', [DeviceController, 'syncFlespi'])
    router.get('/devices/:id/flespi', [DeviceController, 'flespiStatus'])
    router.get('/devices/:id/flespi/logs', [DeviceController, 'flespiLogs'])
    router.get('/devices/:id/flespi/telemetry', [DeviceController, 'flespiTelemetry'])
    router.get('/devices/:id/flespi/commands', [CommandController, 'flespiCatalog'])
  })
  .prefix('/api/v1')
  .use(middleware.auth())

// --------------------------------------------------------------- organisations (plateforme)
/**
 * Administration des organisations clientes et de leurs comptes.
 * Réservé à l'exploitant (`organization:*`, couvert uniquement par `*`).
 *
 * Pas de `throttle.sensitive` ici : son compteur est PARTAGÉ avec
 * l'immobilisation (10/min, blocage 5 min). La navigation du tableau de bord
 * dans la liste des organisations bloquerait une coupure moteur légitime.
 */
router
  .group(() => {
    router.get('/organizations', [OrganizationController, 'index'])
    router.post('/organizations', [OrganizationController, 'store'])
    router.get('/organizations/:id', [OrganizationController, 'show'])
    router.patch('/organizations/:id', [OrganizationController, 'update'])

    // ---- comptes rattachés à l'organisation
    router.get('/organizations/:id/users', [OrganizationController, 'users'])
    router.post('/organizations/:id/users', [OrganizationController, 'storeUser'])
    router.get('/organizations/:id/roles', [OrganizationController, 'roles'])

    // ---- journal d'audit de l'organisation
    router.get('/organizations/:id/audit-logs', [AuditLogController, 'byOrganization'])

    /**
     * Groupes créés POUR une organisation désignée. Les mêmes contrôleurs
     * servent les routes auto-portées ci-dessous : `:organizationId` est lu
     * par `organizationScope()`, qui le refuse à qui n'a pas le joker `*`.
     */
    router
      .group(() => {
        // Noms explicites : ces routes partagent leurs contrôleurs avec les
        // routes auto-portées, et AdonisJS refuse deux noms générés identiques.
        router
          .get('/vehicle-groups', [VehicleGroupController, 'index'])
          .as('organizations.vehicleGroups.index')
        router
          .post('/vehicle-groups', [VehicleGroupController, 'store'])
          .as('organizations.vehicleGroups.store')
        router
          .get('/device-groups', [DeviceGroupController, 'index'])
          .as('organizations.deviceGroups.index')
        router
          .post('/device-groups', [DeviceGroupController, 'store'])
          .as('organizations.deviceGroups.store')
      })
      .prefix('/organizations/:organizationId')
      .where('organizationId', router.matchers.uuid())
  })
  .prefix('/api/v1')
  // Un :id mal formé serait rejeté par PostgreSQL (22P02 → 500) : 404 d'emblée.
  .where('id', router.matchers.uuid())
  .use(middleware.auth())

// --------------------------------------------------------------- groupes
/**
 * Groupes de véhicules et de boîtiers.
 *
 * `:id` et `:memberId` sont contraints au format uuid : sans ce filtre, un
 * identifiant mal formé partirait jusqu'à PostgreSQL, qui répondrait 22P02 —
 * soit un 500 là où la bonne réponse est un 404.
 */
router
  .group(() => {
    // ---- groupes de véhicules
    router.get('/vehicle-groups', [VehicleGroupController, 'index'])
    router.post('/vehicle-groups', [VehicleGroupController, 'store'])
    router.get('/vehicle-groups/:id', [VehicleGroupController, 'show'])
    router.patch('/vehicle-groups/:id', [VehicleGroupController, 'update'])
    router.delete('/vehicle-groups/:id', [VehicleGroupController, 'destroy'])
    router.get('/vehicle-groups/:id/vehicles', [VehicleGroupController, 'members'])
    router.post('/vehicle-groups/:id/vehicles', [VehicleGroupController, 'assign'])
    router.delete('/vehicle-groups/:id/vehicles/:memberId', [VehicleGroupController, 'unassign'])
    router.get('/vehicle-groups/:id/audit-logs', [VehicleGroupController, 'auditLogsOfGroup'])

    // ---- groupes de boîtiers
    router.get('/device-groups', [DeviceGroupController, 'index'])
    router.post('/device-groups', [DeviceGroupController, 'store'])
    router.get('/device-groups/:id', [DeviceGroupController, 'show'])
    router.patch('/device-groups/:id', [DeviceGroupController, 'update'])
    router.delete('/device-groups/:id', [DeviceGroupController, 'destroy'])
    router.get('/device-groups/:id/devices', [DeviceGroupController, 'members'])
    router.post('/device-groups/:id/devices', [DeviceGroupController, 'assign'])
    router.delete('/device-groups/:id/devices/:memberId', [DeviceGroupController, 'unassign'])
    router.get('/device-groups/:id/audit-logs', [DeviceGroupController, 'auditLogsOfGroup'])
  })
  .prefix('/api/v1')
  .where('id', router.matchers.uuid())
  .where('memberId', router.matchers.uuid())
  .use(middleware.auth())

// --------------------------------------------------------------- administration flespi
/**
 * Canaux et catalogue flespi. Relais de l'API flespi, protégé par nos
 * habilitations : le jeton flespi ne quitte jamais le serveur.
 */
router
  .group(() => {
    router.get('/health', [FlespiChannelController, 'health'])

    router.get('/protocols', [FlespiChannelController, 'protocols'])
    router.get('/protocols/:protocol/device-types', [FlespiChannelController, 'deviceTypes'])
    router.get('/protocols/:protocol/device-types/:typeId', [FlespiChannelController, 'deviceType'])

    router.get('/channels', [FlespiChannelController, 'index'])
    router.post('/channels', [FlespiChannelController, 'store'])
    router.get('/channels/:id', [FlespiChannelController, 'show']).where('id', /^\d+$/)
    router.patch('/channels/:id', [FlespiChannelController, 'update']).where('id', /^\d+$/)
    router.delete('/channels/:id', [FlespiChannelController, 'destroy']).where('id', /^\d+$/)
    router.get('/channels/:id/logs', [FlespiChannelController, 'logs']).where('id', /^\d+$/)
    router.get('/channels/:id/messages', [FlespiChannelController, 'messages']).where('id', /^\d+$/)
    router
      .get('/channels/:id/connections', [FlespiChannelController, 'connections'])
      .where('id', /^\d+$/)
    router.get('/channels/:id/idents', [FlespiChannelController, 'idents']).where('id', /^\d+$/)
  })
  .prefix('/api/v1/flespi')
  .use(middleware.auth())

// --------------------------------------------------------------- commandes boîtier
/**
 * Ces routes agissent sur du MATÉRIEL RÉEL installé dans un véhicule en
 * circulation. Débit volontairement bas : aucune de ces commandes n'est une
 * opération de masse, et un pic est un signal d'alerte.
 */
router
  .group(() => {
    router.get('/devices/:id/commands', [CommandController, 'catalog'])
    router.get('/devices/:id/commands/history', [CommandController, 'history'])
    router.get('/devices/:id/commands/results', [CommandController, 'results'])
    router.post('/devices/:id/commands/sync', [CommandController, 'sync'])

    // ---- commande flespi brute, validée contre le catalogue réel du boîtier
    router.post('/devices/:id/commands/send', [CommandController, 'send'])
    router
      .delete('/devices/:id/commands/:commandId', [CommandController, 'cancel'])
      .where('commandId', /^[0-9a-f-]{36}$/)

    // ---- alarme embarquée
    router.post('/devices/:id/commands/arm', [CommandController, 'arm'])
    router.post('/devices/:id/commands/disarm', [CommandController, 'disarm'])

    // ---- diagnostic
    router.post('/devices/:id/commands/request-status', [CommandController, 'requestStatus'])
    router.post('/devices/:id/commands/reboot', [CommandController, 'reboot'])

    // ---- rythme de reporting
    router.post('/devices/:id/commands/start-tracking', [CommandController, 'startTracking'])
    router.post('/devices/:id/commands/stop-tracking', [CommandController, 'stopTracking'])

    // ---- sortie auxiliaire et configuration
    router.post('/devices/:id/commands/set-output', [CommandController, 'setOutput'])
    router.post('/devices/:id/commands/set-admin-number', [CommandController, 'setAdminNumber'])
    router.post('/devices/:id/commands/change-password', [CommandController, 'changePassword'])
    router.post('/devices/:id/commands/reset-password', [CommandController, 'resetPassword'])
    router.post('/devices/:id/commands/set-apn', [CommandController, 'setApn'])

    // ---- géofences embarquées (à valider sur boîtier réel — Phase 2)
    router.post('/devices/:id/commands/add-geofence', [CommandController, 'addGeofence'])
    router.post('/devices/:id/commands/remove-geofence', [CommandController, 'removeGeofence'])

    /**
     * Coupure moteur : REFUSÉE ici, volontairement.
     * Elle passe par /security/immobilizations, qui applique le garde-fou de
     * vitesse (CM-07), la fraîcheur de position et la traçabilité complète.
     * Ces deux routes existent pour renvoyer un message explicite plutôt qu'un
     * 404 qui laisserait croire à une erreur de chemin.
     */
    router
      .post('/devices/:id/commands/cut-engine', [CommandController, 'engineForbidden'])
      .as('command.cutEngineForbidden')
    router
      .post('/devices/:id/commands/restore-engine', [CommandController, 'engineForbidden'])
      .as('command.restoreEngineForbidden')
  })
  .prefix('/api/v1')
  .use([middleware.auth(), throttle.sensitive])

// --------------------------------------------------------------- immobilisation
router
  .group(() => {
    router.post('/security/immobilizations', [ImmobilizationController, 'store'])
    router.post('/security/immobilizations/:id/validation', [ImmobilizationController, 'validate'])

    /**
     * Émission réelle de la coupure vers le boîtier, après validation.
     * Soumise à IMMOBILIZATION_ENABLED.
     */
    router.post('/security/immobilizations/:id/dispatch', [ImmobilizationController, 'dispatch'])

    /** Rétablissement du moteur : demande et émission en un appel. */
    router.post('/security/restorations', [ImmobilizationController, 'restore'])
  })
  .prefix('/api/v1')
  .use([middleware.auth(), throttle.sensitive])
