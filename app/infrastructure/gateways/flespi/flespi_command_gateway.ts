import logger from '@adonisjs/core/services/logger'

/**
 * =========================================================================
 *  PASSERELLE DE COMMANDES FLESPI — Micodus MV730
 * =========================================================================
 *
 * SEUL endroit du projet qui connaît les codes constructeur. Le domaine parle
 * de « couper le moteur », jamais de « S20 1,1 ».
 *
 * Table établie d'après la documentation Flespi/Micodus rassemblée par SISBM
 * (Jalon 2, section IV). Ces codes ne sont PAS devinables : `request_status`
 * est `R1` et non `S71`, `reboot` est `R2` et non `S02`. Toute modification
 * doit être adossée à la documentation, jamais à une déduction.
 *
 * ⚠ Les codes `G1` / `G2` (géofences embarquées) sont donnés « à adapter selon
 * la doc exacte » dans la source. À valider sur boîtier réel en Phase 2 avant
 * tout usage en production. Le géorepérage de la plateforme est de toute façon
 * calculé côté serveur avec PostGIS et ne dépend pas de ces commandes.
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

interface Definition {
  code: string
  /** Charge utile fixe, ou `null` si elle dépend des paramètres. */
  data: string | null
  /** Une commande sensible exige une habilitation dédiée et un motif tracé. */
  sensitive: boolean
  label: string
}

export const FLESPI_COMMANDS: Record<FlespiCommandName, Definition> = {
  // ---- contrôle moteur / carburant
  cut_engine: { code: 'S20', data: '1,1', sensitive: true, label: 'Couper huile et alimentation' },
  restore_engine: {
    code: 'S20',
    data: '0,0',
    sensitive: true,
    label: 'Rétablir huile et alimentation',
  },

  // ---- alarme embarquée
  arm: { code: 'S10', data: '1', sensitive: false, label: "Armer l'alarme" },
  disarm: { code: 'S10', data: '0', sensitive: false, label: "Désarmer l'alarme" },

  // ---- sortie auxiliaire (sirène, buzzer, relais additionnel)
  set_output: { code: 'S11', data: null, sensitive: true, label: 'Piloter une sortie' },

  // ---- configuration du boîtier
  set_admin_number: {
    code: 'A1',
    data: null,
    sensitive: true,
    label: 'Définir le numéro administrateur',
  },
  change_password: {
    code: 'B1',
    data: null,
    sensitive: true,
    label: 'Changer le mot de passe boîtier',
  },
  reset_password: {
    code: 'B2',
    data: null,
    sensitive: true,
    label: 'Réinitialiser le mot de passe',
  },
  set_apn: { code: 'C1', data: null, sensitive: true, label: "Configurer l'APN" },

  // ---- diagnostic
  request_status: { code: 'R1', data: '', sensitive: false, label: "Demander un rapport d'état" },
  reboot: { code: 'R2', data: '', sensitive: false, label: 'Redémarrer le boîtier' },

  // ---- rythme de reporting
  start_tracking: { code: 'T1', data: '1', sensitive: false, label: 'Activer le suivi renforcé' },
  stop_tracking: { code: 'T1', data: '0', sensitive: false, label: 'Désactiver le suivi renforcé' },

  // ---- géofences embarquées (à valider sur boîtier réel)
  add_geofence: {
    code: 'G1',
    data: null,
    sensitive: false,
    label: 'Ajouter une géofence embarquée',
  },
  remove_geofence: {
    code: 'G2',
    data: null,
    sensitive: false,
    label: 'Supprimer une géofence embarquée',
  },
}

export interface FlespiGatewayConfig {
  token: string
  baseUrl: string
  timeoutMs: number
}

export interface CommandResult {
  providerCommandId: string
  commandCode: string
  data: string
}

/** Port de sortie vers la passerelle télématique. */
export interface FlespiCommandGateway {
  send(flespiDeviceId: number, command: FlespiCommandName, data?: string): Promise<CommandResult>
}

export class HttpFlespiCommandGateway implements FlespiCommandGateway {
  constructor(private readonly config: FlespiGatewayConfig) {}

  async send(
    flespiDeviceId: number,
    command: FlespiCommandName,
    data?: string
  ): Promise<CommandResult> {
    const def = FLESPI_COMMANDS[command]
    if (!def) throw new Error(`Commande inconnue : ${command}`)

    /**
     * Une commande à charge utile variable ne part jamais sans paramètre :
     * envoyer `set_apn` avec une chaîne vide reconfigurerait le boîtier avec
     * un APN nul et le rendrait injoignable — irrécupérable à distance.
     */
    const charge = def.data ?? data
    if (charge === undefined || charge === null) {
      throw new Error(`La commande ${command} exige un paramètre « data »`)
    }

    const url = `${this.config.baseUrl}/gw/devices/${flespiDeviceId}/commands`
    const reponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `FlespiToken ${this.config.token}`,
      },
      body: JSON.stringify({ command_code: def.code, data: charge }),
      // Délai borné : un appel bloqué retiendrait une transaction ouverte.
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    if (!reponse.ok) {
      const detail = await reponse.text().catch(() => '')
      logger.error(
        { flespiDeviceId, command, code: def.code, status: reponse.status, detail },
        '[flespi] commande refusée'
      )
      throw new Error(`Flespi a refusé « ${def.label} » (HTTP ${reponse.status})`)
    }

    const json = (await reponse.json().catch(() => ({}))) as { result?: Array<{ id?: number }> }
    const providerCommandId = String(json.result?.[0]?.id ?? `${def.code}-${Date.now()}`)

    logger.info(
      { flespiDeviceId, command, code: def.code, providerCommandId },
      '[flespi] commande transmise'
    )
    return { providerCommandId, commandCode: def.code, data: charge }
  }
}

/**
 * Passerelle factice.
 *
 * Permet d'exercer toute la chaîne — API, habilitations, journal d'audit,
 * machine à états des commandes — sans jeton Flespi ni boîtier réel.
 */
export class FakeFlespiCommandGateway implements FlespiCommandGateway {
  readonly sent: Array<{ deviceId: number; command: string; code: string; data: string }> = []

  async send(
    flespiDeviceId: number,
    command: FlespiCommandName,
    data?: string
  ): Promise<CommandResult> {
    const def = FLESPI_COMMANDS[command]
    const charge = def.data ?? data ?? ''
    this.sent.push({ deviceId: flespiDeviceId, command, code: def.code, data: charge })
    return {
      providerCommandId: `fake-${def.code}-${this.sent.length}`,
      commandCode: def.code,
      data: charge,
    }
  }
}
