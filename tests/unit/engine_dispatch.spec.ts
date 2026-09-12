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
import { DispatchEngineCommand } from '#application/security/use_cases/dispatch_engine_command'
import type { DeviceCommandRepository } from '#domain/security/repositories/device_command_repository'
import type {
  DeviceCommandGateway,
  DeviceProviderReader,
  VehicleSafetyState,
  VehicleStateReader,
} from '#application/security/ports'
import type { AuditLogger, ExecutionContext, UnitOfWork } from '#application/ports'
import type { TransactionScope } from '#domain/kernel'

/**
 * =========================================================================
 *  ÉMISSION DE LA COUPURE MOTEUR — sans base, sans réseau
 * =========================================================================
 *
 * C'est le chemin le plus sensible du système : il agit physiquement sur un
 * véhicule. Ces tests vérifient les garde-fous à l'endroit exact où ils
 * comptent — juste avant l'appel à la passerelle.
 */

const IDS = {
  command: '11111111-1111-4111-8111-111111111111',
  device: '22222222-2222-4222-8222-222222222222',
  vehicle: '33333333-3333-4333-8333-333333333333',
  requester: '44444444-4444-4444-8444-444444444444',
  validator: '55555555-5555-4555-8555-555555555555',
}

const NOW = new Date('2026-09-12T10:00:00.000Z')
const CONTEXTE: ExecutionContext = {
  actorId: IDS.validator,
  actorType: 'user',
  organizationId: '66666666-6666-4666-8666-666666666666',
}

function vitesse(kph: number): Speed {
  const s = Speed.fromKph(kph)
  if (!s.ok) throw new Error('fixture invalide')
  return s.value
}

function motif(texte = 'Vehicule signale vole par le client'): Reason {
  const r = Reason.create(texte)
  if (!r.ok) throw new Error('fixture invalide')
  return r.value
}

/** Commande de coupure déjà validée par un second opérateur. */
function coupureApprouvee(): DeviceCommand {
  const created = DeviceCommand.requestImmobilization({
    id: CommandId.from(IDS.command),
    organizationId: CONTEXTE.organizationId,
    deviceId: DeviceId.from(IDS.device),
    vehicleId: VehicleId.from(IDS.vehicle),
    reason: motif(),
    origin: 'manual',
    requestedBy: ActorId.from(IDS.requester),
    currentSpeed: vitesse(0),
    ignition: false,
    safetySpeedLimit: vitesse(5),
    requiresValidation: true,
    ttlMinutes: 15,
    now: NOW,
  })
  if (!created.ok) throw new Error('fixture invalide')
  const command = created.value
  const validated = command.validate({
    validatedBy: ActorId.from(IDS.validator),
    currentSpeed: vitesse(0),
    now: NOW,
  })
  if (!validated.ok) throw new Error('fixture invalide')
  command.pullDomainEvents()
  return command
}

function retablissement(): DeviceCommand {
  const created = DeviceCommand.requestEngineRestore({
    id: CommandId.from(IDS.command),
    organizationId: CONTEXTE.organizationId,
    deviceId: DeviceId.from(IDS.device),
    vehicleId: VehicleId.from(IDS.vehicle),
    reason: motif('Restitution du vehicule au client'),
    origin: 'manual',
    requestedBy: ActorId.from(IDS.requester),
    safetySpeedLimit: vitesse(5),
    ttlMinutes: 15,
    now: NOW,
  })
  if (!created.ok) throw new Error('fixture invalide')
  return created.value
}

// ------------------------------------------------------------------ doubles

const uow: UnitOfWork = {
  async run(handler) {
    const tx: TransactionScope = { raw: null, collect: () => {} }
    return handler(tx)
  },
}

const audit: AuditLogger = { record: async () => {} }

class FakeRepo implements DeviceCommandRepository {
  constructor(private command: DeviceCommand | null) {}
  async findById() {
    return this.command
  }
  async findInFlightByDevice() {
    return null
  }
  async save() {}
  async findExpirable() {
    return []
  }
}

function etatVehicule(over: Partial<VehicleSafetyState> = {}): VehicleStateReader {
  return {
    async readSafetyState() {
      return {
        vehicleId: IDS.vehicle,
        deviceId: IDS.device,
        speed: vitesse(0),
        ignition: false,
        recordedAt: NOW,
        immobilizationEnabled: true,
        deviceHasRelay: true,
        ...over,
      }
    },
  }
}

const devices: DeviceProviderReader = {
  async readProviderDevice() {
    return { deviceId: IDS.device, externalDeviceId: '8965965', hasRelay: true }
  },
}

class FakeGateway implements DeviceCommandGateway {
  readonly envois: string[] = []
  constructor(private readonly erreur?: Error) {}
  async sendEngineCut() {
    if (this.erreur) throw this.erreur
    this.envois.push('cut')
    return { providerCommandId: '1789171580409042' }
  }
  async sendEngineRestore() {
    if (this.erreur) throw this.erreur
    this.envois.push('restore')
    return { providerCommandId: '1789171917228239' }
  }
}

