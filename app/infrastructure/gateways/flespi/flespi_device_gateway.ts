import logger from '@adonisjs/core/services/logger'
import type { FlespiGatewayConfig } from '#infrastructure/gateways/flespi/flespi_command_gateway'
import { DeviceIdent } from '#domain/telemetry/value_objects'

/**
 * =========================================================================
 *  PROVISIONNEMENT FLESPI — cycle de vie des devices
 * =========================================================================
 *
 * Le CRUD de nos boîtiers doit rester synchronisé avec Flespi : un boîtier
 * créé chez nous mais absent de Flespi ne remontera jamais de position.
 *
 * ⚠ Convention Micodus : Flespi exige un `0` DEVANT l'IMEI dans le champ
 * `ident`. Notre base ne stocke que l'IMEI à 15 chiffres ; le préfixe est
 * ajouté ici, à la frontière. Sans cette normalisation, un même boîtier
 * existerait sous deux identités selon le point d'entrée.
 */

export interface FlespiDevice {
  id: number
  ident: string
  channelId: number
  deviceTypeId: string | number
}

export interface FlespiMessage {
  [cle: string]: unknown
}

export class FlespiDeviceGateway {
  constructor(private readonly config: FlespiGatewayConfig) {}

  /**
   * Préfixe Micodus.
   *
   * Délègue à `DeviceIdent` : c'est la SEULE règle de préfixage du projet.
   * En avoir deux — une conditionnée à la longueur ici, une inconditionnelle
   * dans l'objet-valeur — produisait `00352…` dès que la valeur portait déjà
   * le zéro.
   */
  static toFlespiIdent(imei: string): string {
    const ident = DeviceIdent.create(imei)
    return ident.ok ? ident.value.flespiIdent : imei
  }

  /**
   * Crée le device chez Flespi.
   * L'`id` retourné est à stocker dans `devices.flespi_device_id` : c'est lui,
   * et non l'IMEI, qui adresse les commandes.
   */
  async create(input: {
    imei: string
    channelId: number
    deviceTypeId: string | number
  }): Promise<FlespiDevice> {
    const json = await this.appel<{ result?: Array<Record<string, unknown>> }>(
      'POST',
      '/gw/devices',
      {
        channel_id: input.channelId,
        ident: FlespiDeviceGateway.toFlespiIdent(input.imei),
        device_type_id: input.deviceTypeId,
      }
    )

    const brut = json.result?.[0]
    if (!brut?.id) {
      throw new Error("Flespi n'a pas retourné d'identifiant de device")
    }

    const device: FlespiDevice = {
      id: Number(brut.id),
      ident: String(brut.ident ?? ''),
      channelId: Number(brut.channel_id ?? input.channelId),
      deviceTypeId: (brut.device_type_id as string | number) ?? input.deviceTypeId,
    }
    logger.info({ flespiDeviceId: device.id, imei: input.imei }, '[flespi] device créé')
    return device
  }

  /**
   * Suppression chez Flespi.
   *
   * Appelée AVANT la suppression logique côté SISBM : si Flespi échoue, on
   * n'a pas encore archivé le boîtier et l'opération reste rejouable. L'ordre
   * inverse laisserait un device orphelin chez Flespi, qui continuerait de
   * facturer et de publier sur le broker.
   */
  async delete(flespiDeviceId: number): Promise<void> {
    await this.appel('DELETE', `/gw/devices/${flespiDeviceId}`)
    logger.info({ flespiDeviceId }, '[flespi] device supprimé')
  }

  /** Dernier message connu — utile au diagnostic d'un boîtier muet. */
  async lastMessage(flespiDeviceId: number): Promise<FlespiMessage | null> {
    const json = await this.appel<{ result?: FlespiMessage[] }>(
      'GET',
      `/gw/devices/${flespiDeviceId}/messages?limit=1&reverse=true`
    )
    return json.result?.[0] ?? null
  }

  /**
   * Historique sur une fenêtre. Flespi horodate en SECONDES.
   *
   * À réserver au diagnostic et au rattrapage : la source de vérité pour
   * l'historique reste notre table `positions`, pas Flespi.
   */
  async messages(input: {
    flespiDeviceId: number
    from: Date
    to: Date
    limit?: number
  }): Promise<FlespiMessage[]> {
    const from = Math.floor(input.from.getTime() / 1000)
    const to = Math.floor(input.to.getTime() / 1000)
    const limit = Math.min(input.limit ?? 1000, 10_000)
    const json = await this.appel<{ result?: FlespiMessage[] }>(
      'GET',
      `/gw/devices/${input.flespiDeviceId}/messages?from=${from}&to=${to}&limit=${limit}`
    )
    return json.result ?? []
  }

  /** Vérifie la validité du jeton et l'accès au canal — à lancer au démarrage. */
  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.appel('GET', '/gw/channels/all?fields=id')
      return { ok: true }
    } catch (err) {
      return { ok: false, detail: (err as Error).message }
    }
  }

  // -------------------------------------------------------------------------

  private async appel<T = unknown>(
    methode: 'GET' | 'POST' | 'DELETE',
    chemin: string,
    corps?: unknown
  ): Promise<T> {
    const reponse = await fetch(`${this.config.baseUrl}${chemin}`, {
      method: methode,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `FlespiToken ${this.config.token}`,
      },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    if (!reponse.ok) {
      const detail = await reponse.text().catch(() => '')
      logger.error({ methode, chemin, status: reponse.status, detail }, '[flespi] appel en échec')
      throw new Error(`Flespi ${methode} ${chemin} → HTTP ${reponse.status}`)
    }
    return (await reponse.json().catch(() => ({}))) as T
  }
}
