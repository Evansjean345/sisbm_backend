import logger from '@adonisjs/core/services/logger'
import type { FlespiClient } from '#infrastructure/gateways/flespi/flespi_client'
import type {
  FlespiChannel,
  FlespiLog,
  FlespiMessage,
} from '#infrastructure/gateways/flespi/flespi_types'

/**
 * =========================================================================
 *  PASSERELLE CANAUX FLESPI
 * =========================================================================
 *
 * Un canal est le point d'entrée réseau : un couple `hôte:port` dédié à UN
 * protocole (ex. `ch1442013.flespi.gw:39142` pour micodus). Un seul canal
 * suffit pour toute la flotte MV730 : on ne crée pas un canal par boîtier.
 *
 * Contrats vérifiés sur l'API réelle :
 *   POST   /gw/channels                  corps : TABLEAU [{ name, protocol_name | protocol_id, … }]
 *   GET    /gw/channels/{id}             → { result: [canal] }
 *   PUT    /gw/channels/{id}             corps : OBJET { name?, enabled?, messages_ttl?, … }
 *   DELETE /gw/channels/{id}
 *   GET    /gw/channels/{id}/logs        paramètres dans ?data=
 *   GET    /gw/channels/{id}/messages    → { result: [...], next_key }  (tampon du canal)
 *   GET    /gw/channels/{id}/connections/all  → connexions TCP actives
 */

export interface CreateChannelInput {
  name: string
  /** `micodus` pour les MV730. Ignoré si `protocolId` est fourni. */
  protocolName?: string
  protocolId?: number
  /** Durée de conservation du tampon canal, en secondes (défaut flespi : 86400). */
  messagesTtl?: number
  enabled?: boolean
  configuration?: Record<string, unknown> | null
}

export interface UpdateChannelInput {
  name?: string
  enabled?: boolean
  messagesTtl?: number
  configuration?: Record<string, unknown> | null
}

export interface LogQuery {
  /** Horodatages en SECONDES (flespi). */
  from?: number
  to?: number
  count?: number
  reverse?: boolean
  /** Expression flespi, ex. `event_code=301` */
  filter?: string
}

export interface ChannelMessagesQuery {
  /** Curseur renvoyé par l'appel précédent (`next_key`). 0 = début du tampon. */
  currKey?: number
  limitCount?: number
  limitSize?: number
}

export interface ChannelConnection {
  id?: number
  ident?: string
  source?: string
  established?: number
  [cle: string]: unknown
}

export class FlespiChannelGateway {
  constructor(private readonly client: FlespiClient) {}

  async list(): Promise<FlespiChannel[]> {
    const env = await this.client.request<FlespiChannel>('GET', '/gw/channels/all')
    return env.result
  }

  async get(channelId: number): Promise<FlespiChannel | null> {
    return this.client.item<FlespiChannel>(`/gw/channels/${channelId}`)
  }

  async create(input: CreateChannelInput): Promise<FlespiChannel> {
    const item: Record<string, unknown> = { name: input.name }
    if (input.protocolId) item.protocol_id = input.protocolId
    else if (input.protocolName) item.protocol_name = input.protocolName
    else throw new Error('protocolName ou protocolId requis pour créer un canal')
    if (input.messagesTtl !== undefined) item.messages_ttl = input.messagesTtl
    if (input.enabled !== undefined) item.enabled = input.enabled
    if (input.configuration !== undefined) item.configuration = input.configuration

    // flespi attend un TABLEAU d'éléments à créer.
    const canal = await this.client.first<FlespiChannel>('POST', '/gw/channels', { body: [item] })
    if (!canal?.id) throw new Error("Flespi n'a pas retourné le canal créé")
    logger.info({ channelId: canal.id, uri: canal.uri }, '[flespi] canal créé')
    return canal
  }

