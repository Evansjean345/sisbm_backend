import { defineConfig, stores } from '@adonisjs/limiter'
import type { InferLimiters } from '@adonisjs/limiter/types'

/**
 * Limitation de débit.
 *
 * Le magasin Redis est indispensable dès qu'il y a plusieurs instances : un
 * compteur en mémoire se contourne en changeant d'instance derrière le
 * répartiteur de charge.
 */
const limiterConfig = defineConfig({
  default: 'redis',
  stores: {
    redis: stores.redis({}),
    memory: stores.memory({}),
  },
})

export default limiterConfig

declare module '@adonisjs/limiter/types' {
  export interface LimitersList extends InferLimiters<typeof limiterConfig> {}
}
