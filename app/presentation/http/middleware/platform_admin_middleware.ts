import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { authorizePlatform } from '#presentation/http/support/platform_scope'

/**
 * Ferme tout le groupe `/api/v1/admin/*` à qui ne détient pas le joker `*`.
 *
 * À poser APRÈS `auth()` : il lit les habilitations de l'utilisateur
 * authentifié. La `ForbiddenError` levée est traduite en 403 au format
 * d'erreur unique de l'API par le gestionnaire d'exceptions.
 */
export default class PlatformAdminMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    await authorizePlatform(ctx)
    return next()
  }
}
