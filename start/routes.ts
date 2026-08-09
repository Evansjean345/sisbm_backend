import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { throttle } from '#start/limiter'

const AuthController = () => import('#presentation/http/controllers/identity/auth_controller')
const ImmobilizationController = () =>
  import('#presentation/http/controllers/security/immobilization_controller')

/**
 * Routage de l'API.
 *
 * Versionné dès le premier jour (`/api/v1`) : le TDR prévoit des intégrations
 * ERP, logistiques et SIEM. Faire évoluer un contrat déjà consommé par un
 * système tiers sans versionnement n'est pas rattrapable.
 */

// --------------------------------------------------------------- santé
router.get('/health', async ({ response }) => {
  return response.ok({ status: 'ok', service: 'sisbm-core', time: new Date().toISOString() })
})

// --------------------------------------------------------------- authentification
router.group(() => {
  router.post('/auth/login', [AuthController, 'login']).use(throttle.auth).prefix('/api/v1')
})

// --------------------------------------------------------------- API v1
router
  .group(() => {
    router.get('/auth/me', [AuthController, 'me'])
    router.post('/auth/logout', [AuthController, 'logout'])

    // ---- Sécurité : immobilisation contrôlée
    router
      .group(() => {
        router.post('/immobilizations', [ImmobilizationController, 'store'])
        router.post('/immobilizations/:id/validation', [ImmobilizationController, 'validate'])
      })
      .prefix('/security')
      // Débit volontairement bas : une coupure moteur n'est jamais une
      // opération de masse. Un pic de requêtes ici est un signal d'alerte.
      .use(throttle.sensitive)
  })
  .prefix('/api/v1')
  .use(middleware.auth())