  async update(channelId: number, input: UpdateChannelInput): Promise<FlespiChannel> {
    const corps: Record<string, unknown> = {}
    if (input.name !== undefined) corps.name = input.name
    if (input.enabled !== undefined) corps.enabled = input.enabled
    if (input.messagesTtl !== undefined) corps.messages_ttl = input.messagesTtl
    if (input.configuration !== undefined) corps.configuration = input.configuration

    const canal = await this.client.first<FlespiChannel>('PUT', `/gw/channels/${channelId}`, {
      body: corps,
    })
    if (!canal) throw new Error(`Canal ${channelId} introuvable chez flespi`)
    return canal
  }

  async delete(channelId: number): Promise<void> {
    await this.client.request('DELETE', `/gw/channels/${channelId}`)
    logger.info({ channelId }, '[flespi] canal supprimé')
  }

  /** Journal du canal : création, modifications, connexions / déconnexions de boîtiers. */
  async logs(channelId: number, q: LogQuery = {}): Promise<FlespiLog[]> {
    const env = await this.client.request<FlespiLog>('GET', `/gw/channels/${channelId}/logs`, {
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

  /**
   * Tampon du canal : TOUS les messages reçus, y compris ceux de boîtiers
   * qui ne sont encore enregistrés comme device nulle part. C'est l'outil de
   * diagnostic n°1 : si un MV730 émet ici mais pas dans son device, c'est
   * l'`ident` ou le type de boîtier qui est faux.
   */
  async messages(
    channelId: number,
    q: ChannelMessagesQuery = {}
  ): Promise<{ messages: FlespiMessage[]; nextKey: number | null }> {
    const env = await this.client.request<FlespiMessage>(
      'GET',
      `/gw/channels/${channelId}/messages`,
      {
        data: nettoyer({
          curr_key: q.currKey ?? 0,
          limit_count: Math.min(q.limitCount ?? 100, 1000),
          limit_size: q.limitSize,
        }),
      }
    )
    return { messages: env.result, nextKey: env.next_key ?? null }
  }

  /** Connexions TCP actuellement ouvertes sur le canal (ident, IP source, date). */
  async connections(channelId: number): Promise<ChannelConnection[]> {
    const env = await this.client.request<ChannelConnection>(
      'GET',
      `/gw/channels/${channelId}/connections/all`
    )
    return env.result
  }

  /**
   * Identifiants vus sur le canal — connexions actives + tampon de messages.
   *
   * Répond à LA question d'une première mise en service : « quel `ident` mon
   * boîtier envoie-t-il réellement ? ». Pour les Micodus, flespi attend l'ID
   * du boîtier (et non l'IMEI) préfixé d'un `0` : lire l'ident ici évite de
   * le deviner.
   */
  async seenIdents(
    channelId: number
  ): Promise<Array<{ ident: string; lastSeen: number | null; source: string }>> {
    const vus = new Map<string, { ident: string; lastSeen: number | null; source: string }>()

    const [connexions, tampon] = await Promise.allSettled([
      this.connections(channelId),
      this.messages(channelId, { currKey: 0, limitCount: 1000 }),
    ])

    if (tampon.status === 'fulfilled') {
      for (const m of tampon.value.messages) {
        if (!m.ident) continue
        const ts = typeof m.timestamp === 'number' ? m.timestamp : null
        const prec = vus.get(m.ident)
        if (!prec || (ts ?? 0) > (prec.lastSeen ?? 0)) {
          vus.set(m.ident, { ident: m.ident, lastSeen: ts, source: 'messages' })
        }
      }
    }
    if (connexions.status === 'fulfilled') {
      for (const c of connexions.value) {
        if (!c.ident) continue
        vus.set(c.ident, {
          ident: c.ident,
          lastSeen: typeof c.established === 'number' ? c.established : null,
          source: 'connection',
        })
      }
    }
    return [...vus.values()].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
  }
}

/** Retire les clés `undefined` : flespi rejette les paramètres inconnus ou nuls. */
export function nettoyer(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null))
}
