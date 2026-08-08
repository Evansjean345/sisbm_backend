# Migrations — règles et arbitrages

## Pourquoi du SQL brut plutôt que le query builder Knex ?

Les migrations utilisent `this.schema.raw()` avec du SQL PostgreSQL explicite. C'est un choix,
pas une facilité :

1. **Le query builder ne sait pas exprimer ce dont ce projet a besoin.** Tables partitionnées,
   contraintes `EXCLUDE USING gist`, index partiels, types `geography`, `tstzrange` : rien de
   tout cela n'est couvert par l'API Knex. Une migration mi-builder mi-raw serait plus confuse
   qu'une migration entièrement en SQL.
2. **Le SQL est directement rejouable dans DBeaver.** On peut copier une définition de table,
   l'exécuter, la comparer à l'existant. C'est ce qui rend le schéma vérifiable par un tiers.
3. **Réduction de la dépendance technique (TDR §IV.2).** Un développeur PostgreSQL lit ce fichier
   sans connaître Knex. L'inverse n'est pas vrai.

Les modèles Lucid, eux, fonctionnent normalement au-dessus de ce schéma.

## Ordre des migrations

| #   | Fichier                                 | Contenu                                                                |
| --- | --------------------------------------- | ---------------------------------------------------------------------- |
| 1   | `enable_extensions`                     | postgis, btree_gist, citext, pgcrypto, pg_trgm + fonctions utilitaires |
| 2   | `create_identity_tables`                | organizations, roles, users, auth_access_tokens                        |
| 3   | `create_fleet_tables`                   | vehicle_groups, vehicles, devices, device_assignments                  |
| 4   | `create_telemetry_tables`               | ingest_messages, positions, vehicle_last_positions, trips              |
| 5   | `create_geofencing_tables`              | geofences, usage_schedules, geofence_states                            |
| 6   | `create_policy_engine_tables`           | policies, targets, actions, executions                                 |
| 7   | `create_events_alerts_incidents_tables` | events, alerts, incidents                                              |
| 8   | `create_notifications_billing_tables`   | notifications, sms_accounts, sms_transactions                          |
| 9   | `create_device_commands_tables`         | device_commands, device_command_logs                                   |
| 10  | `create_integration_audit_tables`       | api_clients, webhooks, outbox, audit_logs, report_jobs                 |

L'ordre est contraint par les clés étrangères. Une seule FK est posée en différé
(`policy_executions.event_id`, migration 7) car `events` est créée après `policy_executions`.

## Règles

- **Une migration = un thème.** Jamais de fourre-tout.
- **Tout `up()` a un `down()` réellement testé.** `node ace migration:rollback` doit rendre une
  base propre.
- **Aucune migration livrée n'est modifiée après application en production.** On en écrit une
  nouvelle.
- **En production**, sur `positions` et `events` : `CREATE INDEX CONCURRENTLY` uniquement
  (hors transaction — utiliser `this.disableTransactions = true` dans la migration concernée).
- **Sauvegarde obligatoire** avant toute migration touchant des données existantes.
- Changement risqué → **expand / contract** : ajouter, double-écrire, migrer, basculer la
  lecture, puis supprimer l'ancien sur une release ultérieure.

## Test de la contrainte la plus importante

CM-01/CM-02 : un tracker ne peut pas être sur deux véhicules à la fois.

```sql
-- doit réussir
INSERT INTO device_assignments (device_id, vehicle_id, period)
VALUES ('<device>', '<vehicle_a>', tstzrange(now(), NULL));

-- doit ÉCHOUER : conflict on exclusion constraint ex_device_assignments_device
INSERT INTO device_assignments (device_id, vehicle_id, period)
VALUES ('<device>', '<vehicle_b>', tstzrange(now(), NULL));
```

Si la seconde insertion passe, `btree_gist` n'est pas installée — la migration 1 a échoué
silencieusement.
