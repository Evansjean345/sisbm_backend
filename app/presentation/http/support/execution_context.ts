import type { HttpContext } from '@adonisjs/core/http'
import type { ExecutionContext } from '#application/ports'

/**
 * Traduit un contexte HTTP en contexte d'exécution métier.
 *
 * C'est la frontière : au-delà de cette fonction, plus rien ne sait qu'une
 * requête HTTP existe. Les cas d'usage reçoivent un ExecutionContext, qu'ils
 * soient appelés par un contrôleur, un worker de file ou le moteur de règles.
 */
export function toExecutionContext(ctx: HttpContext): ExecutionContext {
  const user = ctx.auth?.user as { id: string; organizationId: string } | undefined

  return {
    actorId: user?.id ?? null,
    actorType: user ? 'user' : 'api',
    organizationId: user?.organizationId ?? '',
    ip: ctx.request.ip(),
    userAgent: ctx.request.header('user-agent'),
    requestId: ctx.request.id(),
  }
}
