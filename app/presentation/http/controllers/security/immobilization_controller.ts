import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { RequestImmobilization } from '#application/security/use_cases/request_immobilization'
import { ValidateImmobilization } from '#application/security/use_cases/validate_immobilization'
import {
  requestImmobilizationValidator,
  validateImmobilizationValidator,
} from '#presentation/http/validators/security/immobilization_validators'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorize } from '#presentation/http/support/authorize'

/**
 * Contrôleur HTTP — couche la plus fine du système.
 *
 * Sa seule responsabilité : traduire HTTP <-> cas d'usage. Il ne connaît ni
 * Lucid, ni la base, ni les règles de sécurité. Si on devait exposer
 * l'immobilisation en MQTT ou en CLI, on écrirait un autre adaptateur et
 * le métier resterait strictement identique.
 */
@inject()
export default class ImmobilizationController {
  constructor(
    private readonly requestImmobilization: RequestImmobilization,
    private readonly validateImmobilization: ValidateImmobilization
  ) {}

  /** POST /api/v1/security/immobilizations */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'requestImmobilization')
    const payload = await ctx.request.validateUsing(requestImmobilizationValidator)

    const result = await this.requestImmobilization.execute({
      context: toExecutionContext(ctx),
      vehicleId: payload.vehicleId,
      reason: payload.reason,
      origin: 'manual',
      alertId: payload.alertId ?? null,
    })

    if (!result.ok) {
      return ctx.response.status(result.error.httpStatus).send({ error: result.error.toJSON() })
    }

    return ctx.response.status(200).send({ data: result.value })
  }

  /** POST /api/v1/security/immobilizations/:id/validation */
  async validate(ctx: HttpContext) {
    await authorize(ctx, 'validateImmobilization')
    const payload = await ctx.request.validateUsing(validateImmobilizationValidator)

    const result = await this.validateImmobilization.execute({
      context: toExecutionContext(ctx),
      commandId: ctx.params.id,
      decision: payload.decision,
      rejectionReason: payload.rejectionReason,
    })

    if (!result.ok) {
      return ctx.response.status(result.error.httpStatus).send({ error: result.error.toJSON() })
    }

    return ctx.response.ok({ data: result.value })
  }
}
