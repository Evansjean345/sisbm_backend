import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import DeviceModel from '#infrastructure/persistence/models/device_model'
import {
  FLESPI_COMMANDS,
  HttpFlespiCommandGateway,
  type FlespiCommandName,
} from '#infrastructure/gateways/flespi/flespi_command_gateway'
import { commandParamsValidator } from '#presentation/http/validators/fleet/command_validators'
import { authorize } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'

/**
 * =========================================================================
 *  COMMANDES SUR BOÎTIER RÉEL
 * =========================================================================
 *
 * Ces endpoints agissent sur du matériel physique installé dans un véhicule en
 * circulation. Trois principes s'appliquent sans exception :
 *
 *  ① Toute commande est TRACÉE dans `device_commands` AVANT d'être émise.
 *    Si Flespi ne répond pas, la trace existe déjà : on sait qu'une tentative
 *    a eu lieu, par qui et pourquoi.
 *
 *  ② Toute commande porte un MOTIF. Sur `cut_engine`, c'est la pièce produite
 *    en cas de litige avec un client ou un assureur.
 *
 *  ③ La coupure moteur ne passe PAS par ici. Elle relève du contexte
 *    `security`, avec ses garde-fous de vitesse et de fraîcheur de position.
 *    Exposer un raccourci `POST /commands/cut-engine` contournerait CM-07 et
 *    permettrait de couper le moteur d'un véhicule lancé. Les deux routes
 *    correspondantes renvoient une redirection explicite.
 */
export default class DeviceCommandController {
  private gateway(): HttpFlespiCommandGateway {
    return app.container.make(HttpFlespiCommandGateway) as unknown as HttpFlespiCommandGateway
  }

  /** GET /api/v1/devices/:id/commands — catalogue des commandes disponibles. */
  async catalog(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    return ctx.response.ok({
      data: Object.entries(FLESPI_COMMANDS).map(([nom, def]) => ({
        name: nom,
        label: def.label,
        commandCode: def.code,
        requiresData: def.data === null,
        sensitive: def.sensitive,
        endpoint: `/api/v1/devices/:id/commands/${nom.replace(/_/g, '-')}`,
      })),
    })
  }

  /** GET /api/v1/devices/:id/commands/history */
  async history(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const org = toExecutionContext(ctx).organizationId

    const lignes = await db
      .from('device_commands')
      .where('device_id', ctx.params.id)
      .where('organization_id', org)
      .orderBy('requested_at', 'desc')
      .limit(50)
      .select(
        'id',
        'command_type',
        'status',
        'reason',
        'origin',
        'requested_by',
        'requested_at',
        'sent_at',
        'acknowledged_at',
        'failed_at',
        'error_message',
        'provider_command_id'
      )

    return ctx.response.ok({ data: lignes })
  }

  // ------------------------------------------------------------- alarme
  /** POST /api/v1/devices/:id/commands/arm */
  arm = (ctx: HttpContext) => this.executer(ctx, 'arm')
  /** POST /api/v1/devices/:id/commands/disarm */
  disarm = (ctx: HttpContext) => this.executer(ctx, 'disarm')

  // ------------------------------------------------------------- diagnostic
  /** POST /api/v1/devices/:id/commands/request-status */
  requestStatus = (ctx: HttpContext) => this.executer(ctx, 'request_status')
  /** POST /api/v1/devices/:id/commands/reboot */
  reboot = (ctx: HttpContext) => this.executer(ctx, 'reboot')

  // ------------------------------------------------------------- suivi
  /** POST /api/v1/devices/:id/commands/start-tracking */
  startTracking = (ctx: HttpContext) => this.executer(ctx, 'start_tracking')
  /** POST /api/v1/devices/:id/commands/stop-tracking */
  stopTracking = (ctx: HttpContext) => this.executer(ctx, 'stop_tracking')

  // ------------------------------------------------------------- sortie
  /** POST /api/v1/devices/:id/commands/set-output    body: { data: "0,1" } */
  setOutput = (ctx: HttpContext) => this.executer(ctx, 'set_output')

  // ------------------------------------------------------------- configuration
  /** POST /api/v1/devices/:id/commands/set-admin-number  body: { data: "2250707070707" } */
  setAdminNumber = (ctx: HttpContext) => this.executer(ctx, 'set_admin_number')
  /** POST /api/v1/devices/:id/commands/change-password   body: { data: "123456,654321" } */
  changePassword = (ctx: HttpContext) => this.executer(ctx, 'change_password')
  /** POST /api/v1/devices/:id/commands/reset-password */
  resetPassword = (ctx: HttpContext) => this.executer(ctx, 'reset_password')
  /** POST /api/v1/devices/:id/commands/set-apn          body: { data: "orange.ci,orange,orange" } */
  setApn = (ctx: HttpContext) => this.executer(ctx, 'set_apn')

  // ------------------------------------------------------------- géofences embarquées
  /** POST /api/v1/devices/:id/commands/add-geofence     body: { data: "1,1,5.36,-4.01,500" } */
  addGeofence = (ctx: HttpContext) => this.executer(ctx, 'add_geofence')
  /** POST /api/v1/devices/:id/commands/remove-geofence  body: { data: "1" } */
  removeGeofence = (ctx: HttpContext) => this.executer(ctx, 'remove_geofence')

