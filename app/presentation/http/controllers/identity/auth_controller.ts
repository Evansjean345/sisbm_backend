import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import UserModel from '#infrastructure/persistence/models/user_model'
import { loginValidator } from '#presentation/http/validators/identity/auth_validators'

/**
 * Authentification.
 *
 * Le contexte Identity suit le style PRAGMATIQUE : contrôleur → Lucid, sans
 * agrégat ni cas d'usage. Il n'y a ici aucune règle métier complexe à protéger,
 * et l'abstraction n'apporterait que du bruit (cf. docs/03 §3).
 */
export default class AuthController {
  /** POST /api/v1/auth/login */
  async login({ request, response }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    const user = await UserModel.query().where('email', email).whereNull('deleted_at').first()

    // Message identique que le compte existe ou non : ne pas révéler
    // quels e-mails sont enregistrés.

    const invalid = {
      error: { code: 'E_INVALID_CREDENTIALS', message: 'Identifiants invalides', details: {} },
    }

    if (!user) return response.unauthorized(invalid)

    if (user.isLocked) {
      return response.status(423).send({
        error: {
          code: 'E_ACCOUNT_LOCKED',
          message: 'Compte temporairement verrouillé',
          details: { until: user.lockedUntil?.toISO() },
        },
      })
    }

    if (!(await user.verifyPassword(password))) {
      user.failedAttempts += 1
      // Verrouillage progressif : 5 échecs = 15 minutes.
      if (user.failedAttempts >= 5) {
        user.lockedUntil = DateTime.now().plus({ minutes: 15 })
        user.failedAttempts = 0
      }
      await user.save()
      return response.unauthorized(invalid)
    }

    if (!user.isActive) {
      return response.forbidden({
        error: { code: 'E_ACCOUNT_INACTIVE', message: 'Compte inactif', details: {} },
      })
    }

    user.failedAttempts = 0
    user.lastLoginAt = DateTime.now()
    user.lastLoginIp = request.ip()
    await user.save()

    const token = await UserModel.accessTokens.create(user, ['*'], { expiresIn: '7 days' })

    return response.ok({
      data: {
        token: token.value!.release(),
        expiresAt: token.expiresAt,
        user: { id: user.id, email: user.email, fullName: user.fullName },
      },
    })
  }

  /** GET /api/v1/auth/me */
  async me({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as UserModel
    return response.ok({
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        organizationId: user.organizationId,
        roleId: user.roleId,
      },
    })
  }

  /** POST /api/v1/auth/logout */
  async logout({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as UserModel
    await UserModel.accessTokens.delete(user, auth.user!.currentAccessToken.identifier)
    return response.noContent()
  }
}
