import { test } from '@japa/runner'
import { DeviceCommand } from '#domain/security/entities/device_command'
import {
  ActorId,
  CommandId,
  DeviceId,
  Reason,
  Speed,
  VehicleId,
} from '#domain/security/value_objects'

/**
 * =========================================================================
 *  TESTS DU DOMAINE — sans base de données, sans HTTP, sans Redis
 * =========================================================================
 *
 * C'est le bénéfice concret de la Clean Architecture : les règles de sécurité
 * les plus critiques de la plateforme se testent en quelques millisecondes,
 * sans conteneur ni migration.
 *
 * La suite s'exécute avec `node ace test unit`.
 */

const IDS = {
  command: '11111111-1111-4111-8111-111111111111',
  device: '22222222-2222-4222-8222-222222222222',
  vehicle: '33333333-3333-4333-8333-333333333333',
  requester: '44444444-4444-4444-8444-444444444444',
  validator: '55555555-5555-4555-8555-555555555555',
}

const NOW = new Date('2026-08-04T10:00:00.000Z')

function buildRequest(overrides: Partial<{ speedKph: number; requiresValidation: boolean }> = {}) {
  const reason = Reason.create('Vehicule signale vole par le client')
  if (!reason.ok) throw new Error('fixture invalide')

  const speed = Speed.fromKph(overrides.speedKph ?? 0)
  if (!speed.ok) throw new Error('fixture invalide')

  const limit = Speed.fromKph(5)
  if (!limit.ok) throw new Error('fixture invalide')

  return DeviceCommand.requestImmobilization({
    id: CommandId.from(IDS.command),
    organizationId: 'org',
    deviceId: DeviceId.from(IDS.device),
    vehicleId: VehicleId.from(IDS.vehicle),
    reason: reason.value,
    origin: 'manual',
    requestedBy: ActorId.from(IDS.requester),
    currentSpeed: speed.value,
    ignition: false,
    safetySpeedLimit: limit.value,
    requiresValidation: overrides.requiresValidation ?? true,
    ttlMinutes: 15,
    now: NOW,
  })
}

test.group('DeviceCommand — garde-fou de vitesse (CM-07)', () => {
  test('refuse la coupure moteur au-dessus du seuil de sécurité', ({ assert }) => {
    const result = buildRequest({ speedKph: 47 })

    assert.isFalse(result.ok)
    if (result.ok) return
    assert.equal(result.error.code, 'E_VEHICLE_IN_MOTION')
    assert.deepInclude(result.error.details, { currentKph: 47, limitKph: 5 })
  })

  test('accepte la coupure véhicule à l’arrêt', ({ assert }) => {
    const result = buildRequest({ speedKph: 0 })

    assert.isTrue(result.ok)
    if (!result.ok) return
    assert.equal(result.value.status, 'pending_validation')
  })

  test('accepte à vitesse résiduelle, exactement au seuil', ({ assert }) => {
    const result = buildRequest({ speedKph: 5 })
    assert.isTrue(result.ok)
  })

  test('refuse juste au-dessus du seuil — la limite est stricte', ({ assert }) => {
    const result = buildRequest({ speedKph: 5.1 })
    assert.isFalse(result.ok)
  })
})

test.group('DeviceCommand — motif obligatoire (CM-08)', () => {
  test('refuse un motif vide ou insignifiant', ({ assert }) => {
    for (const raw of ['', '   ', 'ok', 'abc ']) {
      const result = Reason.create(raw)
      assert.isFalse(result.ok, `"${raw}" aurait dû être refusé`)
    }
  })

  test('accepte un motif substantiel et le normalise', ({ assert }) => {
    const result = Reason.create('  Vol signale par le client  ')
    assert.isTrue(result.ok)
    if (!result.ok) return
    assert.equal(result.value.text, 'Vol signale par le client')
  })
})

test.group('DeviceCommand — séparation des rôles', () => {
  test('refuse que le demandeur valide sa propre commande', ({ assert }) => {
    const created = buildRequest()
    assert.isTrue(created.ok)
    if (!created.ok) return

    const speed = Speed.fromKph(0)
    if (!speed.ok) return

    const result = created.value.validate({
      validatedBy: ActorId.from(IDS.requester), // le demandeur lui-même
      currentSpeed: speed.value,
      now: NOW,
    })

    assert.isFalse(result.ok)
    if (result.ok) return
    assert.equal(result.error.code, 'E_SELF_VALIDATION')
  })

  test('accepte la validation par un second opérateur', ({ assert }) => {
    const created = buildRequest()
    if (!created.ok) return
    const speed = Speed.fromKph(0)
    if (!speed.ok) return

    const result = created.value.validate({
      validatedBy: ActorId.from(IDS.validator),
      currentSpeed: speed.value,
      now: NOW,
    })

    assert.isTrue(result.ok)
    assert.equal(created.value.status, 'approved')
  })
})

