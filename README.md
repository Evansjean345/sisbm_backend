# SISBM CORE — Socle base de données (Jalon 1)

Plateforme de tracking GPS et de supervision de flotte.
**AdonisJS 6** · **PostgreSQL 16 + PostGIS 3.4** · **Redis** · **Flespi**

---

## Contenu de cette livraison

```
.
├── docs/
│   ├── 01-modelisation-base-de-donnees.md   # MCD, entités, contraintes, ACID
│   └── 02-gouvernance-des-donnees.md        # gouvernance, conventions, qualité
├── database/
│   ├── migrations/                          # 10 migrations AdonisJS/Lucid
│   └── sql/
│       ├── functions/
│       │   ├── 01_roles_and_grants.sql      # rôles PG, append-only
│       │   └── 02_maintenance.sql           # partitions, rétention, qualité
│       └── views/
│           └── 01_kpi_materialized_views.sql
├── infra/docker-compose.yml
└── .env.example
```

**36 tables**, 1 vue, 3 vues matérialisées, partitionnement mensuel sur
`positions`, `ingest_messages` et `audit_logs`.

---

## Mise en route

```bash
# 1. Infrastructure
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d

# 2. Projet AdonisJS (si le dépôt n'est pas encore initialisé)
npm init adonisjs@latest -- -K=api --db=postgres
npm i @adonisjs/lucid @adonisjs/auth @adonisjs/redis @vinejs/vine

# 3. Copier database/migrations/* dans le projet, puis :
node ace migration:run

# 4. Objets non gérés par Lucid (rôles, maintenance, vues matérialisées)
docker exec -i sisbm_postgres psql -U sisbm_owner -d sisbm_core \
  < database/sql/functions/01_roles_and_grants.sql
docker exec -i sisbm_postgres psql -U sisbm_owner -d sisbm_core \
  < database/sql/functions/02_maintenance.sql
docker exec -i sisbm_postgres psql -U sisbm_owner -d sisbm_core \
  < database/sql/views/01_kpi_materialized_views.sql
```

**Vérification :**

```sql
SELECT postgis_version();
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
SELECT * FROM sisbm_maintain_partitions();
SELECT * FROM sisbm_data_quality_report();   -- vide = base saine
```

### Rollback

Les vues matérialisées dépendent de `trips`, `events` et `sms_transactions`. Elles ne sont pas
gérées par Lucid : il faut les supprimer **avant** un rollback, sinon les `DROP TABLE` échouent.

```bash
psql -d sisbm_core -c "DROP MATERIALIZED VIEW IF EXISTS
  mv_vehicle_daily_stats, mv_event_daily_stats, mv_sms_monthly_usage;"
node ace migration:rollback --batch=0
```

### Connexion DBeaver

| Champ | Valeur |
|---|---|
| Hôte / Port | `localhost` / `5432` |
| Base | `sisbm_core` |
| Utilisateur | `sisbm_owner` (DDL) ou `sisbm_readonly` (exploration) |
| Fuseau | forcer `UTC` dans *Driver properties → `TimeZone`* |

> Exploration au quotidien : se connecter en **`sisbm_readonly`**. C'est le meilleur
> garde-fou contre un `UPDATE` sans `WHERE` un vendredi soir.
> Aucune modification de structure ne se fait dans DBeaver : tout DDL passe par une
> migration versionnée (cf. gouvernance §d).

---

## Validation exécutée

Schéma appliqué et vérifié sur **PostgreSQL 16.14 + PostGIS 3.4** :

| Vérification | Résultat |
|---|---|
| Application complète des 10 migrations | ✅ sans erreur |
| Rollback complet | ✅ base rendue vide |
| Création des partitions (positions, ingest, audit) | ✅ 15 partitions |
| `sisbm_maintain_partitions()` | ✅ idempotente |
| `sisbm_data_quality_report()` | ✅ aucune anomalie |
| `sisbm_refresh_kpi_views()` | ✅ |
| **Partition pruning** sur relecture de trajet | ✅ 4 partitions écartées, index scan ciblé |

Jeu de tests des contraintes — `database/sql/seeds/99_constraint_tests.sql` (12/12) :

```
OK CM-01  double affectation tracker rejetée
OK CM-06  second trajet ouvert rejeté
OK CM-07  coupure moteur à 90 km/h rejetée
OK CM-08  motif de commande vide rejeté
OK CM-09  seconde commande en vol rejetée
OK CM-10  solde SMS négatif rejeté
OK CM-13  double cible de geofence rejetée
OK CM-15  événement dédoublonné
OK CM-16  rejeu Store & Forward idempotent
OK        auto-validation d'une immobilisation rejetée (double regard)
OK        numéro non normalisé E.164 rejeté
OK        ST_Covers opérationnel sur geofence
```

Relancer à tout moment (le script se termine par un `ROLLBACK`, il ne laisse rien en base) :

```bash
psql -d sisbm_core -f database/sql/seeds/99_constraint_tests.sql
```

---

## Tâches planifiées à mettre en place (Jalon 2)

| Fréquence | Action |
|---|---|
| 1× / mois | `SELECT sisbm_maintain_partitions();` |
| 1× / nuit | `SELECT sisbm_refresh_kpi_views();` |
| 1× / nuit | `SELECT sisbm_data_quality_report();` → alerte si non vide |
| 1× / nuit | `pg_dump` chiffré hors serveur |
| 1× / mois | `sisbm_detach_old_partitions('ingest_messages', 1)` |
| 1× / mois | **Test de restauration** — non négociable |

---

## Points ouverts avant le Jalon 2

1. Mono-tenant ou multi-tenant (cf. `docs/01`, §0)
2. Fréquence d'émission des trackers et taille de flotte cible
3. Seuil de vitesse et circuit de validation de l'immobilisation
4. Matrice définitive des rôles et permissions
5. Durées de rétention légales (conformité ARTCI)

---

## Prochaines étapes du Jalon 1

- [ ] Modèles Lucid + types TypeScript dérivés du schéma
- [ ] Seeders (organisation de test, rôles, véhicules, trackers, geofences)
- [ ] Schéma OpenAPI initial
- [ ] Diagramme d'architecture applicative
- [ ] Structure Git : branches, convention de commits, CI
