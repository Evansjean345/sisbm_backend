# SISBM CORE — Organisations et comptes rattachés

**Jalon 2 · Phase 5** — création d'une organisation cliente et des utilisateurs qui lui sont rattachés.

---

## 1. Périmètre

| Route                                    | Habilitation         | Rôle         |
| ---------------------------------------- | -------------------- | ------------ |
| `GET    /api/v1/organizations`           | `organization:read`  | exploitant   |
| `POST   /api/v1/organizations`           | `organization:write` | exploitant   |
| `GET    /api/v1/organizations/:id`       | `organization:read`  | exploitant   |
| `PATCH  /api/v1/organizations/:id`       | `organization:write` | exploitant   |
| `GET    /api/v1/organizations/:id/users` | `organization:read`  | exploitant   |
| `POST   /api/v1/organizations/:id/users` | `organization:write` | exploitant   |
| `GET    /api/v1/organizations/:id/roles` | `organization:read`  | exploitant   |
| `POST   /api/v1/users` _(existant)_      | `user:write`         | admin client |

`organization:*` n'est porté par **aucun** rôle d'organisation : seul le joker `*` (`super_admin`) le couvre.
Un administrateur client continue de gérer ses comptes par `/users`, limité à son organisation.

**Aucune migration** : les tables `organizations`, `roles` et `users` du Jalon 1 couvrent le besoin.

## 2. Architecture

Le contexte Identité reste **pragmatique** pour les lectures (contrôleur → Lucid, cf. docs/03 §3).
Les **créations** sont promues en cas d'usage, sur le modèle de la tranche `security` :

```
domain/identity/
  role_policy.ts          covers(), missingPermissions(), isRoleInScope() — règles pures
  errors.ts               E_ORGANIZATION_CODE_TAKEN, E_EMAIL_TAKEN, E_ROLE_ESCALATION…
  events.ts               identity.organization.created, identity.user.created (outbox)
application/identity/
  ports.ts                OrganizationRepository, UserAccountRepository, RoleCatalog, PasswordHasher
  services/role_assignment.ts        point UNIQUE de contrôle d'attribution d'un rôle
  use_cases/create_organization.ts   organisation + 1er admin, une transaction
  use_cases/create_organization_user.ts  compte rattaché (partagé par /users et /organizations/:id/users)
infrastructure/
  persistence/models/organization_model.ts, role_model.ts
  persistence/repositories/identity_repositories.ts
  services/password_hasher.ts
presentation/http/
  controllers/identity/organization_controller.ts
  validators/identity/organization_validators.ts
```

Pourquoi promouvoir la création : elle est **transactionnelle** (organisation + admin : tout ou rien),
elle porte une **règle de sécurité**, et elle doit se **tester sans base** (`tests/unit/identity.spec.ts`).

## 3. Règles appliquées

1. **Cloisonnement** — un rôle attribuable est un rôle système ou un rôle de l'organisation cible.
   Rôle inconnu et rôle d'un autre client renvoient la même erreur (`E_INVALID_ROLE`), pour ne rien révéler.
2. **Non-escalade** — on n'accorde que ce que l'on détient : chaque habilitation du rôle doit être couverte par
   celles de l'acteur. Seul un `*` peut créer un `super_admin` (`403 E_ROLE_ESCALATION`).
3. **Organisation désactivée** — aucun nouveau compte (`409 E_ORGANIZATION_INACTIVE`).
4. **Unicité** — code d'organisation (parmi les non supprimées) et e-mail (global). Pré-contrôle pour un message
   clair ; la course résiduelle est tenue par les index uniques (`409`).
5. **Code immuable** — identifiant stable des intégrations tierces ; non modifiable par `PATCH`.
6. **Auto-désactivation interdite** — l'exploitant ne peut pas désactiver sa propre organisation.
7. **Traçabilité** — chaque création écrit un événement dans l'outbox et une ligne dans `audit_logs`, rangée dans
   le journal de l'organisation **cible**.

## 4. Correction de sécurité sur `/users`

Avant cette phase, `POST /users` et `PATCH /users/:id` acceptaient **tout rôle système**, y compris `super_admin` :
un administrateur client pouvait se créer un complice super-administrateur et sortir de son organisation.
Les deux routes passent désormais par `RoleAssignment` ; `GET /roles` expose un drapeau `assignable` pour que le
formulaire grise les rôles refusés. `user_controller.ts` n'accède plus à `db` directement (`npm run arch`).

## 5. Recette

```bash
node ace db:seed                  # 02_super_admin_seeder : superadmin@sisbm.ci / SuperAdmin2026!
node ace test unit                # 66 tests, dont 15 pour l'identité
```

Scénarios HTTP : section « JALON 2 · PHASE 5 » de `requests.http`.

## 6. Points ouverts

- Désactiver une organisation ne coupe pas encore les sessions de ses utilisateurs : il faudra faire vérifier
  `organizations.is_active` à la connexion et dans `authorize()`.
- Le premier administrateur reçoit un mot de passe fixé par l'exploitant : prévoir l'obligation de le changer à la
  première connexion (`password_changed_at IS NULL`) ou une invitation par e-mail (consommateur de
  `identity.user.created`).
