# =============================================================================
#  SISBM CORE — image de production
#
#  Node 24 est une CONTRAINTE, pas une préférence : AdonisJS 7 et Lucid 22
#  déclarent `engines.node >= 24`.
#
#  Construction multi-étages : l'image finale ne contient ni le code source
#  TypeScript, ni les dépendances de développement, ni la chaîne de compilation.
# =============================================================================

# --------------------------------------------------------------------- base
FROM node:24-alpine AS base
RUN apk add --no-cache tini curl
WORKDIR /app
ENV NODE_ENV=production TZ=UTC

# --------------------------------------------------------------------- deps
# Étape isolée pour tirer parti du cache Docker : tant que package.json et
# package-lock.json ne changent pas, `npm ci` n'est pas rejoué.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# --------------------------------------------------------------------- build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node ace build

# --------------------------------------------------------- production deps
FROM base AS production-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --------------------------------------------------------------------- final
FROM base AS runtime

# Exécution sans privilèges. L'image node fournit déjà l'utilisateur `node`.
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER node
EXPOSE 3333

# La sonde interroge /health : elle vérifie que le processus RÉPOND,
# pas seulement qu'il est vivant.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3333/health || exit 1

# tini comme PID 1 : sans lui, Node ne reçoit pas correctement SIGTERM et
# l'arrêt gracieux (fermeture du pool PostgreSQL, drain des files) ne se fait pas.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "bin/server.js"]