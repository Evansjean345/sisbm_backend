import logger from '@adonisjs/core/services/logger'
import type { FlespiChannelGateway } from '#infrastructure/gateways/flespi/flespi_channel_gateway'
import type { FlespiDeviceGateway } from '#infrastructure/gateways/flespi/flespi_device_gateway'
import type { FlespiProtocolGateway } from '#infrastructure/gateways/flespi/flespi_protocol_gateway'
import type { FlespiDevice } from '#infrastructure/gateways/flespi/flespi_types'
import {
  buildFlespiIdent,
  checkIdentAgainstSchema,
} from '#infrastructure/gateways/flespi/flespi_ident'

/**
 * =========================================================================
 *  PROVISIONNEMENT D'UN BOÎTIER CHEZ FLESPI — avec garde-fous
 * =========================================================================
 *
 * Enchaîne les contrôles qui auraient évité chacun des défauts constatés :
 *
 *   1. le canal existe                         → sinon 422, rien n'est créé
 *   2. le type de boîtier appartient AU PROTOCOLE DU CANAL
 *        (Concox AT6 / proto 13 sur un canal micodus / proto 325 : refusé)
 *   3. l'ident suit la règle du protocole      (micodus : « 0 » + ID boîtier)
 *   4. l'ident respecte le schéma du type      (motif publié par flespi)
 *   5. aucun device flespi ne porte déjà cet ident (sinon : rattachement
 *      explicite via `linkExisting`, ou 409)
 *   6. création
 */

export class ProvisioningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

export interface ProvisionInput {
  imei: string
  model: string
  channelId: number
  deviceType: string | number
  name?: string
  terminalId?: string | null
  flespiIdent?: string | null
  phone?: string | null
  messagesTtl?: number
  linkExisting?: boolean
}

export interface ProvisionResult {
  device: FlespiDevice
  ident: string
  protocolName: string
  deviceTypeTitle: string
  /** `true` si le device a été créé par cet appel (à compenser en cas d'échec aval). */
  created: boolean
}

export class FlespiProvisioning {
  constructor(
    private readonly channels: FlespiChannelGateway,
    private readonly devices: FlespiDeviceGateway,
    private readonly protocols: FlespiProtocolGateway
  ) {}

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    // ---- 1. canal
    if (!input.channelId) {
      throw new ProvisioningError(
        'E_FLESPI_NO_CHANNEL',
        'Aucun canal flespi : renseigner flespiChannelId ou FLESPI_CHANNEL_ID',
        422
      )
    }
    const canal = await this.channels.get(input.channelId)
    if (!canal) {
      throw new ProvisioningError(
        'E_FLESPI_CHANNEL_NOT_FOUND',
        `Canal flespi ${input.channelId} introuvable`,
        422
      )
    }
    const protocole = await this.protocols.protocol(canal.protocol_id)
    const nomProtocole = protocole?.name ?? canal.protocol_name ?? String(canal.protocol_id)

    // ---- 2. type de boîtier dans le protocole du canal
    const type = await this.protocols.resolveDeviceType(canal.protocol_id, input.deviceType)
    if (!type) {
      const types = await this.protocols.deviceTypes(canal.protocol_id)
      const disponibles = types
        .slice(0, 50)
        .map((t) => ({ id: t.id, name: t.name, title: t.title }))
      throw new ProvisioningError(
        'E_FLESPI_DEVICE_TYPE_MISMATCH',
        `Le type « ${input.deviceType} » n'appartient pas au protocole ${nomProtocole} du canal ` +
          `${canal.id}. Un device d'un autre protocole ne recevrait JAMAIS les messages de ce canal.`,
        422,
        {
          channelProtocolId: canal.protocol_id,
          channelProtocol: nomProtocole,
          available: disponibles,
        }
      )
    }

    // ---- 3. ident selon le protocole
    // Lève une FlespiIdentError (→ 422 E_FLESPI_IDENT) si l'ID Micodus manque.
    const ident = buildFlespiIdent(nomProtocole, {
      imei: input.imei,
      terminalId: input.terminalId,
      flespiIdent: input.flespiIdent,
    })

    // ---- 4. ident conforme au schéma du type
    const fiche = await this.protocols.deviceType(canal.protocol_id, type.id).catch(() => null)
    const ecart = checkIdentAgainstSchema(ident, fiche?.configuration)
    if (ecart) {
      throw new ProvisioningError(
        'E_FLESPI_IDENT_INVALID',
        `Ident refusé par le type ${type.title} : ${ecart}`,
        422,
        {
          ident,
          deviceType: type.title,
        }
      )
    }

    // ---- 5. doublon
    const existant = await this.devices.findByIdent(ident)
    if (existant) {
      if (existant.device_type_id !== type.id) {
        throw new ProvisioningError(
          'E_FLESPI_IDENT_WRONG_TYPE',
          `Un device flespi (${existant.id}) porte déjà l'ident ${ident} avec le type ` +
            `${existant.device_type_id} au lieu de ${type.id} (${type.title}). Le corriger ou le ` +
            'supprimer chez flespi avant de relancer.',
          409,
          {
            flespiDeviceId: existant.id,
            currentDeviceTypeId: existant.device_type_id,
            expectedDeviceTypeId: type.id,
          }
        )
      }
      if (!input.linkExisting) {
        throw new ProvisioningError(
          'E_FLESPI_IDENT_EXISTS',
          `Un device flespi (${existant.id}) porte déjà l'ident ${ident}. Relancer avec linkExisting=true pour le rattacher.`,
          409,
          { flespiDeviceId: existant.id }
        )
      }
      logger.info({ flespiDeviceId: existant.id, ident }, '[flespi] device existant rattaché')
      return {
        device: existant,
        ident,
        protocolName: nomProtocole,
        deviceTypeTitle: type.title,
        created: false,
      }
    }

    // ---- 6. création
    const device = await this.devices.create({
      name: input.name ?? `${input.model} ${input.imei}`,
      deviceTypeId: type.id,
      ident,
      // Schéma flespi : +9 à 15 chiffres, ou ICCID de 19-20 chiffres.
      phone: input.phone && /^(\+\d{9,15}|\d{19,20})$/.test(input.phone) ? input.phone : undefined,
      messagesTtl: input.messagesTtl,
      settingsPolling: 'once',
    })
    return { device, ident, protocolName: nomProtocole, deviceTypeTitle: type.title, created: true }
  }

  /** Compensation : supprime un device créé si l'écriture SISBM a échoué ensuite. */
  async rollback(result: ProvisionResult): Promise<void> {
    if (!result.created) return
    try {
      await this.devices.delete(result.device.id)
    } catch (err) {
      logger.error(
        { err, flespiDeviceId: result.device.id },
        '[flespi] compensation impossible : device orphelin à supprimer manuellement'
      )
    }
  }
}
