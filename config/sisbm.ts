import env from '#start/env'

/**
 * Configuration MÉTIER de la plateforme.
 *
 * Ces valeurs sont des paramètres de sécurité et d'exploitation, pas des
 * constantes de code. Les figer en dur dans un service les rendrait
 * invisibles à l'exploitation et intestables.
 *
 * Les seuils marqués (*) doivent être validés par SISBM avant mise en
 * production — cf. docs/01-modelisation §4.
 */
const sisbmConfig = {
  /** Filtrage qualité appliqué à chaque position reçue de Flespi. */
  ingestion: {
    maxHdop: env.get('INGEST_MAX_HDOP', 5),
    minSatellites: env.get('INGEST_MIN_SATELLITES', 4),
    /** Au-delà, la position est jugée physiquement impossible. */
    maxPlausibleSpeedKph: env.get('INGEST_MAX_PLAUSIBLE_SPEED_KPH', 250),
    /** Écart recorded_at / received_at signalant une trame de Store & Forward. */
    backlogThresholdSeconds: env.get('INGEST_BACKLOG_THRESHOLD_SECONDS', 300),
  },

  /** Reconstitution des trajets. */
  trips: {
    idleTimeoutSeconds: env.get('TRIP_IDLE_TIMEOUT_SECONDS', 300),
    maxDurationHours: env.get('TRIP_MAX_DURATION_HOURS', 24),
    minDistanceMeters: env.get('TRIP_MIN_DISTANCE_M', 100),
  },

  /**
   * Immobilisation contrôlée — paramètres de sécurité.
   *
   * (*) safetySpeedKph : aucune coupure moteur au-dessus de ce seuil.
   * (*) requireValidation : validation humaine par un second opérateur.
   * enabled reste à `false` tant que le test sur véhicule réel (Jalon 3)
   * n'a pas été validé par SISBM.
   */
  immobilization: {
    enabled: env.get('IMMOBILIZATION_ENABLED', false),
    safetySpeedKph: env.get('IMMOBILIZATION_SAFETY_SPEED_KPH', 5),
    requireValidation: env.get('IMMOBILIZATION_REQUIRE_VALIDATION', true),
    commandTtlMinutes: env.get('IMMOBILIZATION_COMMAND_TTL_MINUTES', 15),
    /** Une position plus ancienne ne prouve plus que le véhicule est à l'arrêt. */
    maxPositionAgeSeconds: env.get('IMMOBILIZATION_MAX_POSITION_AGE_SECONDS', 120),
  },

  /** Passerelle télématique. */
  flespi: {
    token: env.get('FLESPI_TOKEN', ''),
    mqttHost: env.get('FLESPI_MQTT_HOST', 'mqtt.flespi.io'),
    mqttPort: env.get('FLESPI_MQTT_PORT', 8883),
    mqttTls: env.get('FLESPI_MQTT_TLS', true),
    clientId: env.get('FLESPI_MQTT_CLIENT_ID', 'sisbm-core'),
    webhookSecret: env.get('FLESPI_WEBHOOK_SECRET', ''),
  },

  /** Rétention — à confirmer avec le responsable conformité (ARTCI). */
  retention: {
    positionsMonths: env.get('RETENTION_POSITIONS_MONTHS', 24),
    ingestMessagesMonths: env.get('RETENTION_INGEST_MESSAGES_MONTHS', 1),
    reportsDays: env.get('RETENTION_REPORTS_DAYS', 7),
  },
}

export default sisbmConfig
