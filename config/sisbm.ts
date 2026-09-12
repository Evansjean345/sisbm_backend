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

  /**
   * Passerelle télématique flespi.
   *
   * `deviceType` accepte l'id numérique, le `name` ou le `title` flespi
   * (« Micodus MV730 ») : il est résolu DANS le protocole du canal, ce qui
   * interdit de créer un device d'un autre protocole que celui du canal.
   */
  flespi: {
    token: env.get('FLESPI_TOKEN', ''),
    baseUrl: env.get('FLESPI_BASE_URL', 'https://flespi.io'),
    timeoutMs: env.get('FLESPI_TIMEOUT_MS', 10000),
    /** Canal micodus de la flotte (ex. 1442013). 0 = non configuré. */
    channelId: env.get('FLESPI_CHANNEL_ID', 0),
    protocolName: env.get('FLESPI_PROTOCOL_NAME', 'micodus'),
    deviceType: env.get('FLESPI_DEVICE_TYPE', env.get('FLESPI_DEVICE_TYPE_ID', 'Micodus MV730')),
    /** Rétention des messages dans le device flespi, en secondes (défaut flespi : 1 an). */
    deviceMessagesTtl: env.get('FLESPI_DEVICE_MESSAGES_TTL', 31536000),

    /** Commandes mises en file : durée de vie et nombre d'essais de remise. */
    commandTtlSeconds: env.get('FLESPI_COMMAND_TTL_SECONDS', 3600),
    commandMaxAttempts: env.get('FLESPI_COMMAND_MAX_ATTEMPTS', 5),

    /**
     * Broker MQTT flespi. Authentification : username = jeton flespi,
     * mot de passe vide. Utiliser de préférence un jeton DÉDIÉ, restreint
     * par ACL aux topics `flespi/message/gw/devices/#` en lecture.
     */
    mqttHost: env.get('FLESPI_MQTT_HOST', 'mqtt.flespi.io'),
    mqttPort: env.get('FLESPI_MQTT_PORT', 8883),
    mqttTls: env.get('FLESPI_MQTT_TLS', true),
    mqttToken: env.get('FLESPI_MQTT_TOKEN', '') || env.get('FLESPI_TOKEN', ''),
    /** Identifiant STABLE : une session persistante est attachée au clientId. */
    clientId: env.get('FLESPI_MQTT_CLIENT_ID', 'sisbm-core'),
    topics: env
      .get('FLESPI_MQTT_TOPICS', 'flespi/message/gw/devices/+')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    /** Groupe de souscription partagée ($share/<groupe>/…) pour plusieurs workers. */
    shareGroup: env.get('FLESPI_MQTT_SHARE_GROUP', ''),
    /** Rétention de la session côté broker pendant une coupure, en secondes. */
    sessionExpirySeconds: env.get('FLESPI_MQTT_SESSION_EXPIRY', 86400),
    webhookSecret: env.get('FLESPI_WEBHOOK_SECRET', ''),
  },

  /**
   * Broker MQTT. Le TTL par message (MQTT 5) évite qu'une position périmée
   * soit rejouée : au-delà, elle ne prouve plus rien.
   */
  mqtt: {
    host: env.get('MQTT_HOST', '127.0.0.1'),
    port: env.get('MQTT_PORT', 1883),
    tls: env.get('MQTT_TLS', false),
    clientId: env.get('MQTT_CLIENT_ID', 'sisbm-ingest'),
    username: env.get('MQTT_USERNAME', ''),
    password: env.get('MQTT_PASSWORD', ''),
    topics: [env.get('MQTT_TOPIC_TELEMETRY', 'sisbm/telemetry/+/data')],
    qos: 1 as const,
    messageExpirySeconds: env.get('MQTT_MESSAGE_EXPIRY_SECONDS', 300),
    reconnectPeriodMs: env.get('MQTT_RECONNECT_PERIOD_MS', 2000),
    connectTimeoutMs: env.get('MQTT_CONNECT_TIMEOUT_MS', 10000),
    /** Plafond de la file interne — contre-pression. */
    maxInflightQueue: env.get('MQTT_MAX_INFLIGHT', 1000),
  },

  /** Rétention — à confirmer avec le responsable conformité (ARTCI). */
  retention: {
    positionsMonths: env.get('RETENTION_POSITIONS_MONTHS', 24),
    ingestMessagesMonths: env.get('RETENTION_INGEST_MESSAGES_MONTHS', 1),
    reportsDays: env.get('RETENTION_REPORTS_DAYS', 7),
  },
}

export default sisbmConfig
