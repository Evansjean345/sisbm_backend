import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
import { errors as authErrors } from '@adonisjs/auth'
import { DomainError } from '#domain/kernel'

/**
 * =========================================================================
 *  FRONTIÈRE ERREURS MÉTIER <-> HTTP
 * =========================================================================
 *
 * Le domaine ne connaît pas HTTP : il retourne des `DomainError` porteuses
 * d'un `code` stable. C'est ici, et uniquement ici, qu'on les traduit en
 * statuts et en corps de réponse.
 *
 * Format unique sur toute l'API :
 *
 *   { "error": { "code": "E_VEHICLE_IN_MOTION",
 *                "message": "...",
 *                "details": { "currentKph": 47, "limitKph": 5 } } }
 *
 * Le `code` est le contrat consommé par le front et les systèmes tiers ;
 * le `message` s'adresse aux humains et ne doit jamais être parsé.
 */
export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  async handle(error: unknown, ctx: HttpContext) {
    if (error instanceof DomainError)
      return ctx.response.status(error.httpStatus).send({ error: error.toJSON() })

    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      return ctx.response.status(422).send({
        error: {
          code: 'E_VALIDATION',
          message: 'Les données transmises sont invalides',
          details: { fields: error.messages },
        },
      })
    }

    if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
      return ctx.response.status(401).send({
        error: { code: 'E_UNAUTHORIZED', message: 'Authentification requise', details: {} },
      })
    }

    /**
     * Conflit de sérialisation PostgreSQL (SQLSTATE 40001).
     *
     * Attendu sous isolation SERIALIZABLE : deux transactions concurrentes
     * ont été jugées non sérialisables. Ce n'est pas un bug, c'est le
     * mécanisme qui fonctionne. Le client doit rejouer sa requête.
     */

    if (this.isSerializationFailure(error)) {
      ctx.response.header('Retry-After', '1')
      return ctx.response.status(409).send({
        error: {
          code: 'E_CONCURRENT_MODIFICATION',
          message:
            'Une opération concurrente a été détectée sur la même ressource. ' +
            'Merci de relancer la demande.',
          details: {},
        },
      })
    }

    if (this.isConstraintViolation(error)) {
      const pg = error as { constraint?: string }
      return ctx.response.status(409).send({
        error: {
          code: 'E_CONSTRAINT_VIOLATION',
          message: "L'opération viole une contrainte d'intégrité de la base",
          details: app.inProduction ? {} : { constraint: pg.constraint },
        },
      })
    }

    return super.handle(error, ctx)
  }

  async report(error: unknown, ctx: HttpContext) {
    // Une règle métier violée n'est pas un incident : la journaliser en
    // erreur rendrait les vraies pannes invisibles.
    if (error instanceof DomainError) return
    if (error instanceof vineErrors.E_VALIDATION_ERROR) return
    return super.report(error, ctx)
  }

  private isSerializationFailure(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === '40001'
    )
  }

  private isConstraintViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) return false
    const code = (error as { code: string }).code
    // 23505 unique · 23503 clé étrangère · 23514 check · 23P01 exclusion
    return ['23505', '23503', '23514', '23P01'].includes(code)
  }
}
