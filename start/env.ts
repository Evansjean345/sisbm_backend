/*
|--------------------------------------------------------------------------
| Variables d'environnement
|--------------------------------------------------------------------------
|
| Toutes les variables sont validées AU DÉMARRAGE, dans un schéma UNIQUE.
| L'application refuse de démarrer si une variable de sécurité manque ou est
| mal typée, plutôt que d'échouer en production au pire moment.
|
| Le schéma unique n'est pas cosmétique : c'est lui qui donne son type de
| retour à `env.get()`. Avec deux `Env.create` séparés, `env.get('DB_PORT')`
| retombe sur `string`, que la configuration Lucid refuse.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // ---------------------------------------------------------- application
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),

  // ---------------------------------------------------------- base de données
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string(),
  DB_DATABASE: Env.schema.string(),
  DB_SSL: Env.schema.boolean.optional(),
  DB_POOL_MIN: Env.schema.number.optional(),
  DB_POOL_MAX: Env.schema.number.optional(),
  DB_READ_HOST: Env.schema.string.optional({ format: 'host' }),
  DB_READ_USER: Env.schema.string.optional(),
  DB_READ_PASSWORD: Env.schema.string.optional(),

  // ---------------------------------------------------------- redis
  REDIS_HOST: Env.schema.string({ format: 'host' }),
  REDIS_PORT: Env.schema.number(),
  REDIS_PASSWORD: Env.schema.string.optional(),

  // ---------------------------------------------------------- immobilisation
  // Paramètres de sécurité : typés strictement, jamais devinés.
  IMMOBILIZATION_ENABLED: Env.schema.boolean.optional(),
  IMMOBILIZATION_SAFETY_SPEED_KPH: Env.schema.number.optional(),
  IMMOBILIZATION_REQUIRE_VALIDATION: Env.schema.boolean.optional(),
  IMMOBILIZATION_COMMAND_TTL_MINUTES: Env.schema.number.optional(),
  IMMOBILIZATION_MAX_POSITION_AGE_SECONDS: Env.schema.number.optional(),

  // ---------------------------------------------------------- ingestion
  INGEST_MAX_HDOP: Env.schema.number.optional(),
  INGEST_MIN_SATELLITES: Env.schema.number.optional(),
  INGEST_MAX_PLAUSIBLE_SPEED_KPH: Env.schema.number.optional(),
  INGEST_BACKLOG_THRESHOLD_SECONDS: Env.schema.number.optional(),

  // ---------------------------------------------------------- trajets
  TRIP_IDLE_TIMEOUT_SECONDS: Env.schema.number.optional(),
  TRIP_MAX_DURATION_HOURS: Env.schema.number.optional(),
  TRIP_MIN_DISTANCE_M: Env.schema.number.optional(),

  // ---------------------------------------------------------- flespi
  FLESPI_TOKEN: Env.schema.string.optional(),
  FLESPI_MQTT_HOST: Env.schema.string.optional(),
  FLESPI_MQTT_PORT: Env.schema.number.optional(),
  FLESPI_MQTT_TLS: Env.schema.boolean.optional(),
  FLESPI_MQTT_CLIENT_ID: Env.schema.string.optional(),
  FLESPI_WEBHOOK_SECRET: Env.schema.string.optional(),

  // ---------------------------------------------------------- notifications
  SMTP_HOST: Env.schema.string.optional(),
  SMTP_PORT: Env.schema.number.optional(),
  SMTP_USER: Env.schema.string.optional(),
  SMTP_PASSWORD: Env.schema.string.optional(),
  SMTP_FROM: Env.schema.string.optional(),

  // ---------------------------------------------------------- rétention
  RETENTION_POSITIONS_MONTHS: Env.schema.number.optional(),
  RETENTION_INGEST_MESSAGES_MONTHS: Env.schema.number.optional(),
  RETENTION_REPORTS_DAYS: Env.schema.number.optional(),
})
