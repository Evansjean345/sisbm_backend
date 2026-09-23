import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import sisbmConfig from '#config/sisbm'
import DeviceModel from '#infrastructure/persistence/models/device_model'
import {
  FLESPI_COMMANDS,
  HttpFlespiCommandGateway,
  buildBusinessCommand,
  checkAgainstCatalog,
  type CommandType,
  type FlespiCommand,
  type FlespiCommandName,
  type SendResult,
} from '#infrastructure/gateways/flespi/flespi_command_gateway'
import { FlespiApiError } from '#infrastructure/gateways/flespi/flespi_client'
import { FlespiDeviceGateway } from '#infrastructure/gateways/flespi/flespi_device_gateway'
import { FlespiCommandTracker } from '#infrastructure/gateways/flespi/flespi_command_tracker'
import {
  commandParamsValidator,
  flespiCommandValidator,
} from '#presentation/http/validators/fleet/command_validators'
import { authorize } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import DeviceCommandModel from '#infrastructure/persistence/models/device_command_model'
import {
  adminListCommandsValidator,
  adminOrganizationFilterValidator,
} from '#presentation/http/validators/admin/admin_validators'
import {
  PLATFORM_SCOPE,
  applyScope,
  authorizePlatform,
  countsBy,
  ownScope,
  serializeWithOrganizations,
  type TenantScope,
} from '#presentation/http/support/platform_scope'

/**
 * =========================================================================
 *  COMMANDES SUR BOÎTIER RÉEL
 * =========================================================================
 *
 *  ① Toute commande est TRACÉE dans `device_commands` AVANT d'être émise.
 *  ② Toute commande porte un MOTIF.
 *  ③ La coupure moteur ne passe PAS par ici (contexte `security`, CM-07),
 *    ni par les routes métier, ni par la route brute `/commands/send`.
 *  ④ NOUVEAU — la machine à états avance : avant chaque envoi, les commandes
 *    en vol sont réconciliées avec flespi (acknowledged / failed / expired).
 *    Sans cela, l'index CM-09 bloquait le boîtier après sa première commande.
 *  ⑤ NOUVEAU — la commande est validée contre le catalogue RÉEL du boîtier
 *    (`GET /gw/devices/{id}?fields=commands`) avant d'être tracée et émise.
 */

/**
 * Réglages capables de rompre le lien boîtier ↔ flespi (nouveau serveur,
 * mauvais APN). Une erreur ici n'est PAS rattrapable à distance : il faut
 * intervenir physiquement ou par SMS. Confirmation explicite exigée.
 */
const REGLAGES_CRITIQUES = new Set([
  'setting.server.set',
  'setting.network.set',
  'setting.auto_apn.set',
])

@inject()
export default class DeviceCommandController {
  constructor(
    private readonly gateway: HttpFlespiCommandGateway,
    private readonly devices: FlespiDeviceGateway,
    private readonly tracker: FlespiCommandTracker
  ) {}

  /** GET /api/v1/devices/:id/commands — catalogue des commandes métier SISBM. */
  async catalog(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    return ctx.response.ok({
      data: Object.entries(FLESPI_COMMANDS).map(([nom, def]) => ({
        name: nom,
        label: def.label,
        flespiCommand: {
          name: 'custom',
          properties: { command_code: def.code, data: def.data ?? '<data>' },
        },
        requiresData: def.data === null,
        sensitive: def.sensitive,
        verified: def.verified,
        endpoint: `/api/v1/devices/:id/commands/${nom.replace(/_/g, '-')}`,
      })),
      meta: {
        note:
          'Seuls les codes « verified » sont confirmés par la documentation flespi. Le catalogue ' +
          'exact accepté par CE boîtier est sur GET /api/v1/devices/:id/flespi/commands.',
      },
    })
  }

  /** GET /api/v1/devices/:id/flespi/commands — catalogue RÉEL publié par flespi pour ce boîtier. */
  async flespiCatalog(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    return this.flespiCatalogScoped(ctx, ownScope(ctx))
  }

  /** GET /api/v1/devices/:id/commands/history */
  async history(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    return this.historyScoped(ctx, ownScope(ctx))
  }

