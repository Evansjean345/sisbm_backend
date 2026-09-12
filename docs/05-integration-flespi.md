# SISBM CORE — Jalon 2 : intégration flespi (Micodus MV730)

Ce document décrit les corrections apportées à l'intégration flespi, les nouveaux
endpoints et la procédure de test sur boîtier réel via MQTT.

---

## 1. Ce qui empêchait le boîtier de communiquer

| # | Constat (tests du 02infrastructure.md + code) | Conséquence | Correction |
|---|---|---|---|
| 1 | Canal `sisbm_channel` = protocole **micodus (325)**, device créé avec `device_type_id: 350` = **Jimi IoT (Concox) AT6, protocole 13** | Un device ne reçoit **que** les messages des canaux de son protocole : le device 8958982 ne recevra **jamais** rien du canal 1442013 | Le type est désormais résolu **dans le protocole du canal** (`FLESPI_DEVICE_TYPE=Micodus MV730`) ; un type d'un autre protocole est refusé (`E_FLESPI_DEVICE_TYPE_MISMATCH`) |
| 2 | Ident = IMEI (test) ou `0` + IMEI (support PDF) | flespi, protocole micodus : *« use the device ID (not IMEI) and add a leading zero »* | Règle par protocole (`flespi_ident.ts`) : micodus → `0` + ID boîtier (`terminalId`) ; ident contrôlé contre le schéma publié par flespi pour le type |
| 3 | `POST /gw/devices` envoyé avec `{ channel_id, ident, device_type_id: "Micodus MV730" }` | Rejeté : corps attendu = **tableau**, `ident` dans `configuration`, type **numérique**, pas de `channel_id` | `FlespiDeviceGateway.create()` réécrit selon la réponse réelle |
| 4 | Commandes envoyées à `POST /gw/devices/{id}/commands` avec `{ command_code, data }` | Format inexistant | `commands-queue` (défaut) ou `commands` (instantané) avec `[{ name, properties }]` ; MV730 : `custom { command_code, data }` |
| 5 | `GET /messages?limit=1&reverse=true` | Paramètres ignorés par flespi | Paramètres dans `?data={json}` |
| 6 | Worker d'ingestion branché sur Mosquitto local (supprimé), topic `sisbm/telemetry/+/data` | Aucune trame ingérée | Broker `mqtt.flespi.io:8883`, jeton en username, topic `flespi/message/gw/devices/+` |
| 7 | Contre-pression MQTT par `unsubscribe()` sur session persistante | Messages **perdus** pendant la suspension | `receiveMaximum` (MQTT 5) |
| 8 | `clientId = sisbm-ingest-${pid}` | Nouvelle session à chaque redémarrage : messages retenus jamais relus | `clientId` stable, `--worker=N` + `$share/<groupe>/` pour plusieurs workers |
| 9 | Fenêtre de regroupement de 300 ms qui retient le callback MQTT | MQTT.js traite les messages **séquentiellement** : 3 messages/s maximum | Traitement immédiat, réessai sans acquittement en cas de panne base |
| 10 | Commande passée à `sent` sans jamais évoluer + index CM-09 (1 commande en vol par boîtier) | Boîtier **bloqué** après sa première commande | `FlespiCommandTracker` : acknowledged / failed / expired depuis `commands-result` |
| 11 | Parser : `device.id` (id flespi) utilisé comme IMEI, `id` comme identifiant de message | Mauvais rattachement / doublons | `ident` de la trame, repli `flespi:{device_id}` résolu par `flespi_device_id` |
| 12 | Cache ident → véhicule jamais invalidé au montage/démontage | Positions rattachées 5 min à l'ancien véhicule | Invalidation sur création, sync, montage, démontage, suppression |
| 13 | `.env` (jeton flespi, mots de passe) versionné dans un dépôt public | Jeton exposé | `.env` retiré du suivi git — **révoquer le jeton sur flespi.io** |

---

## 2. Endpoints

### Canaux et catalogue — `/api/v1/flespi`

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/health` | Jeton valide, canal configuré, broker |
| GET | `/protocols?search=` | Protocoles flespi |
| GET | `/protocols/:protocol/device-types?search=` | Types d'un protocole (→ id numérique du MV730) |
| GET | `/protocols/:protocol/device-types/:typeId` | Schéma complet (ident, commandes) |
| GET / POST | `/channels` | Lister / créer (`{ name, protocolName?: "micodus", messagesTtl? }`) |
| GET / PATCH / DELETE | `/channels/:id` | Consulter / modifier / supprimer (canal de prod : `?force=true`) |
| GET | `/channels/:id/logs` | Journal (création, connexions) |
| GET | `/channels/:id/messages?currKey=&limit=` | Tampon du canal, **y compris boîtiers non enregistrés** |
| GET | `/channels/:id/connections` | Connexions TCP actives |
| GET | `/channels/:id/idents` | Idents émis sur le canal × rattachement SISBM/flespi |

### Boîtiers — `/api/v1/devices`

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/devices` | `syncFlespi: true` + `terminalId` ou `flespiIdent` ; compensation si la base refuse |
| POST | `/devices/:id/flespi/sync` | Rattacher après coup (`linkExisting` pour un device flespi existant) |
| GET | `/devices/:id/flespi` | **Diagnostic complet** : type, protocole vs canal, ident, dernière trame, `problems[]` |
| GET | `/devices/:id/flespi/logs` · `/flespi/telemetry` | Journal · dernière valeur de chaque paramètre |
| GET | `/devices/:id/flespi/commands` | Catalogue **réel** des commandes acceptées par ce boîtier |

