import logger from '@adonisjs/core/services/logger'
import type { FlespiClient } from '#infrastructure/gateways/flespi/flespi_client'
import type { DeviceCommandGateway } from '#application/security/ports'
import type {
  FlespiCommandDefinition,
  FlespiCommandResult,
  FlespiQueuedCommand,
} from '#infrastructure/gateways/flespi/flespi_types'
import { validateAgainstSchema } from '#infrastructure/gateways/flespi/flespi_schema_validator'

/**
 * =========================================================================
 *  PASSERELLE DE COMMANDES FLESPI — Micodus MV730
 * =========================================================================
 *
 * ✗ AVANT : POST /gw/devices/{id}/commands   { command_code, data }
 *   → n'existe pas sous cette forme : flespi attend un TABLEAU de
 *     { name, properties }. Le code constructeur n'est pas le nom de commande.
 *
 * ✓ APRÈS — deux modes, deux endpoints flespi :
 *
 *   FILE D'ATTENTE (défaut)  POST /gw/devices/{id}/commands-queue
 *     [{ name, properties, ttl, max_attempts, priority }]
 *     → la commande attend que le boîtier soit connecté (jusqu'à `ttl`
 *       secondes, `max_attempts` essais). Adapté à un traceur qui coupe son
 *       GPRS à l'arrêt (mode veille / stop_mode du MV730).
 *     Résultat plus tard : GET /gw/devices/{id}/commands-result
 *
 *   INSTANTANÉ               POST /gw/devices/{id}/commands
 *     [{ name, properties, timeout }]
 *     → échoue immédiatement si le boîtier n'est pas connecté
 *       (« device not connected »). Réservé au diagnostic interactif.
 *
 * Commandes Micodus MV730 : flespi les expose via la commande générique
 * `custom`, dont le schéma pour MV33/MV710/MV720/MV730/MV740/MV790G est
 * `{ command_code, data }` — exemple officiel (flespi.com/protocols/micodus) :
 *
 *     { "name": "custom", "properties": { "command_code": "S20", "data": "1,1" } }
 *     → coupure huile + alimentation
 *
 * Seul S20 est confirmé par la documentation flespi. Les autres codes
 * proviennent du support SISBM et sont marqués `verified: false` : à valider
 * sur boîtier réel (GET /api/v1/devices/:id/flespi/commands renvoie le
 * schéma exact que flespi accepte pour CE boîtier).
 */

export type FlespiCommandName =
  | 'cut_engine'
  | 'restore_engine'
  | 'arm'
  | 'disarm'
  | 'set_output'
  | 'set_admin_number'
  | 'change_password'
  | 'reset_password'
  | 'request_status'
  | 'reboot'
  | 'start_tracking'
  | 'stop_tracking'
  | 'add_geofence'
  | 'remove_geofence'
  | 'set_apn'

/** Valeurs autorisées par la contrainte `ck_device_commands_type`. */
export type CommandType =
  'engine_cut' | 'engine_restore' | 'locate' | 'reboot' | 'set_interval' | 'custom'

interface Definition {
  /** Code constructeur Micodus, transmis dans `properties.command_code`. */
  code: string
  /** Charge utile fixe, ou `null` si elle dépend des paramètres. */
  data: string | null
  /** Une commande sensible exige une habilitation dédiée et un motif tracé. */
  sensitive: boolean
  /** Confirmé par la documentation flespi / un test sur boîtier réel. */
  verified: boolean
  commandType: CommandType
  label: string
}

