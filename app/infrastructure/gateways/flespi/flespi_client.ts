import logger from '@adonisjs/core/services/logger'

/**
 * =========================================================================
 *  CLIENT HTTP FLESPI — socle commun de toutes les passerelles
 * =========================================================================
 *
 * Toutes les réponses REST de flespi ont la même enveloppe :
 *
 *   { "result": [ ... ], "errors": [ ... ]?, "next_key": n?, "pagination": {...}? }
 *
 * Trois pièges que ce client neutralise une fois pour toutes :
 *
 *  ① `result` est TOUJOURS un tableau, même pour `GET /gw/channels/{id}`.
 *    Lire `json.id` au lieu de `json.result[0].id` renvoie `undefined`.
 *
 *  ② Une réponse HTTP 200 peut contenir des `errors` (échec partiel d'un
 *    appel en masse). On lève une erreur si `result` est vide ET que
 *    `errors` est renseigné — sinon on renvoie les deux au code appelant.
 *
 *  ③ Les paramètres d'un GET ne passent PAS en query-string classique
 *    (`?limit=1&reverse=true` est ignoré) : ils passent dans `?data={json}`
 *    encodé. Seuls `fields`, `limit` et `offset` (pagination des listes)
 *    sont de vrais paramètres d'URL.
 *
 * Réessais : uniquement sur les méthodes idempotentes (GET / DELETE) et sur
 * les statuts transitoires 429 / 5xx. Un POST de commande n'est JAMAIS
 * rejoué automatiquement : on ne coupe pas un moteur deux fois par erreur.
 */

export interface FlespiClientConfig {
  token: string
  baseUrl: string
  timeoutMs: number
}

export interface FlespiErrorItem {
  code?: number
  reason?: string
  id?: number
  [cle: string]: unknown
}

export interface FlespiEnvelope<T> {
  result: T[]
  errors?: FlespiErrorItem[]
  warnings?: unknown[]
  next_key?: number
  pagination?: { limit: number; offset: number; count: number }
}

export class FlespiApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly errors: FlespiErrorItem[]
  ) {
    const raison = errors
      .map((e) => e.reason)
      .filter(Boolean)
      .join(' ; ')
    super(`Flespi ${method} ${path} → HTTP ${status}${raison ? ` : ${raison}` : ''}`)
  }

  /** Motif lisible renvoyé par flespi (ex. « device not connected »). */
  get reason(): string {
    return (
      this.errors
        .map((e) => e.reason)
        .filter(Boolean)
        .join(' ; ') || this.message
    )
  }

  /**
   * Élément inexistant. flespi ne répond PAS 404 pour un id inconnu du
   * compte : il répond 403, code 3, « access denied or unable to process
   * the item » (constaté en réel sur GET /gw/devices/98765).
   */
  get notFound(): boolean {
    if (this.status === 404) return true
    return this.status === 403 && this.errors.some((e) => e.code === 3 && e.id !== undefined)
  }

  /** Code HTTP à renvoyer au client SISBM : 4xx flespi → 422, le reste → 502. */
  get httpStatusForClient(): number {
    if (this.notFound) return 404
    if (this.status === 400) return 422
    return 502
  }
}

export interface RequestOptions {
  body?: unknown
  /** Paramètres flespi, sérialisés dans `?data=` */
  data?: Record<string, unknown>
  /** Liste de champs à retourner (`?fields=a,b`) */
  fields?: string[]
  limit?: number
  offset?: number
}

type Methode = 'GET' | 'POST' | 'PUT' | 'DELETE'

const TRANSITOIRES = new Set([429, 500, 502, 503, 504])
const IDEMPOTENTES = new Set<Methode>(['GET', 'DELETE'])

export class FlespiClient {
  constructor(private readonly config: FlespiClientConfig) {}

  get configured(): boolean {
    return this.config.token.trim().length > 0
  }