test.group('DeviceCommand — revérification à la validation', () => {
  test('refuse la validation si le véhicule a redémarré entre-temps', ({ assert }) => {
    // Scénario réel : demande faite à l'arrêt, le véhicule repart avant
    // que le superviseur ne valide.
    const created = buildRequest({ speedKph: 0 })
    if (!created.ok) return

    const speedNow = Speed.fromKph(62)
    if (!speedNow.ok) return

    const result = created.value.validate({
      validatedBy: ActorId.from(IDS.validator),
      currentSpeed: speedNow.value,
      now: new Date(NOW.getTime() + 60_000),
    })

    assert.isFalse(result.ok)
    if (result.ok) return
    assert.equal(result.error.code, 'E_VEHICLE_IN_MOTION')
    assert.equal(created.value.status, 'pending_validation', 'le statut ne doit pas bouger')
  })
})

test.group('DeviceCommand — expiration', () => {
  test('refuse la validation d’une commande expirée', ({ assert }) => {
    const created = buildRequest()
    if (!created.ok) return
    const speed = Speed.fromKph(0)
    if (!speed.ok) return

    const result = created.value.validate({
      validatedBy: ActorId.from(IDS.validator),
      currentSpeed: speed.value,
      now: new Date(NOW.getTime() + 16 * 60_000), // TTL = 15 min
    })

    assert.isFalse(result.ok)
    if (result.ok) return
    assert.equal(result.error.code, 'E_COMMAND_EXPIRED')
  })

  test('autorise le refus d’une commande expirée', ({ assert }) => {
    // Refuser reste possible après expiration : c'est une clôture de dossier,
    // pas une action sur le véhicule.
    const created = buildRequest()
    if (!created.ok) return

    const result = created.value.reject({
      rejectedBy: ActorId.from(IDS.validator),
      rejectionReason: 'Demande caduque',
      now: new Date(NOW.getTime() + 60 * 60_000),
    })

    assert.isTrue(result.ok)
    assert.equal(created.value.status, 'rejected')
  })
})

test.group('DeviceCommand — machine à états', () => {
  test('refuse une transition non prévue', ({ assert }) => {
    const created = buildRequest()
    if (!created.ok) return

    // pending_validation -> sent est interdit : il faut approuver puis mettre en file
    const result = created.value.markSent({ providerCommandId: 'flespi-1', now: NOW })

    assert.isFalse(result.ok)
    if (result.ok) return
    assert.equal(result.error.code, 'E_INVALID_TRANSITION')
  })

  test('déroule le cycle nominal complet', ({ assert }) => {
    const created = buildRequest({ requiresValidation: false })
    if (!created.ok) return
    const command = created.value
    const speed = Speed.fromKph(0)
    if (!speed.ok) return

    assert.equal(command.status, 'approved')
    assert.isTrue(command.queue({ currentSpeed: speed.value, now: NOW }).ok)
    assert.equal(command.status, 'queued')
    assert.isTrue(command.markSent({ providerCommandId: 'flespi-42', now: NOW }).ok)
    assert.equal(command.status, 'sent')
    assert.isTrue(command.markAcknowledged(NOW).ok)
    assert.equal(command.status, 'acknowledged')
  })

  test('refuse la mise en file si le véhicule roule à nouveau', ({ assert }) => {
    const created = buildRequest({ requiresValidation: false })
    if (!created.ok) return
    const speedNow = Speed.fromKph(30)
    if (!speedNow.ok) return

    // Troisième contrôle de vitesse : demande, validation, puis mise en file.
    const result = created.value.queue({ currentSpeed: speedNow.value, now: NOW })
    assert.isFalse(result.ok)
  })
})

test.group('DeviceCommand — événements de domaine', () => {
  test('émet un événement à la demande puis à la validation', ({ assert }) => {
    const created = buildRequest()
    if (!created.ok) return
    const command = created.value

    const afterRequest = command.pullDomainEvents()
    assert.lengthOf(afterRequest, 1)
    assert.equal(afterRequest[0].eventName, 'security.immobilization.requested')

    // Les événements sont vidés après lecture : pas de double publication.
    assert.lengthOf(command.pullDomainEvents(), 0)

    const speed = Speed.fromKph(0)
    if (!speed.ok) return
    command.validate({
      validatedBy: ActorId.from(IDS.validator),
      currentSpeed: speed.value,
      now: NOW,
    })

    const afterValidation = command.pullDomainEvents()
    assert.lengthOf(afterValidation, 1)
    assert.equal(afterValidation[0].eventName, 'security.immobilization.validated')
  })
})

test.group('Speed — objet-valeur', () => {
  test('rejette les valeurs hors domaine physique', ({ assert }) => {
    for (const kph of [-1, 401, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.isFalse(Speed.fromKph(kph).ok, `${kph} aurait dû être rejeté`)
    }
  })

  test('compare par valeur, pas par référence', ({ assert }) => {
    const a = Speed.fromKph(12)
    const b = Speed.fromKph(12)
    if (!a.ok || !b.ok) return
    assert.isTrue(a.value.equals(b.value))
  })
})
