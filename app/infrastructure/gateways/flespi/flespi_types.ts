/**
 * =========================================================================
 *  TYPES FLESPI — calqués sur les réponses RÉELLES de l'API
 * =========================================================================
 *
 * Chaque interface reprend les champs observés lors des tests de
 * `02infrastructure.md` (canal 1442013, device 8958982). Les champs marqués
 * `?` ne sont pas toujours présents selon le protocole ou la requête `fields`.
 */

/** POST/GET /gw/channels → result[] */
export interface FlespiChannel {
  id: number
  cid: number
  name: string
  enabled: boolean
  protocol_id: number
  protocol_name?: string
  /** Durée de vie des messages dans le tampon du canal, en secondes. */
  messages_ttl: number
  configuration: Record<string, unknown> | null
  /** Adresse à programmer dans le boîtier, ex. `ch1442013.flespi.gw:39142` */
  uri: string
  secondary_uri: string
}

/** POST/GET /gw/devices → result[] */
export interface FlespiDevice {
  id: number
  cid: number
  name: string
  enabled: boolean
  device_type_id: number
  /** Déduit du type : un device ne reçoit QUE les messages des canaux de ce protocole. */
  protocol_id: number
  messages_ttl: number
  messages_rotate: number
  media_ttl: number
  media_rotate: number
  configuration: {
    ident: string
    phone?: string
    settings_polling?: 'never' | 'once' | 'daily' | 'weekly' | 'monthly'
    [cle: string]: unknown
  }
  /** Disponible via `?fields=...,connected` */
  connected?: boolean
  last_active?: number
  commands?: FlespiCommandDefinition[]
}

/** GET /gw/{channels|devices}/{id}/logs → result[] */
export interface FlespiLog {
  event_code: number
  event_origin?: string
  origin_id: number
  origin_type: number
  timestamp: number
  host?: string
  token_id?: number
  trace?: string
  http_data?: Record<string, unknown>
  new?: Record<string, unknown> | null
  old?: Record<string, unknown> | null
  /** Journaux de connexion : ident, source, raison de déconnexion, etc. */
  ident?: string
  source?: string
  reason?: string
  [cle: string]: unknown
}

/** Message normalisé flespi (clés pointées à plat). */
export interface FlespiMessage {
  'ident'?: string
  'timestamp'?: number
  'server.timestamp'?: number
  'device.id'?: number
  'device.name'?: string
  'device.type.id'?: number
  'channel.id'?: number
  'protocol.id'?: number
  'peer'?: string
  [cle: string]: unknown
}

/** POST /gw/devices/{id}/commands-queue → result[] */
export interface FlespiQueuedCommand {
  id: number
  command_id?: number
  device_id: number
  name: string
  properties: Record<string, unknown>
  timestamp: number
  expires: number
  executed: boolean
  max_attempts: number
  priority: number
  condition: string
  response: unknown
  meta: unknown
}

/** GET /gw/devices/{id}/commands-result et POST /commands (instantané) → result[] */
export interface FlespiCommandResult {
  id: number
  device_id: number
  name: string
  properties?: Record<string, unknown>
  timestamp: number
  executed: boolean
  response?: unknown
  reason?: string
  [cle: string]: unknown
}

/** Élément de `GET /gw/devices/{id}?fields=commands` */
export interface FlespiCommandDefinition {
  name: string
  /** Canaux d'acheminement possibles : `connection` (GPRS) et/ou `sms` */
  address?: Array<'connection' | 'sms' | string>
  schema: JsonSchema
  examples?: Array<{ description?: string; properties: Record<string, unknown> }>
  tab?: string
  tags?: Record<string, unknown>
}

/** GET /gw/channel-protocols → result[] */
export interface FlespiProtocol {
  id: number
  name: string
  title?: string
  transport?: string
}

/** GET /gw/channel-protocols/{id}/device-types → result[] */
export interface FlespiDeviceType {
  id: number
  name: string
  title: string
  protocol_id?: number
  configuration?: JsonSchema
  commands?: FlespiCommandDefinition[]
  settings?: unknown[]
}

/** Sous-ensemble JSON-Schema utilisé par flespi pour décrire commandes et configurations. */
export interface JsonSchema {
  'type'?: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array'
  'title'?: string
  'description'?: string
  'properties'?: Record<string, JsonSchema>
  'required'?: string[]
  'additionalProperties'?: boolean
  'enum'?: unknown[]
  'const'?: unknown
  'default'?: unknown
  'minimum'?: number
  'maximum'?: number
  'minLength'?: number
  'maxLength'?: number
  'pattern'?: string
  'anyOf'?: JsonSchema[]
  'readOnly'?: boolean
  'x-key-property'?: string
  [cle: string]: unknown
}
