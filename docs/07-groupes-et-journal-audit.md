# SISBM CORE — Groupes et journal d'audit

**Jalon 2 · extension des routes** — groupes de véhicules, groupes de boîtiers, consultation de `audit_logs`.

---

## 1. Routes

### Groupes (organisation de l'acteur)

| Route                                                  | Habilitation    |
| ------------------------------------------------------ | --------------- |
| `GET /api/v1/vehicle-groups`                           | `vehicle:read`  |
| `POST /api/v1/vehicle-groups`                          | `vehicle:write` |
| `GET /api/v1/vehicle-groups/:id`                       | `vehicle:read`  |
| `PATCH /api/v1/vehicle-groups/:id`                     | `vehicle:write` |
| `DELETE /api/v1/vehicle-groups/:id`                    | `vehicle:write` |
| `GET /api/v1/vehicle-groups/:id/vehicles`              | `vehicle:read`  |
| `POST /api/v1/vehicle-groups/:id/vehicles`             | `vehicle:write` |
| `DELETE /api/v1/vehicle-groups/:id/vehicles/:memberId` | `vehicle:write` |
| `GET /api/v1/vehicle-groups/:id/audit-logs`            | `audit:read`    |

Les mêmes routes existent pour les boîtiers sous `/api/v1/device-groups` et `/devices`,
avec les habilitations `device:read` / `device:write`.

### Groupes créés POUR une organisation (exploitant plateforme)

| Route                                           | Habilitation          |
| ----------------------------------------------- | --------------------- |
| `GET  /api/v1/organizations/:id/vehicle-groups` | `vehicle:read` + `*`  |
| `POST /api/v1/organizations/:id/vehicle-groups` | `vehicle:write` + `*` |
| `GET  /api/v1/organizations/:id/device-groups`  | `device:read` + `*`   |
| `POST /api/v1/organizations/:id/device-groups`  | `device:write` + `*`  |

Viser une organisation qui n'est pas la sienne sans le joker `*` donne un **403 E_FORBIDDEN**,
jamais une liste vide : une tentative doit être lisible dans les journaux.

### Journal d'audit

| Route                                       | Portée                                           |
| ------------------------------------------- | ------------------------------------------------ |
| `GET /api/v1/audit-logs`                    | son organisation ; toutes pour `super_admin`     |
| `GET /api/v1/audit-logs/actions`            | valeurs distinctes d'`action` (filtres du front) |
| `GET /api/v1/organizations/:id/audit-logs`  | une organisation désignée                        |
| `GET /api/v1/vehicle-groups/:id/audit-logs` | le groupe, ses véhicules, leurs commandes        |
| `GET /api/v1/device-groups/:id/audit-logs`  | le groupe, ses boîtiers, leurs commandes         |

Filtres communs : `page`, `perPage` (≤ 200), `from`, `to`, `action`, `resourceType`, `resourceId`,
`actorId`, `organizationId` (réservé à l'exploitant).

## 2. Migration 013

- `device_groups` et `device_group_members`, symétriques de `vehicle_groups` / `vehicle_group_members`.
- Trigger `sisbm_check_group_member_tenant()` posé sur les **deux** tables d'association : un membre
  et son groupe doivent appartenir à la même organisation (`CM-17`). Cette règle traverse deux tables,
  aucune clé étrangère ne l'exprime — d'où le trigger, en plus du contrôle applicatif.
- Habilitation `audit:read` ajoutée au rôle système `admin`.

## 3. Choix d'implémentation

**Un seul socle pour les deux familles de groupes** (`group_controller_base.ts`) : les tables sont
identiques à un nom près, et une divergence de comportement entre « groupe de véhicules » et
« groupe de boîtiers » serait une surprise, pas une fonctionnalité.

**Affectation idempotente.** `POST .../vehicles` accepte un lot (≤ 200) et répond en trois ensembles :

```json
{ "data": { "applied": ["…"], "unchanged": ["…"], "rejected": ["…"] } }
```

Réémettre la même sélection n'est pas une erreur — le tableau de bord le fait naturellement.
Un lot **entièrement** rejeté donne un 422 `E_MEMBERS_OUT_OF_SCOPE` plutôt qu'un 200 trompeur.
Les identifiants inconnus, supprimés ou appartenant à une autre organisation sont indistinguables
dans la réponse : on ne révèle pas le parc des autres clients.

**Fenêtre temporelle obligatoire.** `audit_logs` est partitionnée par mois : 30 jours glissants par
défaut, 366 jours au maximum (`E_WINDOW_TOO_WIDE`). Sans borne, une recherche lirait toutes les
partitions.

**L'audit d'un groupe réunit trois ensembles** : le groupe lui-même, ses membres, et les
**commandes** émises sur ces membres. Sans le troisième, l'écran manquerait les immobilisations,
tracées sous `device_command` et non sous `vehicle`.

**Lecture par un port.** `AuditLogReader` (application) + `LucidAuditLogReader` (infrastructure) :
la présentation ne touche jamais la base (`npm run arch`). Même chose pour l'appartenance aux
groupes, qui porte la règle de cloisonnement.

**Traçabilité des groupes.** Création, modification, suppression et mouvements de membres écrivent
dans `audit_logs` sous `fleet.vehicle_group.*` / `fleet.device_group.*` — le CRUD véhicules et
boîtiers du Jalon 2 phase 1, lui, ne trace encore rien.

## 4. Recette

```bash
node ace migration:run
node ace test unit          # 74 tests (dont 8 sur la fenêtre d'audit)
```

Scénarios HTTP : section « GROUPES & JOURNAL D'AUDIT » de `requests.http`.

## 5. Points ouverts

- Le CRUD véhicules / boîtiers n'écrit pas encore d'audit : les journaux de groupe montreront donc
  les mouvements de groupe, pas encore les modifications de fiche véhicule.
- `GET /audit-logs` sans `organizationId` pour un `super_admin` lit toutes les organisations : prévoir
  un export paginé côté exploitation plutôt qu'une consultation écran au-delà de quelques milliers
  de lignes.
- Purge et archivage : `sisbm_detach_old_partitions('audit_logs', n)` existe mais n'est pas encore
  branché sur une tâche planifiée (cf. README, Jalon 2).
