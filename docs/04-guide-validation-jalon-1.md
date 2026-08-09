# Guide de validation — Jalon 1

Mode opératoire de recette. Toutes les commandes ont été **exécutées et
vérifiées** sur PostgreSQL 16.14 + PostGIS 3.4 + Redis 7.

---

## 0. Préparation

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis
npm install
node ace generate:key                # si APP_KEY a été régénérée

node ace migration:fresh
node ace db:seed
```

Objets non gérés par Lucid :

```bash
export PGURL="postgresql://sisbm_owner:MOT_DE_PASSE@127.0.0.1:5432/sisbm_core"
psql "$PGURL" -f database/sql/functions/01_roles_and_grants.sql
psql "$PGURL" -f database/sql/functions/02_maintenance.sql
psql "$PGURL" -f database/sql/views/01_kpi_materialized_views.sql
```

---

## 1. Vérifications hors ligne

```bash
npm run arch          # 5/5 contrôles de la règle de dépendance
npm run typecheck     # 0 erreur
node ace test unit    # 17/17 en ~45 ms, sans base de données
node ace list:routes
```

---

## 2. Base de données

### 2.1 Structure

```sql
-- PostGIS actif
SELECT postgis_version();

-- 36 tables métier (hors partitions)
SELECT count(*) FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  AND table_name !~ '_[0-9]{6}$';

-- partitions mensuelles créées
SELECT p.relname AS parent, count(*) AS partitions
FROM pg_inherits i
JOIN pg_class c ON c.oid = i.inhrelid
JOIN pg_class p ON p.oid = i.inhparent
GROUP BY 1 ORDER BY 1;
```

### 2.2 Contraintes métier — 12 tests

```bash
psql "$PGURL" -f database/sql/seeds/99_constraint_tests.sql
```

Le script se termine par un `ROLLBACK` : il ne laisse rien en base. Attendu :

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
OK        auto-validation d'une immobilisation rejetée
OK        numéro non normalisé E.164 rejeté
OK        ST_Covers opérationnel sur geofence
```

### 2.3 Maintenance et qualité

```sql
SELECT * FROM sisbm_maintain_partitions();   -- idempotent
SELECT * FROM sisbm_data_quality_report();   -- vide = base saine
SELECT sisbm_refresh_kpi_views();
```

### 2.4 Requêtes géospatiales

```sql
-- véhicules dans la zone autorisée
SELECT v.registration, g.name
FROM vehicle_last_positions p
JOIN vehicles v  ON v.id = p.vehicle_id
JOIN geofences g ON ST_Covers(g.geom, p.location)
WHERE g.is_active;

-- distance de chaque véhicule au centre du port d'Abidjan
SELECT v.registration,
       round(ST_Distance(p.location,
             ST_SetSRID(ST_MakePoint(-4.0083, 5.28), 4326)::geography)::numeric) AS metres
FROM vehicle_last_positions p
JOIN vehicles v ON v.id = p.vehicle_id
ORDER BY 2;

-- affectation tracker ↔ véhicule EN COURS
SELECT * FROM current_device_assignments;
```

---

## 3. API — scénario complet

```bash
npm run dev
API=http://127.0.0.1:3333/api/v1
```

### 3.1 Santé

```bash
curl -s $API/../health
# {"status":"ok","service":"sisbm-core","time":"..."}
```

### 3.2 Authentification

```bash
# connexion (admin = demandeur)
A=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@sisbm.ci","password":"Sisbm2026!"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")

# connexion (superviseur = valideur — obligatoire, quatre yeux)
S=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"superviseur@sisbm.ci","password":"Sisbm2026!"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")

curl -s $API/auth/me -H "Authorization: Bearer $A"
```

Cas de rejet :

```bash
# mauvais mot de passe                                       → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@sisbm.ci","password":"mauvais123"}'

# requête sans jeton                                         → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/security/immobilizations \
  -H 'Content-Type: application/json' \
  -d '{"vehicleId":"aaaaaaaa-0000-4000-8000-000000000001","reason":"test immobilisation"}'
```

### 3.3 Immobilisation — les six cas

```bash
V1=aaaaaaaa-0000-4000-8000-000000000001   # à l'arrêt
V2=aaaaaaaa-0000-4000-8000-000000000002   # roule à 62 km/h
V3=aaaaaaaa-0000-4000-8000-000000000003   # immobilisation désactivée

req() { curl -s -X POST $API/security/immobilizations \
  -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
  -d "{\"vehicleId\":\"$2\",\"reason\":\"$3\"}"; }
```

