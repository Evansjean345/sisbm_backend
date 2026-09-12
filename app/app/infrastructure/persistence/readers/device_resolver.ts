import db from '@adonisjs/lucid/services/db'
import redis from '@adonisjs/redis/services/main'
import logger from '@adonisjs/core/services/logger'
import type { DeviceResolver, ResolvedDevice } from '#application/telemetry/ports'

/**
 * =========================================================================
 *  RÉSOLVEUR DE BOÎTIER — ident → (device, véhicule, organisation)
 * =========================================================================
 *
 * Chaque trame arrive avec un identifiant constructeur, pas un identifiant
 * interne. Sans cache, c'est **une requête SQL par trame** : environ 7 par
 * seconde pour 100 véhicules à un point toutes les 15 s — pour une donnée qui
 * ne change qu'au démontage d'un boîtier.
 *
 * Deux niveaux :
 *  ① mémoire du processus — coût nul, mais perdu au redémarrage
 *  ② Redis, TTL 5 min — partagé entre plusieurs workers d'ingestion
 *
 * Les valeurs NÉGATIVES sont aussi mises en cache, avec un TTL plus court :
 * un boîtier inconnu qui émet toutes les 15 secondes produirait sinon une
 * requête inutile à chaque trame. C'est exactement le scénario d'un boîtier
 * installé sur le terrain mais pas encore enregistré dans l'application.
 */

const PREFIXE = 'device:resolve:'
const TTL_TROUVE = 300
const TTL_INCONNU = 60

interface EntreeCache {
  found: boolean
  device?: ResolvedDevice
  expiresAt: number
}

export class CachedDeviceResolver implements DeviceResolver {
  #memoire = new Map<string, EntreeCache>()

  async resolve(ident: string): Promise<ResolvedDevice | null> {
    const maintenant = Date.now()

    // ---- ① mémoire du processus
    const local = this.#memoire.get(ident)
    if (local && local.expiresAt > maintenant) {
      return local.found ? local.device! : null
    }

    // ---- ② Redis
    try {
      const brut = await redis.get(`${PREFIXE}${ident}`)
      if (brut) {
        const entree = JSON.parse(brut) as { found: boolean; device?: ResolvedDevice }
        this.#memoire.set(ident, {
          found: entree.found,
          device: entree.device,
          expiresAt: maintenant + (entree.found ? TTL_TROUVE : TTL_INCONNU) * 1000,
        })
        return entree.found ? entree.device! : null
      }
    } catch (err) {
      // Redis indisponible n'est pas bloquant : on retombe sur la base.
      // Perdre le cache dégrade les performances, pas la correction.
      logger.warn({ err, ident }, '[resolver] cache Redis indisponible, repli sur PostgreSQL')
    }

    // ---- ③ base
    const device = await this.charger(ident)
    await this.memoriser(ident, device)
    return device
  }

  /**
   * Invalidation explicite.
   *
   * À appeler lors d'un montage, d'un démontage ou d'une suppression de
   * boîtier : sans cela, l'ingestion continuerait pendant cinq minutes à
   * rattacher les positions à l'ancien véhicule.
   */
  async invalidate(ident: string): Promise<void> {
    this.#memoire.delete(ident)
    try {
      await redis.del(`${PREFIXE}${ident}`)
    } catch (err) {
      logger.warn({ err, ident }, '[resolver] invalidation Redis en échec')
    }
  }

  // -------------------------------------------------------------------------

  /**
   * L'identifiant peut être stocké sous deux formes selon le point d'entrée :
   * l'IMEI nu, ou la forme Flespi préfixée d'un `0`. On accepte les deux, ce
   * qui rend la résolution robuste même si un boîtier a été enregistré avant
   * la normalisation.
   */
  private async charger(ident: string): Promise<ResolvedDevice | null> {
    // Forme `flespi:{id}` : trame sans ident, rapprochée par l'id du device flespi.
    const flespi = /^flespi:(\d+)$/.exec(ident)
    if (flespi) return this.chargerParFlespiId(Number(flespi[1]))

    const r = await db.rawQuery(
      `SELECT d.id            AS device_id,
              d.organization_id,
              d.has_relay,
              d.flespi_device_id,
              da.vehicle_id
         FROM devices d
         LEFT JOIN device_assignments da
                ON da.device_id = d.id AND upper_inf(da.period)
        WHERE (d.imei = :ident OR d.flespi_ident = :ident OR d.imei = :sansZero
               OR d.flespi_ident = :sansZero OR d.flespi_ident = :avecZero)
          AND d.deleted_at IS NULL
        LIMIT 1`,
      {
        ident,
        sansZero: ident.startsWith('0') && ident.length > 1 ? ident.slice(1) : ident,
        // Micodus : un boîtier déclaré « 0 + ID » avant correction reste reconnu.
        avecZero: `0${ident}`,
      } as never
    )

    const l = r.rows?.[0]
    if (!l) return null

    return {
      deviceId: String(l.device_id),
      organizationId: String(l.organization_id),
      vehicleId: l.vehicle_id ? String(l.vehicle_id) : null,
      hasRelay: Boolean(l.has_relay),
      flespiDeviceId: l.flespi_device_id ? Number(l.flespi_device_id) : null,
    }
  }

  private async chargerParFlespiId(flespiDeviceId: number): Promise<ResolvedDevice | null> {
    const r = await db.rawQuery(
      `SELECT d.id AS device_id, d.organization_id, d.has_relay, d.flespi_device_id, da.vehicle_id
         FROM devices d
         LEFT JOIN device_assignments da ON da.device_id = d.id AND upper_inf(da.period)
        WHERE d.flespi_device_id = :id AND d.deleted_at IS NULL
        LIMIT 1`,
      { id: flespiDeviceId } as never
    )
    const l = r.rows?.[0]
    if (!l) return null
    return {
      deviceId: String(l.device_id),
      organizationId: String(l.organization_id),
      vehicleId: l.vehicle_id ? String(l.vehicle_id) : null,
      hasRelay: Boolean(l.has_relay),
      flespiDeviceId: Number(l.flespi_device_id),
    }
  }

  private async memoriser(ident: string, device: ResolvedDevice | null): Promise<void> {
    const ttl = device ? TTL_TROUVE : TTL_INCONNU
    this.#memoire.set(ident, {
      found: device !== null,
      device: device ?? undefined,
      expiresAt: Date.now() + ttl * 1000,
    })
    try {
      await redis.setex(
        `${PREFIXE}${ident}`,
        ttl,
        JSON.stringify({ found: device !== null, device })
      )
    } catch {
      // Cache best-effort : l'échec d'écriture ne doit pas interrompre
      // l'ingestion d'une position.
    }
  }

  /** Vide le cache mémoire — utilisé par les tests. */
  clearLocal(): void {
    this.#memoire.clear()
  }
}

/** Résolveur en mémoire pure, pour les tests unitaires. */
export class InMemoryDeviceResolver implements DeviceResolver {
  constructor(private readonly table: Map<string, ResolvedDevice> = new Map()) {}

  register(ident: string, device: ResolvedDevice): void {
    this.table.set(ident, device)
  }

  async resolve(ident: string): Promise<ResolvedDevice | null> {
    return this.table.get(ident) ?? null
  }

  async invalidate(ident: string): Promise<void> {
    this.table.delete(ident)
  }
}
