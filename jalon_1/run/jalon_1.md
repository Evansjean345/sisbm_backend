# SISBM CORE — Backend

Plateforme de tracking GPS et de supervision de flotte.
**AdonisJS 7** · **Node.js 24** · **PostgreSQL 16 + PostGIS 3.4** · **Redis 7**

> ⚠️ **Node.js 24 minimum.** AdonisJS 7 et Lucid 22 déclarent `engines.node >= 24`.

---

## Démarrage

```bash
cp .env.example .env
node ace generate:key          # renseigne APP_KEY

docker compose -f docker/docker-compose.yml up -d postgres redis
npm install
node ace migration:run

# objets non gérés par Lucid : rôles PostgreSQL, maintenance, vues KPI
psql "$DATABASE_URL" -f database/sql/functions/01_roles_and_grants.sql
psql "$DATABASE_URL" -f database/sql/functions/02_maintenance.sql
psql "$DATABASE_URL" -f database/sql/views/01_kpi_materialized_views.sql

npm run dev
```

## Architecture

Clean Architecture canonique, organisée **par couches**. Aucun dossier `shared/` :
chaque brique vit dans la couche à laquelle elle appartient.

```
app/
├── domain/           règles métier — n'importe aucun framework
│   ├── kernel.ts     Entity, AggregateRoot, ValueObject, Result, DomainError
│   └── <contexte>/   entités, objets-valeurs, événements, ports de dépôt
├── application/      cas d'usage et ports
├── infrastructure/   Lucid, transactions, passerelles externes
└── presentation/     HTTP : contrôleurs, validateurs, middleware
```

Les dépendances pointent toujours vers l'intérieur :
`presentation → application → domain`, `infrastructure` implémente les ports.

```bash
npm run arch     # contrôle automatisé de la règle de dépendance
```

## Commandes

| Commande                               | Rôle                                    |
| -------------------------------------- | --------------------------------------- |
| `npm run dev`                          | serveur avec rechargement à chaud       |
| `npm run check`                        | arch + lint + typecheck + tests         |
| `npm run arch`                         | contrôle de la règle de dépendance      |
| `node ace test unit`                   | tests du domaine — sans base de données |
| `node ace list:routes`                 | routes et middlewares                   |
| `node ace migration:run` / `:rollback` | migrations                              |
| `node ace build`                       | build de production                     |

## Documentation

| Fichier                                   | Contenu                                |
| ----------------------------------------- | -------------------------------------- |
| `docs/01-modelisation-base-de-donnees.md` | MCD, entités, contraintes, ACID        |
| `docs/02-gouvernance-des-donnees.md`      | gouvernance, conventions, qualité      |
| `docs/03-architecture-backend.md`         | couches, DDD calibré, sécurité, Docker |

## État de validation

Vérifié en exécution réelle : 10/10 migrations, **5/5 contrôles d'architecture**,
`tsc --noEmit` sans erreur, **17/17 tests unitaires en 47 ms**, build de production généré.
