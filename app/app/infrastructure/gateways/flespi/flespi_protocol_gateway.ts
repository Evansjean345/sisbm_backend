import { FlespiApiError, type FlespiClient } from '#infrastructure/gateways/flespi/flespi_client'
import type { FlespiDeviceType, FlespiProtocol } from '#infrastructure/gateways/flespi/flespi_types'

/**
 * =========================================================================
 *  CATALOGUE DES PROTOCOLES ET TYPES DE BOÎTIERS
 * =========================================================================
 *
 * Règle flespi fondamentale — et cause n°1 des « boîtiers muets » :
 *
 *   Un device ne reçoit QUE les messages des canaux dont le protocole est
 *   celui de son `device_type_id`. Le lien canal ↔ device ne se fait PAS par
 *   un `channel_id`, mais par le couple (protocole, ident).
 *
 * Exemple vécu (tests du 02infrastructure.md) :
 *   canal `sisbm_channel`   → protocol_id 325 (micodus)
 *   device type 350         → « Jimi IoT (Concox) AT6 », protocol_id 13 (concox)
 *   ⇒ le device 8958982 ne recevra JAMAIS rien du canal 1442013.
 *
 * Ce service résout donc le type de boîtier À PARTIR du protocole du canal,
 * par son nom (« Micodus MV730 »), plutôt que de faire confiance à un
 * identifiant numérique copié à la main.
 *
 * Le catalogue change rarement : il est mis en cache une heure en mémoire.
 */

const TTL_MS = 60 * 60 * 1000

interface Entree<T> {
  valeur: T
  expire: number
}

export class FlespiProtocolGateway {
  #protocoles: Entree<FlespiProtocol[]> | null = null
  #types = new Map<number, Entree<FlespiDeviceType[]>>()

  constructor(private readonly client: FlespiClient) {}

  /**
   * Tous les protocoles (id, name).
   *
   * ⚠ Un protocole flespi n'a PAS de champ `title` : le demander dans
   * `fields` provoque un HTTP 400 « field is not allowed » (constaté en réel).
   */
  async protocols(): Promise<FlespiProtocol[]> {
    if (this.#protocoles && this.#protocoles.expire > Date.now()) return this.#protocoles.valeur
    const result = await this.lister<FlespiProtocol>('/gw/channel-protocols/all', ['id', 'name'])
    this.#protocoles = { valeur: result, expire: Date.now() + TTL_MS }
    return result
  }

  /** Protocole par id numérique ou par nom (`micodus`, `concox`, …). */
  async protocol(nomOuId: string | number): Promise<FlespiProtocol | null> {
    const liste = await this.protocols()
    const cle = String(nomOuId).trim().toLowerCase()
    return liste.find((p) => String(p.id) === cle || (p.name ?? '').toLowerCase() === cle) ?? null
  }

  /** Types de boîtiers d'un protocole (id, name, title). */
  async deviceTypes(protocolId: number): Promise<FlespiDeviceType[]> {
    const cache = this.#types.get(protocolId)
    if (cache && cache.expire > Date.now()) return cache.valeur
    const liste = await this.lister<FlespiDeviceType>(
      `/gw/channel-protocols/${protocolId}/device-types/all`,
      ['id', 'name', 'title']
    )
    const types = liste.map((t) => ({ ...t, protocol_id: protocolId }))
    this.#types.set(protocolId, { valeur: types, expire: Date.now() + TTL_MS })
    return types
  }

  /** Fiche complète d'un type : schéma de configuration (ident !), commandes, réglages. */
  async deviceType(protocolId: number, deviceTypeId: number): Promise<FlespiDeviceType | null> {
    const t = await this.client.first<FlespiDeviceType>(
      'GET',
      `/gw/channel-protocols/${protocolId}/device-types/${deviceTypeId}`
    )
    return t ? { ...t, protocol_id: protocolId } : null
  }

  /**
   * Résout un type de boîtier DANS un protocole donné.
   *
   * Accepte l'id numérique, le `name` technique (`mv730`) ou le `title`
   * affiché (`Micodus MV730`), sans tenir compte de la casse ni des espaces.
   * Retourne `null` si le type n'appartient pas à ce protocole — c'est
   * précisément le cas qu'il faut refuser.
   */
  async resolveDeviceType(
    protocolId: number,
    reference: string | number
  ): Promise<FlespiDeviceType | null> {
    const types = await this.deviceTypes(protocolId)
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')
    const cle = norm(String(reference))
    return (
      types.find((t) => String(t.id) === String(reference).trim()) ??
      types.find((t) => norm(t.name) === cle || norm(t.title) === cle) ??
      // « MV730 » doit trouver « Micodus MV730 »
      types.find((t) => norm(t.title).endsWith(cle)) ??
      null
    )
  }

  /**
   * GET avec `fields`, tolérant : si flespi refuse un champ (400, `field is
   * not allowed`), on retire CE champ et on relance, au lieu de faire échouer
   * tout le diagnostic sur un détail de catalogue.
   */
  private async lister<T>(chemin: string, champs: string[]): Promise<T[]> {
    let restants = [...champs]
    for (let essai = 0; essai < champs.length; essai++) {
      try {
        const env = await this.client.request<T>('GET', chemin, {
          fields: restants.length ? restants : undefined,
        })
        return env.result
      } catch (err) {
        const refuses =
          err instanceof FlespiApiError && err.status === 400
            ? err.errors.map((e) => e.field).filter((f): f is string => typeof f === 'string')
            : []
        const suivants = restants.filter((c) => !refuses.includes(c))
        if (refuses.length === 0 || suivants.length === restants.length) throw err
        restants = suivants
      }
    }
    const env = await this.client.request<T>('GET', chemin)
    return env.result
  }

  /** Vide le cache — utile après un changement de catalogue côté flespi. */
  clear(): void {
    this.#protocoles = null
    this.#types.clear()
  }
}
