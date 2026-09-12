import logger from '@adonisjs/core/services/logger'
import type { FlespiClient } from '#infrastructure/gateways/flespi/flespi_client'
import { nettoyer, type LogQuery } from '#infrastructure/gateways/flespi/flespi_channel_gateway'
import type {
  FlespiCommandDefinition,
  FlespiDevice,
  FlespiLog,
  FlespiMessage,
} from '#infrastructure/gateways/flespi/flespi_types'

/**
 * =========================================================================
 *  PASSERELLE DEVICES FLESPI — cycle de vie des boîtiers
 * =========================================================================
 *
 * Corrections par rapport à la version précédente (vérifiées sur l'API) :
 *
 *  ✗ AVANT  POST /gw/devices  { channel_id, ident, device_type_id: "Micodus MV730" }
 *  ✓ APRÈS  POST /gw/devices  [ { name, device_type_id: <number>,
 *                                 configuration: { ident, phone?, settings_polling? } } ]
 *
 *    - le corps est un TABLEAU ;
 *    - `ident` vit dans `configuration`, pas à la racine ;
 *    - `device_type_id` est NUMÉRIQUE (le libellé est résolu par
 *      FlespiProtocolGateway) ;
 *    - il n'existe PAS de `channel_id` sur un device : le rattachement se fait
 *      par le protocole du type + l'ident.
 *
 *  ✗ AVANT  GET /messages?limit=1&reverse=true   (paramètres ignorés par flespi)
 *  ✓ APRÈS  GET /messages?data={"count":1,"reverse":true}
 */

export interface CreateDeviceInput {
  name: string
  deviceTypeId: number
  ident: string
  /** Numéro de la SIM (format +225…) ou ICCID — requis pour les commandes par SMS. */
  phone?: string | null
  messagesTtl?: number
  settingsPolling?: 'never' | 'once' | 'daily' | 'weekly' | 'monthly'
  enabled?: boolean
}

export interface UpdateDeviceInput {
  name?: string
  enabled?: boolean
  ident?: string
  phone?: string | null
  settingsPolling?: 'never' | 'once' | 'daily' | 'weekly' | 'monthly'
  messagesTtl?: number
}

export interface DeviceMessagesQuery {
  /** Horodatages en SECONDES. */
  from?: number
  to?: number
  count?: number
  reverse?: boolean
  fields?: string
  filter?: string
}

export interface TelemetryValue {
  value: unknown
  ts: number
}

export class FlespiDeviceGateway {
  constructor(private readonly client: FlespiClient) {}

  async create(input: CreateDeviceInput): Promise<FlespiDevice> {
    const configuration: Record<string, unknown> = { ident: input.ident }
    if (input.phone) configuration.phone = input.phone
    if (input.settingsPolling) configuration.settings_polling = input.settingsPolling

    const item: Record<string, unknown> = {
      name: input.name,
      device_type_id: input.deviceTypeId,
      configuration,
    }
    if (input.messagesTtl !== undefined) item.messages_ttl = input.messagesTtl
    if (input.enabled !== undefined) item.enabled = input.enabled

    const device = await this.client.first<FlespiDevice>('POST', '/gw/devices', { body: [item] })
    if (!device?.id) throw new Error("Flespi n'a pas retourné d'identifiant de device")

    logger.info(
      {
        flespiDeviceId: device.id,
        ident: device.configuration?.ident,
        protocolId: device.protocol_id,
      },
      '[flespi] device créé'
    )
    return device
  }

  async get(flespiDeviceId: number, fields?: string[]): Promise<FlespiDevice | null> {
    return this.client.item<FlespiDevice>(`/gw/devices/${flespiDeviceId}`, { fields })
  }

  async list(opts: { limit?: number; offset?: number } = {}): Promise<FlespiDevice[]> {
    const env = await this.client.request<FlespiDevice>('GET', '/gw/devices/all', {
      limit: opts.limit,
      offset: opts.offset,
    })
    return env.result
  }

  /** Recherche par ident — évite de créer un doublon, permet de rattacher un device existant. */
  async findByIdent(ident: string): Promise<FlespiDevice | null> {
    const selecteur = encodeURIComponent(`configuration.ident="${ident.replace(/"/g, '')}"`)
    return this.client.first<FlespiDevice>('GET', `/gw/devices/${selecteur}`)
  }

