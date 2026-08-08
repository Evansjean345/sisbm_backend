import limiter from '@adonisjs/limiter/services/main'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Limitation de débit par usage.
 *
 * `sensitive` protège les opérations irréversibles (immobilisation). Le seuil
 * est délibérément bas : dix demandes par minute et par utilisateur dépassent
 * largement tout usage légitime, et un dépassement mérite d'être remonté.
 */
export const throttle = {
  api: limiter.define('api', (ctx: HttpContext) => {
    return limiter
      .allowRequests(120)
      .every('1 minute')
      .usingKey(ctx.auth?.user?.id ?? ctx.request.ip())
  }),
  sensitive: limiter.define('sensitive', (ctx: HttpContext) => {
    return limiter
      .allowRequests(10)
      .every('1 minute')
      .usingKey(`sensitive_${ctx.auth?.user?.id ?? ctx.request.ip()}`)
      .blockFor('5 minutes')
  }),
  auth: limiter.define('auth', (ctx: HttpContext) => {
    return limiter
      .allowRequests(5)
      .every('1 minute')
      .usingKey(ctx.request.ip())
      .blockFor('15 minutes')
  }),
}