export const FLESPI_COMMANDS: Record<FlespiCommandName, Definition> = {
  // ---- contrôle moteur / carburant (exemple officiel flespi)
  cut_engine: {
    code: 'S20',
    data: '1,1',
    sensitive: true,
    verified: true,
    commandType: 'engine_cut',
    label: 'Couper huile et alimentation',
  },
  restore_engine: {
    code: 'S20',
    data: '0,0',
    sensitive: true,
    verified: true,
    commandType: 'engine_restore',
    label: 'Rétablir huile et alimentation',
  },

  // ---- alarme embarquée
  arm: {
    code: 'S10',
    data: '1',
    sensitive: false,
    verified: false,
    commandType: 'custom',
    label: "Armer l'alarme",
  },
  disarm: {
    code: 'S10',
    data: '0',
    sensitive: false,
    verified: false,
    commandType: 'custom',
    label: "Désarmer l'alarme",
  },

  // ---- sortie auxiliaire
  set_output: {
    code: 'S11',
    data: null,
    sensitive: true,
    verified: false,
    commandType: 'custom',
    label: 'Piloter une sortie',
  },

  // ---- configuration du boîtier
  set_admin_number: {
    code: 'A1',
    data: null,
    sensitive: true,
    verified: false,
    commandType: 'custom',
    label: 'Définir le numéro administrateur',
  },
  change_password: {
    code: 'B1',
    data: null,
    sensitive: true,
    verified: false,
    commandType: 'custom',
    label: 'Changer le mot de passe boîtier',
  },
  reset_password: {
    code: 'B2',
    data: null,
    sensitive: true,
    verified: false,
    commandType: 'custom',
    label: 'Réinitialiser le mot de passe',
  },
  set_apn: {
    code: 'C1',
    data: null,
    sensitive: true,
    verified: false,
    commandType: 'custom',
    label: "Configurer l'APN",
  },

  // ---- diagnostic
  request_status: {
    code: 'R1',
    data: '',
    sensitive: false,
    verified: false,
    commandType: 'locate',
    label: "Demander un rapport d'état",
  },
  reboot: {
    code: 'R2',
    data: '',
    sensitive: false,
    verified: false,
    commandType: 'reboot',
    label: 'Redémarrer le boîtier',
  },

  // ---- rythme de reporting
  start_tracking: {
    code: 'T1',
    data: '1',
    sensitive: false,
    verified: false,
    commandType: 'set_interval',
    label: 'Activer le suivi renforcé',
  },
  stop_tracking: {
    code: 'T1',
    data: '0',
    sensitive: false,
    verified: false,
    commandType: 'set_interval',
    label: 'Désactiver le suivi renforcé',
  },

  // ---- géofences embarquées
  add_geofence: {
    code: 'G1',
    data: null,
    sensitive: false,
    verified: false,
    commandType: 'custom',
    label: 'Ajouter une géofence embarquée',
  },
  remove_geofence: {
    code: 'G2',
    data: null,
    sensitive: false,
    verified: false,
    commandType: 'custom',
    label: 'Supprimer une géofence embarquée',
  },
}

/** Commande au format flespi. */
export interface FlespiCommand {
  name: string
  properties: Record<string, unknown>
}

export interface QueueOptions {
  /** Durée de vie en file, 60 à 2 592 000 s. */
  ttl?: number
  /** Nombre d'essais de remise (défaut flespi : 10). */
  maxAttempts?: number
  priority?: number
}

export interface SendResult {
  mode: 'queue' | 'instant'
  providerCommandId: string
  command: FlespiCommand
  /** Instantané : réponse du boîtier. File : null. */
  executed: boolean
  response: unknown
  expiresAt: Date | null
}

/**
 * Traduit une commande métier en commande flespi.
 * Lève une erreur si une charge utile variable est absente : envoyer
 * `set_apn` avec une chaîne vide rendrait le boîtier injoignable.
 */
export function buildBusinessCommand(
  command: FlespiCommandName,
  data?: string | null
): FlespiCommand {
  const def = FLESPI_COMMANDS[command]
  if (!def) throw new Error(`Commande inconnue : ${command}`)
  const charge = def.data ?? data
  if (charge === undefined || charge === null || (def.data === null && charge.trim() === '')) {
    throw new Error(`La commande ${command} exige un paramètre « data »`)
  }
  return { name: 'custom', properties: { command_code: def.code, data: charge } }
}

/**
 * Contrôle une commande contre le catalogue RÉEL du boîtier.
 * Retourne la liste des erreurs (vide = valide).
 */
export function checkAgainstCatalog(
  cmd: FlespiCommand,
  catalogue: FlespiCommandDefinition[]
): string[] {
  if (catalogue.length === 0) return [] // catalogue indisponible : flespi tranchera
  const def = catalogue.find((c) => c.name === cmd.name)
  if (!def) {
    return [
      `La commande « ${cmd.name} » n'existe pas pour ce type de boîtier. ` +
        `Disponibles : ${catalogue.map((c) => c.name).join(', ')}`,
    ]
  }
  return validateAgainstSchema(cmd.properties, def.schema)
}

export class HttpFlespiCommandGateway {
  constructor(private readonly client: FlespiClient) {}

  /** Mise en file : la commande part dès que le boîtier est connecté. */
  async queue(
    flespiDeviceId: number,
    cmd: FlespiCommand,
    opts: QueueOptions = {}
  ): Promise<SendResult> {
    const item: Record<string, unknown> = { name: cmd.name, properties: cmd.properties }
    if (opts.ttl !== undefined) item.ttl = Math.min(Math.max(opts.ttl, 60), 2_592_000)
    if (opts.maxAttempts !== undefined) item.max_attempts = opts.maxAttempts
    if (opts.priority !== undefined) item.priority = opts.priority

    const r = await this.client.first<FlespiQueuedCommand>(
      'POST',
      `/gw/devices/${flespiDeviceId}/commands-queue`,
      { body: [item] }
    )
    if (!r?.id) throw new Error("Flespi n'a pas retourné d'identifiant de commande")

    logger.info(
      { flespiDeviceId, name: cmd.name, id: r.id, expires: r.expires },
      '[flespi] commande en file'
    )
    return {
      mode: 'queue',
      providerCommandId: String(r.id),
      command: cmd,
      executed: Boolean(r.executed),
      response: r.response ?? null,
      expiresAt: r.expires ? new Date(r.expires * 1000) : null,
    }
  }