  /** POST /api/v1/devices/:id/commands/sync — réconcilie les commandes en vol avec flespi. */
  async sync(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    return this.syncScoped(ctx, ownScope(ctx))
  }

  /** GET /api/v1/devices/:id/commands/results — résultats bruts renvoyés par flespi. */
  async results(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    return this.resultsScoped(ctx, ownScope(ctx))
  }

  /** DELETE /api/v1/devices/:id/commands/:commandId — annule une commande encore en file. */
  async cancel(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    return this.cancelScoped(ctx, ownScope(ctx))
  }

  // ------------------------------------------------------------- alarme
  arm = (ctx: HttpContext) => this.executerMetier(ctx, 'arm', ownScope(ctx))
  disarm = (ctx: HttpContext) => this.executerMetier(ctx, 'disarm', ownScope(ctx))

  // ------------------------------------------------------------- diagnostic
  requestStatus = (ctx: HttpContext) => this.executerMetier(ctx, 'request_status', ownScope(ctx))
  reboot = (ctx: HttpContext) => this.executerMetier(ctx, 'reboot', ownScope(ctx))

  // ------------------------------------------------------------- suivi
  startTracking = (ctx: HttpContext) => this.executerMetier(ctx, 'start_tracking', ownScope(ctx))
  stopTracking = (ctx: HttpContext) => this.executerMetier(ctx, 'stop_tracking', ownScope(ctx))

  // ------------------------------------------------------------- sortie
  /** body: { data: "0,1", reason } */
  setOutput = (ctx: HttpContext) => this.executerMetier(ctx, 'set_output', ownScope(ctx))

  // ------------------------------------------------------------- configuration
  setAdminNumber = (ctx: HttpContext) => this.executerMetier(ctx, 'set_admin_number', ownScope(ctx))
  changePassword = (ctx: HttpContext) => this.executerMetier(ctx, 'change_password', ownScope(ctx))
  resetPassword = (ctx: HttpContext) => this.executerMetier(ctx, 'reset_password', ownScope(ctx))
  setApn = (ctx: HttpContext) => this.executerMetier(ctx, 'set_apn', ownScope(ctx))

  // ------------------------------------------------------------- géofences embarquées
  addGeofence = (ctx: HttpContext) => this.executerMetier(ctx, 'add_geofence', ownScope(ctx))
  removeGeofence = (ctx: HttpContext) => this.executerMetier(ctx, 'remove_geofence', ownScope(ctx))

  /**
   * POST /api/v1/devices/:id/commands/send
   * body : { name, properties, reason, mode?, ttl?, confirm? }
   *
   * Commande flespi BRUTE, validée contre le catalogue réel du boîtier —
   * c'est le moyen d'utiliser TOUTES les commandes que flespi expose pour
   * le MV730 (réglages `setting.*`, `custom`…), sans attendre qu'une route
   * métier existe. Habilitation « commande sensible » exigée.
   */
  async send(ctx: HttpContext) {
    await authorize(ctx, 'requestImmobilization')
    return this.sendScoped(ctx, ownScope(ctx))
  }

  // ------------------------------------------------------------- moteur : refusé ici
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

  // =========================================================================
  //  TABLEAU DE BORD ADMIN — toutes organisations (joker `*` exigé)
  // =========================================================================

  /**
   * GET /api/v1/admin/commands
   * ?organizationId=&deviceId=&vehicleId=&status=&commandType=&from=&to=&page=&perPage=
   *
   * Journal de toutes les commandes émises sur la plateforme, du plus récent
   * au plus ancien. Chaque ligne porte son organisation.
   */
  async indexAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const f = await ctx.request.validateUsing(adminListCommandsValidator)

    const query = DeviceCommandModel.query().orderBy('requested_at', 'desc')
    if (f.organizationId) query.where('organization_id', f.organizationId)
    if (f.deviceId) query.where('device_id', f.deviceId)
    if (f.vehicleId) query.where('vehicle_id', f.vehicleId)
    if (f.status) query.where('status', f.status)
    if (f.commandType) query.where('command_type', f.commandType)
    if (f.from) query.where('requested_at', '>=', new Date(f.from))
    if (f.to) query.where('requested_at', '<=', new Date(f.to))

