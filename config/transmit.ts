import env from '#start/env'
import { defineConfig } from '@adonisjs/transmit'
import { redis } from '@adonisjs/transmit/transports'

/**
 * Diffusion temps réel vers les tableaux de bord (SSE).
 *
 * Le transport Redis permet à plusieurs instances de l'API de diffuser le
 * même flux : sans lui, un client connecté à l'instance A ne recevrait pas
 * les positions ingérées par l'instance B.
 */
export default defineConfig({
  pingInterval: '30s',
  transport: {
    driver: redis({ host: env.get('REDIS_HOST'), port: env.get('REDIS_PORT') }),
  },
})