  /** Exécution immédiate : échoue si le boîtier n'est pas connecté. */
  async execute(flespiDeviceId: number, cmd: FlespiCommand, timeoutS = 30): Promise<SendResult> {
    const r = await this.client.first<FlespiCommandResult>(
      'POST',
      `/gw/devices/${flespiDeviceId}/commands`,
      {
        body: [
          {
            name: cmd.name,
            properties: cmd.properties,
            timeout: Math.min(Math.max(timeoutS, 5), 60),
          },
        ],
      }
    )
    if (!r) throw new Error("Flespi n'a pas retourné de résultat de commande")
    logger.info(
      { flespiDeviceId, name: cmd.name, id: r.id, executed: r.executed },
      '[flespi] commande exécutée'
    )
    return {
      mode: 'instant',
      providerCommandId: String(r.id),
      command: cmd,
      executed: Boolean(r.executed),
      response: r.response ?? null,
      expiresAt: null,
    }
  }

  /** Résultats des commandes exécutées (acquittées ou refusées par le boîtier). */
  async results(flespiDeviceId: number): Promise<FlespiCommandResult[]> {
    const env = await this.client.request<FlespiCommandResult>(
      'GET',
      `/gw/devices/${flespiDeviceId}/commands-result`
    )
    return env.result
  }

  /** Commandes encore en file chez flespi. */
  async pending(flespiDeviceId: number): Promise<FlespiQueuedCommand[]> {
    const env = await this.client.request<FlespiQueuedCommand>(
      'GET',
      `/gw/devices/${flespiDeviceId}/commands-queue/all`
    )
    return env.result
  }

  /** Retire une commande de la file (avant qu'elle ne parte). */
  async cancel(flespiDeviceId: number, providerCommandId: string): Promise<void> {
    await this.client.request(
      'DELETE',
      `/gw/devices/${flespiDeviceId}/commands-queue/${providerCommandId}`
    )
  }
}

/**
 * Adaptateur du port applicatif `DeviceCommandGateway` (contexte sécurité).
 *
 * Prêt pour le Jalon 3 : l'immobilisation validée appellera `sendEngineCut`,
 * qui met en file `custom { S20, "1,1" }` avec un TTL court — une coupure
 * moteur exécutée une heure après la décision n'a plus de sens.
 */
export class FlespiDeviceCommandGateway implements DeviceCommandGateway {
  constructor(
    private readonly gateway: HttpFlespiCommandGateway,
    private readonly ttlSeconds = 900
  ) {}

  async sendEngineCut(input: {
    deviceId: string
    externalDeviceId: string | null
    commandId: string
  }) {
    return this.envoyer(input.externalDeviceId, 'cut_engine')
  }

  async sendEngineRestore(input: {
    deviceId: string
    externalDeviceId: string | null
    commandId: string
  }) {
    return this.envoyer(input.externalDeviceId, 'restore_engine')
  }

  private async envoyer(externalDeviceId: string | null, commande: FlespiCommandName) {
    if (!externalDeviceId) throw new Error('Boîtier non rattaché à flespi : commande impossible')
    const r = await this.gateway.queue(Number(externalDeviceId), buildBusinessCommand(commande), {
      ttl: this.ttlSeconds,
      maxAttempts: 3,
      priority: 10,
    })
    return { providerCommandId: r.providerCommandId }
  }
}

/**
 * Passerelle factice : exerce toute la chaîne (API, habilitations, audit,
 * machine à états) sans jeton flespi ni boîtier réel.
 */
export class FakeFlespiCommandGateway {
  readonly sent: Array<{ deviceId: number; command: FlespiCommand; mode: 'queue' | 'instant' }> = []

  async queue(flespiDeviceId: number, cmd: FlespiCommand): Promise<SendResult> {
    this.sent.push({ deviceId: flespiDeviceId, command: cmd, mode: 'queue' })
    return {
      mode: 'queue',
      providerCommandId: `fake-${this.sent.length}`,
      command: cmd,
      executed: false,
      response: null,
      expiresAt: null,
    }
  }

  async execute(flespiDeviceId: number, cmd: FlespiCommand): Promise<SendResult> {
    this.sent.push({ deviceId: flespiDeviceId, command: cmd, mode: 'instant' })
    return {
      mode: 'instant',
      providerCommandId: `fake-${this.sent.length}`,
      command: cmd,
      executed: true,
      response: 'OK',
      expiresAt: null,
    }
  }
}