    const resultat = await query.paginate(f.page ?? 1, Math.min(f.perPage ?? 25, 100))
    return ctx.response.ok(await serializeWithOrganizations(resultat))
  }

  /**
   * GET /api/v1/admin/commands/stats?organizationId=
   *
   * Commandes des dernières 24 h par statut et par type, plus le nombre de
   * commandes EN VOL (toutes dates) — celles qui bloquent un boîtier (CM-09).
   */
  async statsAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(adminOrganizationFilterValidator)

    const base = () => {
      const q = DeviceCommandModel.query()
      if (organizationId) q.where('organization_id', organizationId)
      return q
    }
    const depuis = DateTime.now().minus({ hours: 24 }).toJSDate()

    const [parStatut, parType, enVol] = await Promise.all([
      base()
        .where('requested_at', '>=', depuis)
        .select('status')
        .count('* as total')
        .groupBy('status'),
      base()
        .where('requested_at', '>=', depuis)
        .select('command_type')
        .count('* as total')
        .groupBy('command_type'),
      base()
        .whereIn('status', ['pending_validation', 'approved', 'queued', 'sent'])
        .count('* as total')
        .first(),
    ])

    const statuts = countsBy(parStatut, 'status')
    return ctx.response.ok({
      data: {
        last24h: {
          total: Object.values(statuts).reduce((a, b) => a + b, 0),
          byStatus: statuts,
          byType: countsBy(parType, 'commandType'),
        },
        inFlight: Number(enVol?.$extras.total ?? 0),
      },
    })
  }

  /** GET /api/v1/admin/devices/:id/commands/history */
  async historyAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.historyScoped(ctx, PLATFORM_SCOPE)
  }

  /** GET /api/v1/admin/devices/:id/flespi/commands */
  async flespiCatalogAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.flespiCatalogScoped(ctx, PLATFORM_SCOPE)
  }

  /** POST /api/v1/admin/devices/:id/commands/sync — à appeler après CHAQUE commande. */
  async syncAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.syncScoped(ctx, PLATFORM_SCOPE)
  }

  /** GET /api/v1/admin/devices/:id/commands/results */
  async resultsAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.resultsScoped(ctx, PLATFORM_SCOPE)
  }

  /** DELETE /api/v1/admin/devices/:id/commands/:commandId */
  async cancelAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.cancelScoped(ctx, PLATFORM_SCOPE)
  }

  /** POST /api/v1/admin/devices/:id/commands/send — commande flespi brute (mêmes garde-fous). */
  async sendAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.sendScoped(ctx, PLATFORM_SCOPE)
  }

  /**
   * POST /api/v1/admin/devices/:id/commands/:command
   * (arm, disarm, request-status, reboot, start-tracking, stop-tracking,
   *  set-output, set-admin-number, change-password, reset-password, set-apn,
   *  add-geofence, remove-geofence)
   *
   * Une seule fonction pour toutes les commandes métier : le nom vient de
   * l'URL, en kebab-case comme les routes client. La coupure et le
   * rétablissement moteur restent REFUSÉS (contexte `security`, CM-07).
   */
  async executeAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const nom = String(ctx.params.command ?? '').replace(/-/g, '_') as FlespiCommandName

    if (nom === 'cut_engine' || nom === 'restore_engine') return this.engineForbidden(ctx)
    if (!Object.hasOwn(FLESPI_COMMANDS, nom)) {
      return ctx.response.notFound({
        error: {
          code: 'E_UNKNOWN_COMMAND',
          message: `Commande inconnue : ${ctx.params.command}`,
          details: { command: ctx.params.command },
        },
      })
    }
    return this.executerMetier(ctx, nom, PLATFORM_SCOPE)
  }

  // -------------------------------------------------------------------------
  //  Implémentations partagées client / admin : seul le périmètre change.
  // -------------------------------------------------------------------------

  private async historyScoped(ctx: HttpContext, scope: TenantScope) {
    const query = db.from('device_commands').where('device_id', ctx.params.id)
    const lignes = await applyScope(query, scope)
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
        'expires_at',
        'error_message',
        'provider_command_id',
        'safety_context'
      )

    return ctx.response.ok({ data: lignes })
  }

  private async flespiCatalogScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.boitier(ctx, scope)
    if (!device) return
    const catalogue = await this.devices.commandsCatalog(device.flespiDeviceId!)
    return ctx.response.ok({
      data: catalogue.map((c) => ({
        name: c.name,
        title: c.schema?.title ?? null,
        description: c.schema?.description ?? null,
        tab: c.tab ?? null,
        address: c.address ?? [],
        schema: c.schema,
        examples: c.examples ?? [],
      })),
    })
  }

  private async syncScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.boitier(ctx, scope)
    if (!device) return
    const tracker = this.tracker
    const rapport = await tracker.sync(device.id, device.flespiDeviceId!)
    return ctx.response.ok({ data: rapport })
  }

  private async resultsScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.boitier(ctx, scope)
    if (!device) return
    const gw = this.gateway
    const [resultats, file] = await Promise.all([
      gw.results(device.flespiDeviceId!),
      gw.pending(device.flespiDeviceId!),
    ])
    return ctx.response.ok({ data: { results: resultats, queue: file } })
  }

  private async cancelScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.boitier(ctx, scope)
    if (!device) return
    const ligne = await db
      .from('device_commands')
      .where('id', ctx.params.commandId)
      .where('device_id', device.id)
      .whereIn('status', ['queued', 'sent'])
      .first()
    if (!ligne) {
      return ctx.response.notFound({
        error: {
          code: 'E_NOT_FOUND',
          message: 'Aucune commande en vol avec cet identifiant',
          details: {},
        },
      })
    }
    if (ligne.provider_command_id) {
      await this.gateway.cancel(device.flespiDeviceId!, ligne.provider_command_id).catch((err) => {
        // Déjà partie ou déjà expirée chez flespi : l'annulation locale reste valable.
        logger.warn({ err, commandId: ligne.id }, '[commands] annulation flespi sans effet')
      })
    }
    const contexte = toExecutionContext(ctx)
    await db.transaction(async (trx) => {
      await trx.from('device_commands').where('id', ligne.id).update({ status: 'cancelled' })
      await trx.table('device_command_logs').insert({
        command_id: ligne.id,
        status_from: ligne.status,
        status_to: 'cancelled',
        actor_id: contexte.actorId,
        actor_type: 'user',
        actor_ip: contexte.ip ?? null,
        payload: JSON.stringify({}),
      })
    })
    return ctx.response.noContent()
  }

  private async sendScoped(ctx: HttpContext, scope: TenantScope) {
    const p = await ctx.request.validateUsing(flespiCommandValidator)
    const cmd: FlespiCommand = {
      name: p.name,
      properties: (p.properties ?? {}) as Record<string, unknown>,
    }

    if (this.estCoupureMoteur(cmd)) return this.engineForbidden(ctx)
    if (REGLAGES_CRITIQUES.has(cmd.name) && !p.confirm) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_CONFIRMATION_REQUIRED',
          message:
            `« ${cmd.name} » peut rompre définitivement le lien du boîtier avec flespi ` +
            '(serveur ou APN erroné = boîtier injoignable à distance). Renvoyer avec confirm=true.',
          details: { command: cmd.name },
        },
      })
    }

    return this.executer(
      ctx,
      {
        cmd,
        label: cmd.name,
        commandType: cmd.name.includes('reboot') ? 'reboot' : 'custom',
        reason: p.reason,
        mode: p.mode ?? 'queue',
        ttl: p.ttl,
      },
      scope
    )
  }

  // -------------------------------------------------------------------------

  private async executerMetier(ctx: HttpContext, commande: FlespiCommandName, scope: TenantScope) {
    const def = FLESPI_COMMANDS[commande]
    await authorize(ctx, def.sensitive ? 'requestImmobilization' : 'manageVehicles')
    const payload = await ctx.request.validateUsing(commandParamsValidator)

    if (def.data === null && !payload.data) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_MISSING_COMMAND_DATA',
          message: `La commande « ${def.label} » exige un paramètre « data »`,
          details: { command: commande, commandCode: def.code },
        },
      })
    }
    if (!def.verified) {
      logger.warn(
        { commande, code: def.code },
        '[commands] code Micodus non encore validé sur boîtier réel'
      )
    }

    return this.executer(
      ctx,
      {
        cmd: buildBusinessCommand(commande, payload.data),
        label: def.label,
        commandType: def.commandType,
        reason: payload.reason,
        mode: payload.mode ?? 'queue',
        ttl: payload.ttl,
      },
      scope
    )
  }

  /**
   * Chaîne commune : boîtier → catalogue → réconciliation → trace → émission → mise à jour.
   */
  private async executer(
    ctx: HttpContext,
    input: {
      cmd: FlespiCommand
      label: string
      commandType: CommandType
      reason: string
      mode: 'queue' | 'instant'
      ttl?: number
    },
    scope: TenantScope
  ) {
    const contexte = toExecutionContext(ctx)
    const device = await this.boitier(ctx, scope)
    if (!device) return
    const flespiDeviceId = device.flespiDeviceId!

    // ---- ⑤ validation contre le catalogue réel du boîtier
    const catalogue = await this.devices.commandsCatalog(flespiDeviceId).catch(() => [])
    const erreurs = checkAgainstCatalog(input.cmd, catalogue)
    if (erreurs.length) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_COMMAND_NOT_SUPPORTED',
          message: `Commande refusée par le schéma flespi de ce boîtier : ${erreurs[0]}`,
          details: { command: input.cmd, errors: erreurs },
        },
      })
    }

    // ---- ④ réconciliation : débloque le boîtier si la commande précédente est terminée
    const tracker = this.tracker
    await tracker.sync(device.id, flespiDeviceId)
    const enVol = await db
      .from('device_commands')
      .where('device_id', device.id)
      .whereIn('status', ['pending_validation', 'approved', 'queued', 'sent'])
      .select('id', 'status', 'command_type', 'expires_at')
      .first()
    if (enVol) {
      return ctx.response.conflict({
        error: {
          code: 'E_COMMAND_IN_FLIGHT',
          message:
            'Une commande est déjà en cours pour ce boîtier. Attendre son résultat, ' +
            `l'annuler (DELETE /devices/${device.id}/commands/${enVol.id}) ou relancer la synchronisation.`,
          details: { command: enVol },
        },
      })
    }

    const ttl = input.ttl ?? sisbmConfig.flespi.commandTtlSeconds
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
      // Organisation du BOÎTIER : identique à celle de l'acteur côté client,
      // indispensable côté admin (le super_admin n'est pas du même client).
      organization_id: device.organizationId,
      device_id: device.id,
      vehicle_id: vehicule?.vehicle_id ?? null,
      command_type: input.commandType,
      status: 'queued',
      reason: input.reason,
      origin: 'manual',
      requested_by: contexte.actorId,
      requested_at: DateTime.now().toSQL(),
      // Hors coupure moteur, CM-07 ne s'applique pas : seuil neutre.
      safety_speed_limit_kph: 20,
      requires_validation: false,
      queued_at: DateTime.now().toSQL(),
      expires_at: DateTime.now()
        .plus({ seconds: input.mode === 'instant' ? 120 : ttl })
        .toSQL(),
      attempts: 0,
      safety_context: JSON.stringify({ flespiCommand: input.cmd, mode: input.mode }),
    })

    // ---- ② émission
    const gw = this.gateway
    let resultat: SendResult
    try {
      resultat =
        input.mode === 'instant'
          ? await gw.execute(flespiDeviceId, input.cmd)
          : await gw.queue(flespiDeviceId, input.cmd, {
              ttl,
              maxAttempts: sisbmConfig.flespi.commandMaxAttempts,
            })
    } catch (err) {
      const raison = err instanceof FlespiApiError ? err.reason : (err as Error).message
      await this.journaliser(
        commandId,
        'queued',
        'failed',
        contexte,
        { error: raison },
        {
          failed_at: DateTime.now().toSQL(),
          error_message: raison,
          attempts: 1,
        }
      )
      const status = err instanceof FlespiApiError ? err.httpStatusForClient : 502
      return ctx.response.status(status).send({
        error: {
          code: 'E_COMMAND_FAILED',
          message: `La commande « ${input.label} » n'a pas pu être transmise : ${raison}`,
          details: {
            commandId,
            hint:
              input.mode === 'instant' && /not connected/i.test(raison)
                ? 'Boîtier hors ligne : renvoyer en mode « queue », elle partira à sa prochaine connexion.'
                : undefined,
          },
        },
      })
    }

    // ---- ③ mise à jour de la trace
    const maintenant = DateTime.now().toSQL()
    const statut =
      resultat.mode === 'queue' ? 'sent' : resultat.executed ? 'acknowledged' : 'failed'
    await this.journaliser(
      commandId,
      'queued',
      statut,
      contexte,
      { flespiCommand: input.cmd, mode: resultat.mode, response: resultat.response },
      {
        sent_at: maintenant,
        provider_command_id: resultat.providerCommandId,
        attempts: 1,
        ...(statut === 'acknowledged' ? { acknowledged_at: maintenant } : {}),
        ...(statut === 'failed'
          ? { failed_at: maintenant, error_message: String(resultat.response ?? 'non exécutée') }
          : {}),
        ...(resultat.expiresAt
          ? { expires_at: DateTime.fromJSDate(resultat.expiresAt).toSQL() }
          : {}),
      }
    )

    logger.info(
      { commandId, device: device.imei, name: input.cmd.name, mode: resultat.mode, statut },
      '[commands] commande transmise'
    )

    return ctx.response.accepted({
      data: {
        commandId,
        command: input.cmd,
        mode: resultat.mode,
        status: statut,
        providerCommandId: resultat.providerCommandId,
        response: resultat.response,
        expiresAt: resultat.expiresAt,
      },
    })
  }

  private async journaliser(
    commandId: string,
    de: string,
    vers: string,
    contexte: ReturnType<typeof toExecutionContext>,
    payload: Record<string, unknown>,
    champs: Record<string, unknown>
  ) {
    await db.transaction(async (trx) => {
      await trx
        .from('device_commands')
        .where('id', commandId)
        .update({ status: vers, ...champs })
      await trx.table('device_command_logs').insert({
        command_id: commandId,
        status_from: de,
        status_to: vers,
        actor_id: contexte.actorId,
        actor_type: 'user',
        actor_ip: contexte.ip ?? null,
        payload: JSON.stringify(payload),
      })
    })
  }

  /** Coupure moteur déguisée en commande brute : S20 (Micodus) ou RELAY (Concox). */
  private estCoupureMoteur(cmd: FlespiCommand): boolean {
    if (cmd.name !== 'custom') return false
    const code = String(cmd.properties.command_code ?? '').toUpperCase()
    const payload = String(cmd.properties.payload ?? cmd.properties.text ?? '').toUpperCase()
    return (
      code === 'S20' ||
      payload.startsWith('RELAY') ||
      /^8105$/.test(String(cmd.properties.message_id ?? ''))
    )
  }

  /** Boîtier de l'organisation, rattaché à flespi ; sinon répond et renvoie null. */
  private async boitier(ctx: HttpContext, scope: TenantScope): Promise<DeviceModel | null> {
    const query = DeviceModel.query().where('id', ctx.params.id).whereNull('deleted_at')
    const device = await applyScope(query, scope).first()
    if (!device) {
      ctx.response.notFound({
        error: { code: 'E_NOT_FOUND', message: 'Boîtier introuvable', details: {} },
      })
      return null
    }
    if (!device.flespiDeviceId) {
      ctx.response.conflict({
        error: {
          code: 'E_NO_FLESPI_DEVICE',
          message: "Ce boîtier n'est pas rattaché à Flespi : aucune commande ne peut être émise",
          details: {},
        },
      })
      return null
    }
    return device
  }
}
