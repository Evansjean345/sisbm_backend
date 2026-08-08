# SISBM CORE — Gouvernance des données

**Jalon 1 — Livrable : spécifications détaillées**
Version : 0.1 — à valider par SISBM

---

## a. Gouvernance des données

### Classification

| Classe | Données concernées | Traitement |
|---|---|---|
| **C3 — Sensible** | Positions GPS, trajets, commandes d'immobilisation, journaux d'audit | Chiffrement au repos et en transit, accès tracé, jamais dans les logs applicatifs |
| **C2 — Interne** | Véhicules, trackers, geofences, politiques, alertes, incidents | Accès restreint par rôle |
| **C1 — Technique** | Trames brutes, métriques, files de traitement | Rétention courte |
| **C0 — Public** | Référentiels (marques, modèles, types) | Sans restriction |

**Point d'attention réglementaire.** Une position GPS rattachée à un véhicule conduit et
identifiable constitue une **donnée à caractère personnel indirecte**. En Côte d'Ivoire, la
loi n° 2013-450 relative à la protection des données à caractère personnel s'applique, sous
contrôle de l'**ARTCI**. Trois obligations pratiques en découlent, à confirmer avec le
responsable conformité de SISBM :

- déclaration du traitement auprès de l'ARTCI ;
- information des conducteurs sur la géolocalisation de leur véhicule ;
- durée de conservation proportionnée et justifiée (d'où le §2-d du document de modélisation).

*Ce point n'est pas un livrable technique du MVP, mais il conditionne les durées de rétention
codées dans les scripts de purge. Il doit être arbitré avant la mise en production (Jalon 4).*

### Rôles et responsabilités

| Rôle | Titulaire | Périmètre |
|---|---|---|
| Propriétaire des données | **SISBM** | Décide des finalités, des durées de rétention, des accès |
| Responsable technique | Prestataire (Jalons 1–4), puis SISBM | Schéma, migrations, sauvegardes, qualité |
| Administrateur applicatif | Utilisateur SISBM `admin` | Comptes, rôles, geofences, politiques |
| Superviseur | Utilisateur SISBM `supervisor` | Alertes, incidents, validation des immobilisations |
| Consultation | Utilisateur SISBM `viewer` | Lecture seule |

### Rôles PostgreSQL (moindre privilège)

| Rôle SQL | Droits | Usage |
|---|---|---|
| `sisbm_owner` | Propriétaire du schéma, DDL | Migrations uniquement, jamais utilisé par l'application |
| `sisbm_app` | `SELECT, INSERT, UPDATE` métier ; **pas de `DELETE`** sur les tables append-only ; pas de DDL | Runtime AdonisJS |
| `sisbm_readonly` | `SELECT` | Rapports, réplica, exploration DBeaver |
| `sisbm_backup` | `pg_read_all_data` | Sauvegardes |

Le retrait explicite du droit `DELETE` sur `positions`, `events`, `audit_logs` et
`sms_transactions` transforme une règle de gouvernance en **garantie technique** : même une
erreur de code ne peut pas effacer une preuve.

---

## b. Propriété des données

Conformément au **§V.6 du TDR (clause de réversibilité)** :

- L'intégralité des données appartient à **SISBM**, sans réserve ni délai.
- Les comptes tiers (Flespi, passerelle SMS, WhatsApp Business, hébergement) sont ouverts **au
  nom de SISBM**, qui en détient les accès administrateur.
- Le prestataire ne conserve **aucune copie** de la base de production après le transfert
  (Jalon 4). Les jeux de données de développement sont **anonymisés** (cf. §e).
- À tout moment, SISBM peut exiger : un `pg_dump` complet, le schéma DDL, les scripts de
  migration, les procédures de restauration.
- **Aucun format propriétaire.** PostgreSQL, PostGIS, SQL standard. Un export `pg_dump` est
  restaurable sur n'importe quelle instance PostgreSQL 16 sans dépendance au code applicatif.

---

## c. Conventions et standards

### Nommage SQL (rappel — normatif)

| Objet | Convention | Exemple |
|---|---|---|
| Table | pluriel, `snake_case` | `device_commands` |
| Colonne | `snake_case` | `acknowledged_at` |
| Clé primaire | `id` | — |
| Clé étrangère | `<singulier>_id` | `vehicle_id` |
| Booléen | `is_` / `has_` | `is_active`, `has_relay` |
| Instant | suffixe `_at` (`timestamptz`) | `created_at` |
| Date | suffixe `_on` (`date`) | `insured_on` |
| **Grandeur physique** | **unité dans le nom** | `speed_kph`, `distance_m`, `duration_s` |
| Montant | `<nom>_amount` + `currency` | `cost_amount` |
| Index | `idx_<table>_<colonnes>` | `idx_positions_vehicle_recorded` |
| Index unique | `uq_<table>_<colonnes>` | `uq_devices_imei` |
| Contrainte check | `ck_<table>_<règle>` | `ck_positions_speed_positive` |
| Clé étrangère | `fk_<table>_<table_cible>` | `fk_alerts_events` |
| Contrainte d'exclusion | `ex_<table>_<règle>` | `ex_device_assignments_device_period` |

### Standards de données

| Domaine | Standard | Application |
|---|---|---|
| Temps | ISO 8601 / UTC | Stockage `timestamptz`, API en UTC, affichage `Africa/Abidjan` |
| Géographie | WGS 84 (EPSG:4326) | `geography(...,4326)` partout |
| Pays / devise | ISO 3166-1 / ISO 4217 | `CI`, `XOF` |
| Téléphone | **E.164** | `+2250161899990` — normalisé à l'écriture, sans exception |
| Langue | ISO 639-1 | `fr` par défaut |
| Immatriculation | Normalisée majuscules sans espaces à l'écriture | Stockage `citext` |
| IMEI | 15 chiffres, validé Luhn à la saisie | `CHECK (imei ~ '^[0-9]{15}$')` |

### Standards de code

- Migrations **AdonisJS/Lucid en SQL brut** (`this.schema.raw`) — voir la note d'arbitrage dans
  `database/migrations/README.md`.
- Une migration = **un thème fonctionnel**, jamais un fourre-tout.
- Toute migration a un `down()` **réellement testé**.
- Validation d'entrée par **VineJS** au niveau des contrôleurs, en **doublon** des `CHECK` SQL.
  La base est le dernier rempart, pas le premier.
- Aucun secret en base ni dans le dépôt : `.env` hors Git, secrets webhook stockés **hachés**.

---

## d. Processus de changement des données

### Changement de structure (DDL)

```
Besoin → Migration Lucid + down() → Revue → Test sur base de dev
      → Test sur copie anonymisée de la prod → Sauvegarde
      → Application en production → Vérification → Mise à jour du schéma documenté
```

**Règles absolues :**
1. **Aucun DDL manuel en production.** DBeaver sert à *lire* et à *diagnostiquer*, jamais à
   modifier la structure. Toute modification passe par une migration versionnée dans Git —
   c'est ce qui garantit qu'un autre développeur peut reconstruire la base à l'identique
   (exigence §IV.2 du TDR).
2. **Migrations expand / contract** pour les changements risqués : on ajoute la nouvelle
   colonne, on double l'écriture, on migre les données, on bascule la lecture, **puis seulement**
   on supprime l'ancienne — sur une release ultérieure.
3. `CREATE INDEX CONCURRENTLY` obligatoire sur `positions` et `events` en production.
4. Sauvegarde **systématique** avant migration sur données existantes.

### Changement de données (DML)

| Type | Traçabilité |
|---|---|
| Création / modification métier via l'API | `audit_logs` (acteur, IP, avant/après) |
| Ingestion automatique | `ingest_messages` |
| Correction ponctuelle en production | **Script SQL versionné dans Git**, exécuté par le rôle `sisbm_owner`, avec ticket, sauvegarde préalable et compte rendu |
| Purge par rétention | Tâche planifiée documentée, journalisée |

**Ce qui est formellement interdit en production :** `UPDATE`/`DELETE` sans `WHERE` ; modification
directe d'un solde `sms_accounts` sans écriture d'une `sms_transaction` correspondante ;
suppression d'une ligne d'`audit_logs`.

---

## e. Qualité et cohérence des données

### Dimensions et contrôles

| Dimension | Contrôle | Où |
|---|---|---|
| **Exactitude** | Rejet des positions `hdop > 5` ou `satellites < 4` → marquées `is_valid = false` plutôt que supprimées | Ingestion |
| **Complétude** | `NOT NULL` sur tout ce qui est structurant ; tableau de bord « véhicules sans tracker », « trackers sans véhicule » | SQL + UI |
| **Cohérence** | `CHECK` + `EXCLUDE` + `FOREIGN KEY` | Base |
| **Unicité** | Index uniques + clés d'idempotence | Base |
| **Fraîcheur** | Alerte technique si `last_seen_at` d'un device dépasse le seuil (défaut : 30 min) | Supervision |
| **Plausibilité** | Détection de « téléportation » : vitesse implicite entre deux points > 250 km/h → position marquée invalide | Ingestion |
| **Continuité** | Écart entre `recorded_at` et `received_at` > 5 min → trame de Store & Forward, traitée en rattrapage et **exclue** du temps réel | Ingestion |

### Le filtrage des positions aberrantes est un enjeu de crédibilité

Les trackers GPS bas coût produisent régulièrement des points parasites : dérive au démarrage
à froid, réflexion multi-trajets en zone urbaine dense, position `(0,0)` en cas de perte de fix.
Sans filtrage, un rapport kilométrique devient inexploitable et une geofence déclenche de fausses
alertes qui décrédibilisent tout le système auprès des exploitants.

Trois filtres appliqués à l'ingestion, dans cet ordre :
1. **Rejet du point nul** — `ST_X = 0 AND ST_Y = 0`.
2. **Filtre de qualité** — `hdop`, nombre de satellites, `is_valid` du protocole.
3. **Filtre de plausibilité cinématique** — distance / délai depuis le point valide précédent.

Les points écartés sont **conservés** avec `is_valid = false`. On ne détruit jamais une donnée
brute : on la qualifie. Cela permet de rejouer avec des seuils différents si les filtres se
révèlent trop stricts.

### Contrôles automatisés

- **Continus** : à chaque ingestion (règles ci-dessus).
- **Quotidiens** : trajets ouverts depuis plus de 24 h, comptes SMS sous seuil, trackers muets,
  véhicules actifs sans affectation.
- **Hebdomadaires** : rapprochement `sms_accounts.balance_credits` ↔ somme des
  `sms_transactions` ; comptage des positions invalides par device (un device au-dessus de 5 %
  signale un problème matériel).

---

## f. Lecture et écriture des données

### Chemin d'écriture

```
Tracker → Flespi → [MQTT / Webhook] → Ingestion AdonisJS
   → validation & filtrage
   → TRANSACTION { ingest_message · position · last_position · event · alert · outbox }
   → Redis (workers) → notifications · webhooks · commandes
```

**Règles :**
- Écriture **uniquement** via les services applicatifs. Aucune écriture directe en base.
- Insertion **par lot** (`COPY` ou multi-row `INSERT`) lorsque Flespi livre des paquets groupés —
  typiquement au retour d'une zone blanche.
- Toute écriture externe passe par une **clé d'idempotence**.
- `positions` est **append-only** : jamais d'`UPDATE`, jamais de `DELETE` (hors drop de partition).

### Chemin de lecture

| Besoin | Source | Pourquoi |
|---|---|---|
| Carte temps réel | `vehicle_last_positions` | N lignes, index couvrant, réponse < 10 ms |
| Détail d'un véhicule | `vehicles` + jointure `device_assignments` courante | — |
| Relecture d'un trajet | `positions` filtrée `(vehicle_id, recorded_at)` | *Partition pruning* + index composite |
| Liste des trajets | `trips` | Pré-agrégé, jamais recalculé |
| Rapports mensuels | `trips`, `events`, vues matérialisées | Aucune agrégation lourde à la volée |
| KPI tableau de bord | Vues matérialisées | Rafraîchies la nuit |
| Export volumineux | `report_jobs` → worker → fichier | Hors requête HTTP |

**Règles :**
- **Pagination obligatoire** sur toute collection, par **curseur** (`recorded_at`, `id`) et non
  par `OFFSET` — un `OFFSET 500000` sur `positions` est un scan complet.
- **Bornes temporelles obligatoires** sur toute requête touchant `positions`. Sans clause sur
  `recorded_at`, le *partition pruning* ne s'applique pas et la requête scanne toute l'année.
- **Simplification géométrique** (`ST_SimplifyPreserveTopology`) pour l'affichage d'un long
  trajet : inutile d'envoyer 8 000 points à Leaflet pour tracer une polyligne à l'écran.
- Diffusion temps réel par **WebSocket**, poussée depuis l'ingestion — les clients ne
  *pollent* jamais la base.
- Cache Redis court (30–60 s) sur les agrégats de tableau de bord uniquement. **Jamais** sur les
  positions ni sur les alertes : une donnée de sécurité périmée est pire qu'une donnée absente.

### Environnements et anonymisation

| Environnement | Données |
|---|---|
| Production | Données réelles, accès nominatif tracé |
| Recette | Copie de production **anonymisée** |
| Développement | Jeu de données synthétique (*seeders*) |

Anonymisation : e-mails et téléphones remplacés, immatriculations pseudonymisées, coordonnées
GPS translatées d'un décalage aléatoire constant par véhicule (la forme des trajets reste
réaliste pour les tests, les lieux réels ne sont plus identifiables).
