# SISBM CORE — Architecture du backend

**Jalon 1 — Livrable : architecture validée, environnement de développement**
AdonisJS 7 · Node.js 24 · PostgreSQL 16 + PostGIS 3.4 · Redis 7
Version : 0.1 — à valider par SISBM

---

## 1. Décision de version : AdonisJS 7

AdonisJS 7 est sorti le **25 février 2026**, stabilisé en 7.3.5 en juillet 2026.
L'offre technique mentionnait AdonisJS 6.

Vérification faite sur les _peer dependencies_ de l'écosystème complet :

| Paquet               | Version courante | Core requis   |
| -------------------- | ---------------- | ------------- |
| `@adonisjs/lucid`    | 22.4.2           | `^7.0.0`      |
| `@adonisjs/auth`     | 10.1.0           | `^7.0.0`      |
| `@adonisjs/redis`    | 10.0.0           | `^7.0.0`      |
| `@adonisjs/mail`     | 10.4.0           | `^7.0.0`      |
| `@adonisjs/transmit` | 3.0.1            | `^7.0.0-next` |
| `@adonisjs/limiter`  | 3.0.1            | `^7.0.0`      |

Rester en v6 imposerait d'épingler manuellement une version ancienne de **chaque**
paquet, et de démarrer un projet assorti de 90 jours de garantie sur une base déjà
en fin de cycle. La v7 est retenue.

> **Contrainte induite, à valider par SISBM :** AdonisJS 7 et Lucid 22 déclarent
> `engines.node >= 24`. Cela concerne les postes de développement, l'image Docker
> et le VPS de production.

### Différences v6 → v7 rencontrées

Quatre points ont demandé une adaptation ; ils sont documentés ici parce qu'ils
ne figurent dans aucun starter public à ce jour :

1. **`config/encryption.ts` est obligatoire.** La clé n'est plus dérivée
   implicitement d'`APP_KEY` ; les encrypteurs sont déclarés explicitement, avec
   un tableau de clés permettant la rotation.
2. **Le transpileur passe de `ts-node-maintained` à `@poppinss/ts-exec`.**
   `ace.js` doit importer `@poppinss/ts-exec`. Utiliser une version < 1.4 casse la
   résolution des imports de sous-chemins (`#start/env` se résout relativement au
   fichier importateur au lieu de la racine du paquet).
3. **Bouncer 4 n'expose plus `ctx.bouncer`.** Les habilitations s'évaluent
   explicitement — voir `app/presentation/http/support/authorize.ts`. Le paquet
   a été retiré des dépendances : le conserver enregistré mais inutilisé serait
   du poids mort.
4. **Les motifs de test `*.spec(.ts|.js)` ne sont plus reconnus.** Il faut des
   globs explicites : `tests/unit/**/*.spec.ts`.

---

## 2. Vue d'ensemble

Organisation **par couches**, conformément à la Clean Architecture canonique.
Il n'existe **aucun dossier `shared/`** : les briques génériques du DDD vivent
dans la couche à laquelle elles appartiennent — le noyau dans `domain/`, les
ports dans `application/`, les adaptateurs dans `infrastructure/`.

```
app/
├── domain/                     règles métier d'entreprise — couche la plus interne
│   ├── kernel.ts               Entity, AggregateRoot, ValueObject, DomainEvent,
│   │                           Result, DomainError, TransactionScope
│   ├── security/               immobilisation contrôlée
│   │   ├── entities/           DeviceCommand (racine d'agrégat)
│   │   ├── value_objects.ts    Speed, Reason, identifiants typés, machine à états
│   │   ├── events.ts           événements de domaine
│   │   ├── errors.ts           erreurs métier à codes stables
│   │   └── repositories/       ports de dépôt (interfaces)
│   ├── fleet/  telemetry/  geofencing/  policy/  alerting/
│   ├── notification/  billing/  identity/  integration/
│
├── application/                règles métier applicatives
│   ├── ports.ts                UseCase, UnitOfWork, Clock, IdGenerator,
│   │                           EventPublisher, AuditLogger, PermissionReader
│   └── security/
│       ├── ports.ts            VehicleStateReader, DeviceCommandGateway
│       └── use_cases/          RequestImmobilization, ValidateImmobilization
│
├── infrastructure/             frameworks et pilotes
│   ├── persistence/
│   │   ├── models/             modèles Lucid
│   │   ├── repositories/       implémentations des ports de dépôt
│   │   ├── readers/            lectures inter-contextes
│   │   ├── unit_of_work.ts     transactions + outbox
│   │   ├── outbox_publisher.ts
│   │   └── audit_logger.ts
│   ├── services/               clock.ts, id_generator.ts
│   └── gateways/               Flespi, passerelle SMS
│
└── presentation/               adaptateurs d'interface
    └── http/
        ├── controllers/        par contexte
        ├── validators/         schémas VineJS
        ├── middleware/
        ├── support/            execution_context.ts, authorize.ts
        └── exception_handler.ts
```