### Commandes — `/api/v1/devices/:id/commands`

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/commands/<métier>` | `{ reason, data?, mode?: queue\|instant, ttl? }` — traduit en `custom { command_code, data }` |
| POST | `/commands/send` | Commande flespi brute `{ name, properties, reason, mode?, confirm? }` validée contre le schéma du boîtier |
| POST | `/commands/sync` | Réconciliation avec flespi |
| GET | `/commands/results` | Résultats + file flespi |
| DELETE | `/commands/:commandId` | Annulation d'une commande en file |

Garde-fous : coupure moteur (S20, `RELAY`, JT808 `8105`) refusée hors
`/security/immobilizations` ; `setting.server.set`, `setting.network.set`,
`setting.auto_apn.set` exigent `confirm: true` (une erreur rend le boîtier
injoignable à distance).

> Seul **S20** (coupure/rétablissement) est confirmé par la documentation flespi
> pour le MV730. Les autres codes (S10, R1, R2, T1…) viennent du support et sont
> marqués `verified: false` : les valider sur boîtier réel, ou utiliser
> `/commands/send` avec les commandes listées par `/flespi/commands`.

### Commandes ace

```bash
node ace sisbm:flespi:check                 # diagnostic complet, exit 1 si bloquant
node ace sisbm:flespi:watch --channel=ID    # trames reçues par le canal (révèle l'ident)
node ace sisbm:flespi:watch --device=ID --commands --raw
node ace sisbm:flespi:sync-commands         # à planifier chaque minute
node ace sisbm:ingest [--dry-run] [--worker=N]
```

---

## 3. Procédure de test sur MV730 réel (MQTT)

**Prérequis** : SIM active avec data, jeton flespi neuf dans `.env`.

1. **Canal** — réutiliser `sisbm_channel` (1442013, micodus) : `FLESPI_CHANNEL_ID=1442013`.
   Vérifier : `node ace sisbm:flespi:check`.
2. **Type** — `GET /api/v1/flespi/protocols/micodus/device-types?search=mv730`
   doit renvoyer « Micodus MV730 ». Le device 8958982 (Concox AT6) est à
   supprimer chez flespi : il ne recevra jamais rien.
3. **Programmer le boîtier** (SMS au numéro de la SIM, syntaxe du manuel MV730,
   mot de passe par défaut indiqué dans le manuel) : APN de l'opérateur, puis
   serveur = `ch1442013.flespi.gw`, port `39142`, TCP. La commande de requête
   `param1` du manuel renvoie l'ID du boîtier, l'IP/port et l'APN configurés.
4. **Observer le canal** :
   `node ace sisbm:flespi:watch --channel=1442013` — dès la connexion, l'ident
   réellement émis s'affiche. Le confirmer par `GET /flespi/channels/1442013/idents`.
5. **Enregistrer** : `POST /api/v1/devices` avec `syncFlespi: true` et
   `flespiIdent` = l'ident lu à l'étape 4 (ou `terminalId` = ID de l'étiquette).
6. **Observer le device** : `node ace sisbm:flespi:watch --device=<id>` puis
   `GET /api/v1/devices/:id/flespi` → `problems: []`.
7. **Ingestion** : `node ace sisbm:ingest --dry-run`, puis sans `--dry-run`
   après montage sur un véhicule (`POST /devices/:id/assignment`).
8. **Commandes** : `POST /devices/:id/commands/send`
   `{ "name": "setting.network.get", "properties": {}, "reason": "recette" }`,
   suivre avec `watch --commands`, puis `POST /commands/sync` → `acknowledged`.

---

## 4. Recommandations d'exploitation

- **Deux jetons** : un jeton REST (administration) et un jeton MQTT limité par ACL
  à `flespi/message/gw/devices/#` en lecture (`FLESPI_MQTT_TOKEN`).
- **Session MQTT** : QoS 1 + session persistante (`FLESPI_MQTT_SESSION_EXPIRY`)
  couvre les redémarrages du worker ; le device conserve de toute façon ses
  messages (`messages_ttl` 1 an) pour un rattrapage via
  `/devices/:id/telemetry/history`.
- **Commandes en file plutôt qu'instantanées** : le MV730 coupe son GPRS à
  l'arrêt (`stop_mode`) ; la file délivre à la reconnexion.
- **Numéro de SIM chez flespi** (`simMsisdn`) : requis pour le repli SMS des
  commandes (adresse `sms`) — nécessite aussi un *modem* flespi.
- **Planifier** `sisbm:flespi:sync-commands` chaque minute.