  async request<T>(
    methode: Methode,
    chemin: string,
    opts: RequestOptions = {}
  ): Promise<FlespiEnvelope<T>> {
    if (!this.configured) {
      throw new FlespiApiError(0, methode, chemin, [
        { reason: 'FLESPI_TOKEN absent : configurer le jeton dans .env' },
      ])
    }

    const url = this.url(chemin, opts)
    const tentativesMax = IDEMPOTENTES.has(methode) ? 3 : 1
    let derniere: unknown

    for (let tentative = 1; tentative <= tentativesMax; tentative++) {
      try {
        return await this.unAppel<T>(methode, chemin, url, opts.body)
      } catch (err) {
        derniere = err
        const transitoire =
          (err instanceof FlespiApiError && TRANSITOIRES.has(err.status)) ||
          (err as Error).name === 'TimeoutError' ||
          (err as Error).name === 'TypeError' // coupure réseau (fetch failed)
        if (!transitoire || tentative === tentativesMax) break
        const attente = 300 * 2 ** (tentative - 1)
        logger.warn(
          { methode, chemin, tentative, attente },
          '[flespi] appel transitoire, nouvel essai'
        )
        await new Promise((r) => setTimeout(r, attente))
      }
    }
    throw derniere
  }

  /** Un élément par son chemin, ou `null` s'il n'existe pas (404 ou 403 code 3). */
  async item<T>(chemin: string, opts: RequestOptions = {}): Promise<T | null> {
    try {
      return await this.first<T>('GET', chemin, opts)
    } catch (err) {
      if (err instanceof FlespiApiError && err.notFound) return null
      throw err
    }
  }

  /** Raccourci : premier élément de `result`, ou `null`. */
  async first<T>(methode: Methode, chemin: string, opts: RequestOptions = {}): Promise<T | null> {
    const env = await this.request<T>(methode, chemin, opts)
    return env.result[0] ?? null
  }

  // -------------------------------------------------------------------------

  private url(chemin: string, opts: RequestOptions): string {
    const params = new URLSearchParams()
    if (opts.fields?.length) params.set('fields', opts.fields.join(','))
    if (opts.limit !== undefined) params.set('limit', String(opts.limit))
    if (opts.offset !== undefined) params.set('offset', String(opts.offset))
    if (opts.data && Object.keys(opts.data).length) params.set('data', JSON.stringify(opts.data))
    const qs = params.toString()
    return `${this.config.baseUrl.replace(/\/+$/, '')}${chemin}${qs ? `?${qs}` : ''}`
  }

  private async unAppel<T>(
    methode: Methode,
    chemin: string,
    url: string,
    corps: unknown
  ): Promise<FlespiEnvelope<T>> {
    const reponse = await fetch(url, {
      method: methode,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `FlespiToken ${this.config.token}`,
      },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    const texte = await reponse.text().catch(() => '')
    let json: Partial<FlespiEnvelope<T>> & { reason?: string; code?: number } = {}
    try {
      json = texte ? JSON.parse(texte) : {}
    } catch {
      json = {}
    }

    const erreurs: FlespiErrorItem[] = [
      ...(json.errors ?? []),
      // Certaines erreurs sont renvoyées à plat : { code, reason }
      ...(json.reason ? [{ code: json.code, reason: json.reason }] : []),
    ]

    if (!reponse.ok) {
      const erreur = new FlespiApiError(reponse.status, methode, chemin, erreurs)
      // Un élément absent est une réponse normale (l'appelant décide), pas une panne.
      const niveau = erreur.notFound ? 'warn' : 'error'
      logger[niveau](
        { methode, chemin, status: reponse.status, erreurs, corps: texte.slice(0, 500) },
        erreur.notFound ? '[flespi] élément introuvable' : '[flespi] appel en échec'
      )
      throw erreur
    }

    const result = Array.isArray(json.result) ? json.result : []
    if (result.length === 0 && erreurs.length > 0) {
      logger.error({ methode, chemin, erreurs }, '[flespi] réponse 200 porteuse d’erreurs')
      throw new FlespiApiError(400, methode, chemin, erreurs)
    }
    if (erreurs.length > 0) {
      logger.warn({ methode, chemin, erreurs }, '[flespi] échec partiel')
    }

    return {
      result,
      errors: erreurs.length ? erreurs : undefined,
      warnings: json.warnings,
      next_key: json.next_key,
      pagination: json.pagination,
    }
  }
}