  // ------------------------------------------------------------- moteur : refusé ici
  /**
   * POST /api/v1/devices/:id/commands/cut-engine
   * POST /api/v1/devices/:id/commands/restore-engine
   *
   * Volontairement REFUSÉES. La coupure moteur passe par
   * `POST /api/v1/security/immobilizations`, qui applique le contrôle de
   * vitesse, la fraîcheur de position et la traçabilité complète.
   */
  async engineForbidden(ctx: HttpContext) {
    return ctx.response.forbidden({
      error: {
        code: 'E_USE_IMMOBILIZATION_ENDPOINT',
        message:
          'La coupure moteur ne passe pas par les commandes génériques. Utiliser ' +
          'POST /api/v1/security/immobilizations, qui applique le garde-fou de ' +
          'vitesse et la traçabilité exigée.',
        details: { endpoint: '/api/v1/security/immobilizations' },
      },
    })
  }

  // -------------------------------------------------------------------------

  /**
   * Chaîne commune : habilitation → boîtier → trace → émission → mise à jour.
   */
  private async executer(ctx: HttpContext, commande: FlespiCommandName) {
    const def = FLESPI_COMMANDS[commande]

    // Les commandes sensibles exigent l'habilitation de demande de commande ;
    // les autres se contentent de la gestion de flotte.
    await authorize(ctx, def.sensitive ? 'requestImmobilization' : 'manageVehicles')

    const payload = await ctx.request.validateUsing(commandParamsValidator)
    const contexte = toExecutionContext(ctx)

    const device = await DeviceModel.query()
      .where('id', ctx.params.id)
      .where('organization_id', contexte.organizationId)
      .whereNull('deleted_at')
      .first()

    if (!device) {
      return ctx.response.notFound({
        error: { code: 'E_NOT_FOUND', message: 'Boîtier introuvable', details: {} },
      })
    }
    if (!device.flespiDeviceId) {
      return ctx.response.conflict({
        error: {
          code: 'E_NO_FLESPI_DEVICE',
          message: "Ce boîtier n'est pas rattaché à Flespi : aucune commande ne peut être émise",
          details: {},
        },
      })
    }
    if (def.data === null && !payload.data) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_MISSING_COMMAND_DATA',
          message: `La commande « ${def.label} » exige un paramètre « data »`,
          details: { command: commande, commandCode: def.code },
        },
      })
    }

    const commandId = randomUUID()
    const vehicule = await db
      .from('device_assignments')
      .where('device_id', device.id)
      .whereRaw('upper_inf(period)')
      .select('vehicle_id')
      .first()

    // ---- ① trace AVANT émission
    await db.table('device_commands').insert({
      id: commandId,
      organization_id: contexte.organizationId,
      device_id: device.id,
      vehicle_id: vehicule?.vehicle_id ?? null,
      command_type: this.typeMetier(commande),
      status: 'queued',
      reason: payload.reason,
      origin: 'manual',
      requested_by: contexte.actorId,
      requested_at: DateTime.now().toSQL(),
      // Les commandes hors coupure moteur ne sont pas soumises à CM-07 :
      // le seuil est neutralisé et la vitesse n'est pas exigée.
      safety_speed_limit_kph: 20,
      requires_validation: false,
      queued_at: DateTime.now().toSQL(),
      expires_at: DateTime.now().plus({ minutes: 15 }).toSQL(),
      attempts: 0,
    })

    // ---- ② émission
    try {
      const resultat = await this.gateway().send(device.flespiDeviceId, commande, payload.data)

      await db.from('device_commands').where('id', commandId).update({
        status: 'sent',
        sent_at: DateTime.now().toSQL(),
        provider_command_id: resultat.providerCommandId,
        attempts: 1,
      })
      await db.table('device_command_logs').insert({
        command_id: commandId,
        status_from: 'queued',
        status_to: 'sent',
        actor_id: contexte.actorId,
        actor_type: 'user',
        actor_ip: contexte.ip ?? null,
        payload: JSON.stringify({ commandCode: resultat.commandCode, data: resultat.data }),
      })

      logger.info(
        { commandId, device: device.imei, commande, code: def.code },
        '[commands] commande transmise'
      )

      return ctx.response.accepted({
        data: {
          commandId,
          command: commande,
          commandCode: resultat.commandCode,
          data: resultat.data,
          status: 'sent',
          providerCommandId: resultat.providerCommandId,
        },
      })
    } catch (err) {
      await db
        .from('device_commands')
        .where('id', commandId)
        .update({
          status: 'failed',
          failed_at: DateTime.now().toSQL(),
          error_message: (err as Error).message,
          attempts: 1,
        })
      await db.table('device_command_logs').insert({
        command_id: commandId,
        status_from: 'queued',
        status_to: 'failed',
        actor_id: contexte.actorId,
        actor_type: 'user',
        payload: JSON.stringify({ error: (err as Error).message }),
      })

      return ctx.response.badGateway({
        error: {
          code: 'E_COMMAND_FAILED',
          message: `La commande « ${def.label} » n'a pas pu être transmise`,
          details: { commandId, detail: (err as Error).message },
        },
      })
    }
  }

  /** Rattache la commande à la liste fermée `device_commands.command_type`. */
  private typeMetier(commande: FlespiCommandName): string {
    if (commande === 'request_status') return 'locate'
    if (commande === 'reboot') return 'reboot'
    if (commande === 'start_tracking' || commande === 'stop_tracking') return 'set_interval'
    return 'custom'
  }
}