Alias d'import alignés sur les couches, ce qui rend toute violation visible
à la lecture d'une simple ligne d'`import` :

```
#domain/*  ·  #application/*  ·  #infrastructure/*  ·  #presentation/*
```

### La règle de dépendance

```
presentation ──▶ application ──▶ domain
       │              │
       └──────────────┴──▶ infrastructure  (implémente les ports)
```

`domain/` n'importe **rien** : ni AdonisJS, ni Lucid, ni Luxon, ni HTTP.
`application/` ne connaît que `domain/` (plus le décorateur `@inject`).

### Contrôle automatisé

L'organisation par couches rend la vérification triviale — une commande par
couche, au lieu d'itérer sur dix contextes :

```bash
npm run arch
```

```
✓ domain n'importe aucun framework
✓ domain n'importe aucune autre couche
✓ application n'importe pas infrastructure/presentation
✓ application n'importe pas Lucid
✓ aucun accès direct à la base hors infrastructure
```

`scripts/check-architecture.sh` est branché dans `npm run check` et doit
casser la CI en cas de violation. Ce n'est pas théorique : lors de sa
première exécution, il a détecté deux régressions réelles — un port de dépôt
du domaine qui importait `#application/ports`, et un module de présentation
qui appelait `db` directement.

### Le compromis assumé

Une organisation par couches n'empêche pas, en soi, `domain/fleet` d'importer
`domain/billing` : les frontières entre contextes ne sont plus matérialisées
par l'arborescence. C'est le prix de la conformité stricte à la Clean
Architecture. Si le couplage inter-contextes devient un problème, la parade
est une règle ESLint `no-restricted-imports` par contexte — à ajouter au
moment où le besoin se manifeste, pas avant.

## 3. DDD calibré — le point le plus important

Appliquer la Clean Architecture stricte aux dix contextes reviendrait à écrire
**quatre fichiers par CRUD** là où un contrôleur et un modèle Lucid suffisent.
Sur un MVP de quinze semaines assorti d'une clause explicite contre la
sur-architecture, c'est un risque de planning réel.

La profondeur des couches est donc **calibrée par contexte** :

| Contexte       | Style           | Justification                                                                     |
| -------------- | --------------- | --------------------------------------------------------------------------------- |
| `security`     | **DDD strict**  | Coupe le moteur d'un véhicule. Invariants nombreux, conséquences physiques.       |
| `policy`       | **DDD strict**  | Moteur de règles : logique combinatoire, évolutive, à tester massivement.         |
| `billing`      | **DDD strict**  | Argent. Grand livre, solde, atomicité.                                            |
| `telemetry`    | **DDD partiel** | Filtrage et reconstitution de trajets = vraie logique ; le stockage reste direct. |
| `alerting`     | **DDD partiel** | Cycle de vie des alertes et incidents modélisé ; le reste en lecture directe.     |
| `fleet`        | **Pragmatique** | CRUD. Contrôleur → Lucid. Les invariants sont en base (`EXCLUDE`, `CHECK`).       |
| `identity`     | **Pragmatique** | CRUD + authentification.                                                          |
| `geofencing`   | **Pragmatique** | CRUD + requêtes PostGIS.                                                          |
| `notification` | **Pragmatique** | Adaptateurs de canaux, peu de règles.                                             |
| `integration`  | **Pragmatique** | Plomberie.                                                                        |

Le **découpage en bounded contexts est partout** ; seule la profondeur varie.
On garde la testabilité là où elle compte, sans payer l'abstraction sur `GET /vehicles`.