  /**
   * Mise à jour partielle. `configuration` est FUSIONNÉE avec l'existante :
   * envoyer `{ phone }` seul écraserait l'ident et déconnecterait le boîtier.
   */
  async update(flespiDeviceId: number, input: UpdateDeviceInput): Promise<FlespiDevice> {
    const corps: Record<string, unknown> = {}
    if (input.name !== undefined) corps.name = input.name
    if (input.enabled !== undefined) corps.enabled = input.enabled
    if (input.messagesTtl !== undefined) corps.messages_ttl = input.messagesTtl

    if (input.ident !== undefined || input.phone !== undefined || input.settingsPolling) {
      const actuel = await this.get(flespiDeviceId, ['configuration'])
      if (!actuel) throw new Error(`Device flespi ${flespiDeviceId} introuvable`)
      const configuration: Record<string, unknown> = { ...(actuel.configuration ?? {}) }
      if (input.ident !== undefined) configuration.ident = input.ident
      if (input.phone !== undefined) {
        if (input.phone) configuration.phone = input.phone
        else delete configuration.phone
      }
      if (input.settingsPolling) configuration.settings_polling = input.settingsPolling
      corps.configuration = configuration
    }

    const device = await this.client.first<FlespiDevice>('PUT', `/gw/devices/${flespiDeviceId}`, {
      body: corps,
    })
    if (!device) throw new Error(`Device flespi ${flespiDeviceId} introuvable`)
    return device
  }

  /**
   * Suppression chez flespi.
   *
   * Appelée AVANT l'archivage côté SISBM : si flespi échoue, l'opération
   * reste rejouable. L'ordre inverse laisserait un device orphelin qui
   * continuerait de consommer le quota et de publier sur le broker.
   */
  async delete(flespiDeviceId: number): Promise<void> {
    await this.client.request('DELETE', `/gw/devices/${flespiDeviceId}`)
    logger.info({ flespiDeviceId }, '[flespi] device supprimé')
  }

  /** Journal du device : création, modification, connexions, erreurs de décodage. */
  async logs(flespiDeviceId: number, q: LogQuery = {}): Promise<FlespiLog[]> {
    const env = await this.client.request<FlespiLog>('GET', `/gw/devices/${flespiDeviceId}/logs`, {
      data: nettoyer({
        from: q.from,
        to: q.to,
        count: q.count ?? 100,
        reverse: q.reverse ?? true,
        filter: q.filter,
      }),
    })
    return env.result
  }

  /** Dernier message connu — diagnostic d'un boîtier muet. */
  async lastMessage(flespiDeviceId: number): Promise<FlespiMessage | null> {
    const env = await this.client.request<FlespiMessage>(
      'GET',
      `/gw/devices/${flespiDeviceId}/messages`,
      { data: { count: 1, reverse: true } }
    )
    return env.result[0] ?? null
  }

  /**
   * Historique sur une fenêtre. flespi horodate en SECONDES.
   * Réservé au diagnostic et au rattrapage : la source de vérité reste `positions`.
   */
  async messages(flespiDeviceId: number, q: DeviceMessagesQuery = {}): Promise<FlespiMessage[]> {
    const env = await this.client.request<FlespiMessage>(
      'GET',
      `/gw/devices/${flespiDeviceId}/messages`,
      {
        data: nettoyer({
          from: q.from,
          to: q.to,
          count: Math.min(q.count ?? 1000, 10_000),
          reverse: q.reverse,
          fields: q.fields,
          filter: q.filter,
        }),
      }
    )
    return env.result
  }

  /** Dernière valeur connue de chaque paramètre (position, batterie, ignition…). */
  async telemetry(flespiDeviceId: number): Promise<Record<string, TelemetryValue>> {
    const r = await this.client.first<{ id: number; telemetry: Record<string, TelemetryValue> }>(
      'GET',
      `/gw/devices/${flespiDeviceId}/telemetry/all`
    )
    return r?.telemetry ?? {}
  }

  /** Catalogue des commandes EXACT de ce boîtier, tel que flespi le connaît. */
  async commandsCatalog(flespiDeviceId: number): Promise<FlespiCommandDefinition[]> {
    const d = await this.get(flespiDeviceId, ['commands'])
    return d?.commands ?? []
  }

  /** Vérifie le jeton et l'accès à l'API — à lancer au démarrage. */
  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.client.request('GET', '/gw/channels/all', { fields: ['id'] })
      return { ok: true }
    } catch (err) {
      return { ok: false, detail: (err as Error).message }
    }
  }
}
