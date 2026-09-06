#!/bin/sh
set -e

# =============================================================================
#  Point d'entrée du conteneur — API et worker d'ingestion
#
#  Le même point d'entrée sert aux deux services : seule la CMD change.
#    api    → node bin/server.js
#    worker → node ace sisbm:ingest
# =============================================================================

attendre() {
  hote="$1"; port="$2"; nom="$3"
  echo "[sisbm] attente de $nom ($hote:$port)..."
  i=0
  until node -e "
    const net=require('node:net');
    const s=net.connect({host:'$hote',port:$port});
    s.on('connect',()=>{s.end();process.exit(0)});
    s.on('error',()=>process.exit(1));
  " 2>/dev/null; do
    i=$((i+1))
    [ "$i" -ge 60 ] && echo "[sisbm] $nom injoignable après 60 tentatives" && exit 1
    sleep 1
  done
  echo "[sisbm] $nom disponible"
}

attendre "${DB_HOST:-postgres}" "${DB_PORT:-5432}" "PostgreSQL"
attendre "${REDIS_HOST:-redis}" "${REDIS_PORT:-6379}" "Redis"

# Le worker d'ingestion a besoin du broker ; l'API non.
case "$*" in
  *sisbm:ingest*) attendre "${MQTT_HOST:-mosquitto}" "${MQTT_PORT:-1883}" "Mosquitto" ;;
esac

# Les migrations ne sont PAS jouées automatiquement.
# Un déploiement qui migre tout seul peut casser la base sans qu'on l'ait
# décidé, et la gouvernance impose une sauvegarde préalable.
if [ "${RUN_MIGRATIONS}" = "true" ]; then
  echo "[sisbm] exécution des migrations (RUN_MIGRATIONS=true)"
  node ace migration:run --force
fi

exec "$@"