> Cette calibration est une proposition. Si SISBM préfère l'uniformité stricte,
> le surcoût estimé est de l'ordre de deux à trois semaines sur le Jalon 2.

---

## 4. Tranche verticale de référence : l'immobilisation

Le contexte `security` est implémenté de bout en bout. Il sert de modèle pour
les suivants.

### L'agrégat porte les règles

`DeviceCommand` (`domain/entities/device_command.ts`) est la **seule** porte
d'entrée. Contrôleur HTTP, worker de file et moteur de politiques passent tous
par ses méthodes : aucun chemin ne contourne les invariants.

| Invariant                                                 | Où                                       |
| --------------------------------------------------------- | ---------------------------------------- |
| CM-07 — aucune coupure au-dessus du seuil de vitesse      | agrégat **et** `CHECK` SQL               |
| CM-08 — motif obligatoire et substantiel                  | objet-valeur `Reason` **et** `CHECK` SQL |
| Séparation des rôles — le valideur n'est pas le demandeur | agrégat **et** `CHECK` SQL               |
| CM-09 — une seule commande en vol par tracker             | cas d'usage **et** index unique partiel  |
| Machine à états                                           | table `ALLOWED_TRANSITIONS`, déclarative |
| Expiration (TTL 15 min)                                   | agrégat                                  |

La double implantation domaine + base n'est pas une redondance inutile : le
domaine produit des messages exploitables par l'utilisateur, la base garantit
qu'aucun bug — ni aucun script lancé à la main — ne peut écrire un état interdit.

### La vitesse est vérifiée trois fois

À la **demande**, à la **validation**, à la **mise en file**. Le scénario est
concret : une demande faite véhicule à l'arrêt, un superviseur qui valide deux
minutes plus tard, et entre-temps le véhicule est reparti. Un contrôle unique
serait dangereux.

S'ajoute un contrôle de **fraîcheur de position** : une position vieille de dix
minutes ne prouve pas que le véhicule est à l'arrêt. Au-delà du seuil configuré,
la demande est refusée.

### `Result<T, E>` plutôt que des exceptions

Une règle métier violée n'est pas un incident technique : c'est un résultat
attendu. On la retourne, on ne la lance pas.

```ts
const result = await requestImmobilization.execute(input)
if (!result.ok) {
  return response.status(result.error.httpStatus).send({ error: result.error.toJSON() })
}
```

Le compilateur force l'appelant à traiter le cas d'échec — ce qu'un `throw` ne
fait jamais. Les exceptions restent réservées aux pannes réelles.

### Le temps est une dépendance

Le port `Clock` est injecté. Sans lui, aucune règle temporelle — expiration,
fenêtre horaire, cooldown de politique — ne serait testable sans attendre.

---

## 5. Transactions et cohérence

### Unit of Work avec isolation explicite

```ts
await unitOfWork.run(
  async (tx) => {
    /* ... */
  },
  { isolationLevel: 'serializable' }
)
```

Le niveau d'isolation est un paramètre du cas d'usage, pas une constante globale :
l'ingestion de positions tourne en `read committed`, une commande d'immobilisation
en `serializable` (cf. document de modélisation §2-c).

### Transactional Outbox

Les événements de domaine sont écrits dans `outbox_messages` **dans** la
transaction métier, et publiés par un worker **après** le commit.

Aucun appel réseau n'a lieu pendant une transaction. C'est ce qui évite qu'un SMS
parte pour une alerte dont le `COMMIT` a finalement échoué — sans recourir à une
transaction distribuée.

### Conflits de sérialisation

Sous isolation `serializable`, PostgreSQL peut rejeter une transaction
(SQLSTATE `40001`). Ce n'est pas un bug : c'est le mécanisme qui fonctionne. Le
gestionnaire d'exceptions le traduit en `409 E_CONCURRENT_MODIFICATION` avec un
en-tête `Retry-After`.

---

## 6. Sécurité applicative

