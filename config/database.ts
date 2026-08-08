import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

/**
 * Deux connexions distinctes, par conception :
 *
 *  - `primary`  : rôle sisbm_app, chemin d'écriture et lectures transactionnelles.
 *                 Pool volontairement modeste : l'ingestion écrit par lots courts.
 *  - `reporting`: rôle sisbm_readonly, rapports et exports. Isoler le pool évite
 *                 qu'un export de six mois de trajets affame le temps réel.
 */
export default defineConfig({
  connection: 'primary',
  prettyPrintDebugQueries: env.get('NODE_ENV') === 'development',

  connections: {
    primary: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
        ssl: env.get('DB_SSL', false) ? { rejectUnauthorized: false } : false,
      },
      pool: {
        min: env.get('DB_POOL_MIN', 2),
        max: env.get('DB_POOL_MAX', 10),
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      seeders: {
        paths: ['database/seeders'],
      },
      debug: false,
    },

    reporting: {
      client: 'pg',
      connection: {
        host: env.get('DB_READ_HOST', env.get('DB_HOST')),
        port: env.get('DB_PORT'),
        user: env.get('DB_READ_USER', 'sisbm_readonly'),
        password: env.get('DB_READ_PASSWORD', env.get('DB_PASSWORD')),
        database: env.get('DB_DATABASE'),
        ssl: env.get('DB_SSL', false) ? { rejectUnauthorized: false } : false,
      },
      pool: { min: 0, max: 5 },
      debug: false,
    },
  },
})
