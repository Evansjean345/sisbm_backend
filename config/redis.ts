import env from '#start/env'
import { defineConfig } from '@adonisjs/redis'

/**
 * Deux connexions : `main` pour le cache et les verrous applicatifs,
 * `queue` pour BullMQ. BullMQ exige `maxRetriesPerRequest: null` ;
 * imposer ce réglage au cache dégraderait sa réactivité en cas d'incident.
 */
export default defineConfig({
  connection: 'main',
  connections: {
    main: {
      host: env.get('REDIS_HOST'),
      port: env.get('REDIS_PORT'),
      password: env.get('REDIS_PASSWORD', ''),
      keyPrefix: 'sisbm:',
      retryStrategy(times) {
        return times > 10 ? null : times * 200
      },
    },
    queue: {
      host: env.get('REDIS_HOST'),
      port: env.get('REDIS_PORT'),
      password: env.get('REDIS_PASSWORD', ''),
      maxRetriesPerRequest: null,
    },
  },
})