| Sujet            | Choix                                                 | Motif                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentification | Jetons opaques (`access_tokens`)                      | Révocables immédiatement. Sur une plateforme capable de couper un moteur, invalider une session compromise dans la seconde vaut le coût d'une lecture en base.                                                         |
| Habilitations    | RBAC plat, `roles.permissions text[]`                 | Format `ressource:action`, jokers `ressource:*` et `*`. Bouncer a été retiré : la v4 n'expose plus `ctx.bouncer`, et 40 lignes dans `authorize.ts` couvrent le besoin sans ajouter une couche de framework inutilisée. |
| Quatre yeux      | `command:request` ≠ `command:validate`                | Deux habilitations distinctes : un opérateur peut demander sans pouvoir valider.                                                                                                                                       |
| Débit            | 10 req/min sur `/security/*`                          | Une coupure moteur n'est jamais une opération de masse. Un pic ici est un signal d'alerte.                                                                                                                             |
| Erreurs          | Format unique `{ error: { code, message, details } }` | `code` = contrat d'API ; `message` = destiné aux humains, jamais parsé.                                                                                                                                                |
| Journalisation   | Règles métier violées **non** remontées en erreur     | Sinon les vraies pannes deviennent invisibles dans les journaux.                                                                                                                                                       |

---

## 7. État de validation

Vérifié en exécution réelle sur PostgreSQL 16.14 + PostGIS 3.4 + Redis 7 :

| Vérification                                        | Résultat                                            |
| --------------------------------------------------- | --------------------------------------------------- |
| `npm install` — résolution complète                 | ✅ aucun conflit de peer dependency                 |
| Chargement des 12 providers                         | ✅                                                  |
| `node ace migration:run` — 10 migrations du Jalon 1 | ✅ 10/10 `completed`                                |
| `node ace list:routes`                              | ✅ routes + middlewares `auth`, `sensitiveThrottle` |
| `npm run arch` — règle de dépendance                | ✅ 5/5 contrôles                                    |
| `npx tsc --noEmit`                                  | ✅ **0 erreur**                                     |
| `node ace test unit`                                | ✅ **17/17 en 43 ms**, sans base de données         |
| `node ace build`                                    | ✅ build de production généré                       |

Les 17 tests couvrent le garde-fou de vitesse (dont les cas limites à 5 et
5,1 km/h), le motif obligatoire, la séparation des rôles, la revérification à la
validation, l'expiration, la machine à états et l'émission des événements de
domaine. Aucun ne touche la base : c'est le bénéfice concret de la Clean
Architecture.

---

## 8. Docker

Image multi-étages sur `node:24-alpine`. L'image finale ne contient ni le
TypeScript source, ni les dépendances de développement, ni la chaîne de
compilation.

- `tini` en PID 1 : sans lui, Node ne reçoit pas correctement `SIGTERM` et
  l'arrêt gracieux (fermeture du pool PostgreSQL, drain des files) ne se fait pas.
- Exécution sans privilèges (utilisateur `node`).
- Sonde de santé sur `/health` : vérifie que le processus **répond**, pas
  seulement qu'il est vivant.
- **Les migrations ne sont pas jouées automatiquement.** Un déploiement qui migre
  tout seul peut casser la base sans qu'on l'ait décidé. `RUN_MIGRATIONS=true`
  reste possible en développement.
- Le worker est un **processus séparé** de l'API : un pic de génération de
  rapports ne doit pas dégrader la latence de l'ingestion GPS.

---

## 9. Reste à faire

**Jalon 1 (finalisation)**

- Seeders : organisation de test, véhicules, trackers, geofences sur Abidjan
- Schéma OpenAPI
- Commande `sisbm:worker` (dépilage outbox, expiration des commandes)
- Pipeline CI : lint, typecheck, tests, contrôle de la règle de dépendance

**Jalon 2**

- Contexte `telemetry` : client MQTT Flespi, filtrage qualité, reconstitution des
  trajets, diffusion Transmit
- Contextes `fleet` et `identity` en style pragmatique
- Modules restants selon la calibration du §3

---

## 10. Points à trancher avec SISBM

1. **Node.js 24** sur les postes et le VPS de production.
2. **Calibration du DDD** (§3) — uniformité stricte ou profondeur variable.
3. Mono-tenant ou multi-tenant (report du Jalon 1, cf. modélisation §0).
4. Fréquence d'émission des trackers et taille de flotte cible.
5. Seuil de vitesse d'immobilisation (proposition : 5 km/h) et circuit de validation.
6. Matrice définitive des rôles et permissions.