| #   | Commande                                | Résultat attendu                                          |
| --- | --------------------------------------- | --------------------------------------------------------- |
| 1   | `req "$A" $V1 "Vehicule signale vole"`  | `201` · `status: pending_validation`                      |
| 2   | `req "$A" $V2 "Test garde-fou vitesse"` | `422 E_VEHICLE_IN_MOTION` · `{currentKph:62, limitKph:5}` |
| 3   | `req "$A" $V3 "Test desactive"`         | `403 E_IMMOBILIZATION_DISABLED`                           |
| 4   | `req "$A" $V1 "Demande concurrente"`    | `409 E_COMMAND_IN_FLIGHT`                                 |
| 5   | `req "$A" $V1 "ok"` (motif court)       | `422 E_VALIDATION`                                        |

**Cas 2 est le test central du Jalon 1 :** il prouve que la plateforme refuse de
couper le moteur d'un véhicule lancé.

### 3.4 Quatre yeux

```bash
CMD=<commandId retourné au cas 1>

# auto-validation par le demandeur           → 403 E_SELF_VALIDATION
curl -s -X POST $API/security/immobilizations/$CMD/validation \
  -H "Authorization: Bearer $A" -H 'Content-Type: application/json' \
  -d '{"decision":"approve"}'

# validation par le superviseur              → 200 status approved
curl -s -X POST $API/security/immobilizations/$CMD/validation \
  -H "Authorization: Bearer $S" -H 'Content-Type: application/json' \
  -d '{"decision":"approve"}'
```

### 3.5 Limitation de débit

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST $API/security/immobilizations \
    -H "Authorization: Bearer $A" -H 'Content-Type: application/json' \
    -d "{\"vehicleId\":\"$V1\",\"reason\":\"test debit numero $i\"}"
done; echo
```

Attendu : les premières réponses métier, puis des `429`. Le seuil est
volontairement bas (10/min) — une coupure moteur n'est jamais une opération de
masse, et un pic ici est un signal d'alerte.

---

## 4. Traces — la preuve d'audit

```sql
-- la commande et son garde-fou
SELECT command_type, status, reason,
       speed_at_request_kph, safety_speed_limit_kph,
       requested_by, validated_by, expires_at
FROM device_commands ORDER BY requested_at DESC;

-- le valideur DOIT être différent du demandeur
SELECT (requested_by <> validated_by) AS quatre_yeux_respecte
FROM device_commands WHERE validated_by IS NOT NULL;

-- Transactional Outbox : écrit dans la transaction métier
SELECT topic, status, available_at FROM outbox_messages ORDER BY id;

-- journal d'audit append-only
SELECT occurred_at, actor_type, actor_ip, action, resource_type
FROM audit_logs ORDER BY occurred_at DESC LIMIT 10;
```

Résultat obtenu lors de la validation :

```
 status   | vitesse | valide
----------+---------+--------
 approved |    0.00 | t

 topic                             | status
-----------------------------------+---------
 security.immobilization.requested | pending
 security.immobilization.validated | pending
```

### Vérifier que l'append-only tient

Après exécution de `01_roles_and_grants.sql`, en tant que `sisbm_app` :

```sql
-- doit ÉCHOUER : permission denied
DELETE FROM audit_logs WHERE true;
UPDATE positions SET speed_kph = 0;
```

C'est ce qui transforme une règle de gouvernance en garantie technique.

---

## 5. Grille de recette Jalon 1

| #   | Critère                      | Vérification                            |
| --- | ---------------------------- | --------------------------------------- |
| 1   | Schéma de base complet       | §2.1 — 36 tables, PostGIS actif         |
| 2   | Contraintes métier en base   | §2.2 — 12/12                            |
| 3   | Partitionnement opérationnel | §2.1 et §2.3                            |
| 4   | Migrations réversibles       | `node ace migration:rollback --batch=0` |
| 5   | Requêtes géospatiales        | §2.4                                    |
| 6   | Architecture conforme        | `npm run arch` — 5/5                    |
| 7   | Domaine testé sans base      | `node ace test unit` — 17/17            |
| 8   | API authentifiée             | §3.2                                    |
| 9   | **Garde-fou de vitesse**     | §3.3 cas 2                              |
| 10  | Séparation des rôles         | §3.4                                    |
| 11  | Traçabilité                  | §4                                      |
| 12  | Déploiement conteneurisé     | `docker compose ... up -d --build`      |

---

## 6. Points restant à trancher avec SISBM

1. **Node.js 24** sur les postes et le VPS
2. Mono-tenant ou multi-tenant
3. Fréquence d'émission des trackers et taille de flotte cible
4. Seuil de vitesse d'immobilisation (actuellement 5 km/h) et circuit de validation
5. Durées de rétention légales (conformité ARTCI)
6. Matrice définitive des rôles et permissions
