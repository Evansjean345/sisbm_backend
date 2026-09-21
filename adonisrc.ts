import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  /*
  |--------------------------------------------------------------------------
  | Commandes
  |--------------------------------------------------------------------------
  */
  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
    () => import('@adonisjs/mail/commands'),
  ],

  /*
  |--------------------------------------------------------------------------
  | Fournisseurs de services
  |--------------------------------------------------------------------------
  |
  | L'ordre compte : `container_provider` enregistre les liaisons
  | port -> adaptateur de la Clean Architecture et doit venir APRÈS les
  | providers d'infrastructure dont il dépend (base de données, redis).
  |
  */
  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/core/providers/hash_provider'),
    {
      file: () => import('@adonisjs/core/providers/repl_provider'),
      environment: ['repl', 'test'],
    },
    () => import('@adonisjs/core/providers/vinejs_provider'),
    () => import('@adonisjs/cors/cors_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonisjs/auth/auth_provider'),
    () => import('@adonisjs/redis/redis_provider'),
    () => import('@adonisjs/limiter/limiter_provider'),
    () => import('@adonisjs/mail/mail_provider'),
    () => import('@adonisjs/transmit/transmit_provider'),
    () => import('#providers/container_provider'),
  ],

  /*
  |--------------------------------------------------------------------------
  | Préchargements
  |--------------------------------------------------------------------------
  */
  preloads: [() => import('#start/routes'), () => import('#start/kernel')],

  /*
  |--------------------------------------------------------------------------
  | Suites de tests
  |--------------------------------------------------------------------------
  |
  | `unit` couvre le domaine et l'application : aucune base de données,
  | aucun réseau, exécution en quelques millisecondes.
  | `functional` couvre les adaptateurs et les routes HTTP.
  |
  */
  tests: {
    suites: [
      {
        files: ['tests/unit/**/*.spec.ts', 'tests/unit/**/*.spec.js'],
        name: 'unit',
        timeout: 2000,
      },
      {
        files: ['tests/functional/**/*.spec.ts', 'tests/functional/**/*.spec.js'],
        name: 'functional',
        timeout: 30000,
      },
    ],
    forceExit: false,
  },

  /*
  |--------------------------------------------------------------------------
  | Répertoires
  |--------------------------------------------------------------------------
  |
  | L'organisation par bounded context remplace l'arborescence par type
  | technique du starter. Les générateurs `ace make:*` sont recâblés en
  | conséquence.
  |
  */
  directories: {
    config: 'config',
    commands: 'commands',
    database: 'database',
    migrations: 'database/migrations',
    seeders: 'database/seeders',
    providers: 'providers',
    start: 'start',
    tests: 'tests',
    // Organisation par COUCHE (Clean Architecture canonique) : les
    // générateurs `ace make:*` sont recâblés en conséquence.
    httpControllers: 'app/presentation/http/controllers',
    validators: 'app/presentation/http/validators',
    middleware: 'app/presentation/http/middleware',
    exceptions: 'app/presentation/http',
    models: 'app/infrastructure/persistence/models',
    services: 'app/application',
    events: 'app/domain',
    listeners: 'app/application',
  },
})