function useCase(opts: {
  command: DeviceCommand | null
  vehicles?: VehicleStateReader
  gateway?: DeviceCommandGateway
  enabled?: boolean
  maxPositionAgeSeconds?: number
}) {
  const gateway = opts.gateway ?? new FakeGateway()
  return {
    gateway,
    use: new DispatchEngineCommand(
      uow,
      new FakeRepo(opts.command),
      opts.vehicles ?? etatVehicule(),
      devices,
      gateway,
      { now: () => NOW },
      audit,
      {
        enabled: opts.enabled ?? true,
        maxPositionAgeSeconds: opts.maxPositionAgeSeconds ?? 120,
      }
    ),
  }
}

// ------------------------------------------------------------------ tests

test.group('sécurité · émission de la coupure moteur', () => {
  test('véhicule à l’arrêt : la commande part et passe en « sent »', async ({ assert }) => {
    const { use, gateway } = useCase({ command: coupureApprouvee() })
    const r = await use.execute({ context: CONTEXTE, commandId: IDS.command })

    assert.isTrue(r.ok)
    if (!r.ok) return
    assert.equal(r.value.status, 'sent')
    assert.equal(r.value.providerCommandId, '1789171580409042')
    assert.deepEqual((gateway as FakeGateway).envois, ['cut'])
  })

  test('véhicule en mouvement : REFUS, rien n’est transmis (CM-07)', async ({ assert }) => {
    const { use, gateway } = useCase({
      command: coupureApprouvee(),
      vehicles: etatVehicule({ speed: vitesse(47) }),
    })
    const r = await use.execute({ context: CONTEXTE, commandId: IDS.command })

    assert.isFalse(r.ok)
    if (r.ok) return
    assert.equal(r.error.code, 'E_VEHICLE_IN_MOTION')
    assert.isEmpty((gateway as FakeGateway).envois)
  })

  test('position périmée : REFUS — rien ne prouve que le véhicule est à l’arrêt', async ({
    assert,
  }) => {
    const { use, gateway } = useCase({
      command: coupureApprouvee(),
      vehicles: etatVehicule({ recordedAt: new Date(NOW.getTime() - 10 * 60_000) }),
    })
    const r = await use.execute({ context: CONTEXTE, commandId: IDS.command })

    assert.isFalse(r.ok)
    if (r.ok) return
    assert.equal(r.error.code, 'E_STALE_POSITION')
    assert.isEmpty((gateway as FakeGateway).envois)
  })

  test('IMMOBILIZATION_ENABLED=false : aucune coupure ne part', async ({ assert }) => {
    const { use, gateway } = useCase({ command: coupureApprouvee(), enabled: false })
    const r = await use.execute({ context: CONTEXTE, commandId: IDS.command })

    assert.isFalse(r.ok)
    if (r.ok) return
    assert.equal(r.error.code, 'E_IMMOBILIZATION_DISABLED')
    assert.isEmpty((gateway as FakeGateway).envois)
  })

  test('passerelle en échec : la commande est tracée « failed », jamais « sent »', async ({
    assert,
  }) => {
    const { use } = useCase({
      command: coupureApprouvee(),
      gateway: new FakeGateway(new Error('device not connected')),
    })
    const r = await use.execute({ context: CONTEXTE, commandId: IDS.command })

    assert.isTrue(r.ok)
    if (!r.ok) return
    assert.equal(r.value.status, 'failed')
    assert.isNull(r.value.providerCommandId)
  })
})

test.group('sécurité · rétablissement du moteur', () => {
  test('créé directement approuvé, sans second valideur', ({ assert }) => {
    const command = retablissement()
    assert.equal(command.commandType, 'engine_restore')
    assert.equal(command.status, 'approved')
  })

  test('part même véhicule roulant : le garde-fou de vitesse ne s’applique qu’à la coupure', async ({
    assert,
  }) => {
    const { use, gateway } = useCase({
      command: retablissement(),
      vehicles: etatVehicule({ speed: vitesse(90) }),
      // Désactivé : le rétablissement ne dépend pas de IMMOBILIZATION_ENABLED.
      enabled: false,
    })
    const r = await use.execute({ context: CONTEXTE, commandId: IDS.command })

    assert.isTrue(r.ok)
    if (!r.ok) return
    assert.equal(r.value.status, 'sent')
    assert.deepEqual((gateway as FakeGateway).envois, ['restore'])
  })

  test('position absente ou périmée : le rétablissement part quand même', async ({ assert }) => {
    const { use } = useCase({
      command: retablissement(),
      vehicles: etatVehicule({ recordedAt: new Date(0) }),
    })
    const r = await use.execute({ context: CONTEXTE, commandId: IDS.command })

    assert.isTrue(r.ok)
    if (!r.ok) return
    assert.equal(r.value.status, 'sent')
  })
})
