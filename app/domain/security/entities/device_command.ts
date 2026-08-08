import { AggregateRoot, Ok, Err, type Result } from '#domain/kernel'
import {
  type ActorId,
  type CommandId,
  type DeviceId,
  type Reason,
  type Speed,
  type VehicleId,
  ALLOWED_TRANSITIONS,
  type CommandOrigin,
  type CommandStatus,
  type CommandType,
} from '#domain/security/value_objects'
import {
  CommandExpiredError,
  InvalidTransitionError,
  SelfValidationError,
  VehicleInMotionError,
} from '#domain/security/errors'
import {
  ImmobilizationRequested,
  ImmobilizationValidated,
  ImmobilizationRejected,
  CommandDispatched,
  CommandAcknowledged,
  CommandFailed,
} from '#domain/security/events'

interface DeviceCommandProps {
  organizationId: string
  deviceId: DeviceId
  vehicleId: VehicleId | null
  commandType: CommandType
  status: CommandStatus
  reason: Reason
  origin: CommandOrigin
  requestedBy: ActorId | null
  requestedAt: Date
  safetySpeedLimit: Speed
  speedAtRequest: Speed | null
  ignitionAtRequest: boolean | null
  requiresValidation: boolean
  validatedBy: ActorId | null
  validatedAt: Date | null
  rejectionReason: string | null
  queuedAt: Date | null
  sentAt: Date | null
  acknowledgedAt: Date | null
  failedAt: Date | null
  errorMessage: string | null
  providerCommandId: string | null
  attempts: number
  expiresAt: Date
  policyId: string | null
  alertId: string | null
}

/**
 * =========================================================================
 *  AGRÉGAT DeviceCommand
 * =========================================================================
 *
 * Toutes les règles de sécurité de l'immobilisation vivent ICI, et nulle part
 * ailleurs. Un contrôleur HTTP, un worker de file ou le moteur de politiques
 * passent tous par ces méthodes : il n'existe aucun chemin qui contourne les
 * invariants.
 *
 * La base de données pose les mêmes garde-fous en `CHECK` (migration 9). Ce
 * n'est pas une redondance inutile : le domaine produit des messages
 * exploitables par l'utilisateur, la base garantit qu'aucun bug — ni aucun
 * script exécuté à la main — ne peut écrire un état interdit.
 *
 * Invariants portés :
 *   CM-07  aucune coupure moteur au-dessus du seuil de vitesse
 *   CM-08  motif obligatoire et substantiel
 *   —      séparation des rôles (le valideur n'est pas le demandeur)
 *   —      machine à états stricte
 *   —      expiration : au-delà du TTL, la vitesse doit être revérifiée
 */
export class DeviceCommand extends AggregateRoot<CommandId> {
  private constructor(
    id: CommandId,
    private props: DeviceCommandProps
  ) {
    super(id)
  }

  // -------------------------------------------------------------- création

  /**
   * Demande d'immobilisation.
   *
   * La vitesse est contrôlée DÈS la demande, et non au moment de l'envoi.
   * Raison : une demande enregistrée alors que le véhicule roule constitue
   * déjà une trace ambiguë en audit. On refuse à la source.
   */
  static requestImmobilization(input: {
    id: CommandId
    organizationId: string
    deviceId: DeviceId
    vehicleId: VehicleId
    reason: Reason
    origin: CommandOrigin
    requestedBy: ActorId | null
    currentSpeed: Speed
    ignition: boolean | null
    safetySpeedLimit: Speed
    requiresValidation: boolean
    ttlMinutes: number
    now: Date
    policyId?: string | null
    alertId?: string | null
  }): Result<DeviceCommand> {
    // ---- CM-07 : garde-fou de vitesse, non contournable
    if (!input.currentSpeed.isAtOrBelow(input.safetySpeedLimit)) {
      return Err(new VehicleInMotionError(input.currentSpeed.kph, input.safetySpeedLimit.kph))
    }

    const command = new DeviceCommand(input.id, {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      vehicleId: input.vehicleId,
      commandType: 'engine_cut', //commande pour couper le moteur
      status: input.requiresValidation ? 'pending_validation' : 'approved',
      reason: input.reason,
      origin: input.origin,
      requestedBy: input.requestedBy,
      requestedAt: input.now,
      safetySpeedLimit: input.safetySpeedLimit,
      speedAtRequest: input.currentSpeed,
      ignitionAtRequest: input.ignition,
      requiresValidation: input.requiresValidation,
      validatedBy: null,
      validatedAt: null,
      rejectionReason: null,
      queuedAt: null,
      sentAt: null,
      acknowledgedAt: null,
      failedAt: null,
      errorMessage: null,
      providerCommandId: null,
      attempts: 0,
      expiresAt: new Date(input.now.getTime() + input.ttlMinutes * 60_000),
      policyId: input.policyId ?? null,
      alertId: input.alertId ?? null,
    })

    command.addDomainEvent(
      new ImmobilizationRequested(command.id.value, {
        deviceId: input.deviceId.value,
        vehicleId: input.vehicleId.value,
        origin: input.origin,
        requestedBy: input.requestedBy?.value ?? null,
        speedAtRequestKph: input.currentSpeed.kph,
        requiresValidation: input.requiresValidation,
      })
    )

    return Ok(command)
  }

  /** Reconstitution depuis la persistance — aucune règle rejouée. */
  static rehydrate(id: CommandId, props: DeviceCommandProps): DeviceCommand {
    return new DeviceCommand(id, props)
  }

  // -------------------------------------------------------------- validation

  /**
   * Validation par un second opérateur (principe des quatre yeux).
   *
   * On revérifie ici la vitesse **et** l'expiration : entre la demande et la
   * validation, le véhicule a pu redémarrer. C'est le scénario réaliste où
   * un contrôle uniquement à la demande serait dangereux.
   */
  validate(input: { validatedBy: ActorId; currentSpeed: Speed; now: Date }): Result<void> {
    const transition = this.ensureTransition('approved', input.now)
    if (!transition.ok) return transition

    if (this.props.requestedBy && this.props.requestedBy.equals(input.validatedBy)) {
      return Err(new SelfValidationError(input.validatedBy.value))
    }

    if (!input.currentSpeed.isAtOrBelow(this.props.safetySpeedLimit)) {
      return Err(new VehicleInMotionError(input.currentSpeed.kph, this.props.safetySpeedLimit.kph))
    }

    this.props.status = 'approved'
    this.props.validatedBy = input.validatedBy
    this.props.validatedAt = input.now
    this.props.speedAtRequest = input.currentSpeed

    this.addDomainEvent(
      new ImmobilizationValidated(this.id.value, {
        deviceId: this.props.deviceId.value,
        vehicleId: this.props.vehicleId?.value ?? null,
        validatedBy: input.validatedBy.value,
        speedAtValidationKph: input.currentSpeed.kph,
      })
    )
    return Ok(undefined)
  }

  reject(input: { rejectedBy: ActorId; rejectionReason: string; now: Date }): Result<void> {
    const transition = this.ensureTransition('rejected', input.now, { ignoreExpiry: true })
    if (!transition.ok) return transition

    this.props.status = 'rejected'
    this.props.validatedBy = input.rejectedBy
    this.props.validatedAt = input.now
    this.props.rejectionReason = input.rejectionReason

    this.addDomainEvent(
      new ImmobilizationRejected(this.id.value, {
        deviceId: this.props.deviceId.value,
        rejectedBy: input.rejectedBy.value,
        rejectionReason: input.rejectionReason,
      })
    )
    return Ok(undefined)
  }

  // -------------------------------------------------------------- exécution

  /** Mise en file : dernier contrôle de vitesse avant transmission au tracker. */
  queue(input: { currentSpeed: Speed; now: Date }): Result<void> {
    const transition = this.ensureTransition('queued', input.now)
    if (!transition.ok) return transition

    if (!input.currentSpeed.isAtOrBelow(this.props.safetySpeedLimit)) {
      return Err(new VehicleInMotionError(input.currentSpeed.kph, this.props.safetySpeedLimit.kph))
    }

    this.props.status = 'queued'
    this.props.queuedAt = input.now
    return Ok(undefined)
  }

  markSent(input: { providerCommandId: string; now: Date }): Result<void> {
    const transition = this.ensureTransition('sent', input.now, { ignoreExpiry: true })
    if (!transition.ok) return transition

    this.props.status = 'sent'
    this.props.sentAt = input.now
    this.props.providerCommandId = input.providerCommandId
    this.props.attempts += 1

    this.addDomainEvent(
      new CommandDispatched(this.id.value, {
        deviceId: this.props.deviceId.value,
        providerCommandId: input.providerCommandId,
      })
    )
    return Ok(undefined)
  }

  markAcknowledged(now: Date): Result<void> {
    const transition = this.ensureTransition('acknowledged', now, { ignoreExpiry: true })
    if (!transition.ok) return transition

    this.props.status = 'acknowledged'
    this.props.acknowledgedAt = now

    this.addDomainEvent(
      new CommandAcknowledged(this.id.value, {
        deviceId: this.props.deviceId.value,
        vehicleId: this.props.vehicleId?.value ?? null,
        commandType: this.props.commandType,
      })
    )
    return Ok(undefined)
  }

  markFailed(input: { errorMessage: string; now: Date }): Result<void> {
    const transition = this.ensureTransition('failed', input.now, { ignoreExpiry: true })
    if (!transition.ok) return transition

    this.props.status = 'failed'
    this.props.failedAt = input.now
    this.props.errorMessage = input.errorMessage

    this.addDomainEvent(
      new CommandFailed(this.id.value, {
        deviceId: this.props.deviceId.value,
        errorMessage: input.errorMessage,
        attempts: this.props.attempts,
      })
    )
    return Ok(undefined)
  }

  cancel(input: { cancelledBy: ActorId | null; now: Date }): Result<void> {
    const transition = this.ensureTransition('cancelled', input.now, { ignoreExpiry: true })
    if (!transition.ok) return transition
    this.props.status = 'cancelled'
    return Ok(undefined)
  }

  expire(now: Date): Result<void> {
    const transition = this.ensureTransition('expired', now, { ignoreExpiry: true })
    if (!transition.ok) return transition
    this.props.status = 'expired'
    return Ok(undefined)
  }

  // -------------------------------------------------------------- invariants

  private ensureTransition(
    target: CommandStatus,
    now: Date,
    options: { ignoreExpiry?: boolean } = {}
  ): Result<void> {
    if (!ALLOWED_TRANSITIONS[this.props.status].includes(target)) {
      return Err(new InvalidTransitionError(this.props.status, target))
    }
    if (!options.ignoreExpiry && this.isExpired(now)) {
      return Err(new CommandExpiredError(this.props.expiresAt))
    }
    return Ok(undefined)
  }

  isExpired(now: Date): boolean {
    return now.getTime() > this.props.expiresAt.getTime()
  }

  // -------------------------------------------------------------- lecture

  get status(): CommandStatus {
    return this.props.status
  }
  get deviceId(): DeviceId {
    return this.props.deviceId
  }
  get vehicleId(): VehicleId | null {
    return this.props.vehicleId
  }
  get commandType(): CommandType {
    return this.props.commandType
  }
  get requestedBy(): ActorId | null {
    return this.props.requestedBy
  }
  get expiresAt(): Date {
    return this.props.expiresAt
  }

  /** Projection destinée à la persistance et à la sérialisation HTTP. */
  snapshot() {
    return {
      id: this.id.value,
      organizationId: this.props.organizationId,
      deviceId: this.props.deviceId.value,
      vehicleId: this.props.vehicleId?.value ?? null,
      commandType: this.props.commandType,
      status: this.props.status,
      reason: this.props.reason.text,
      origin: this.props.origin,
      requestedBy: this.props.requestedBy?.value ?? null,
      requestedAt: this.props.requestedAt,
      safetySpeedLimitKph: this.props.safetySpeedLimit.kph,
      speedAtRequestKph: this.props.speedAtRequest?.kph ?? null,
      ignitionAtRequest: this.props.ignitionAtRequest,
      requiresValidation: this.props.requiresValidation,
      validatedBy: this.props.validatedBy?.value ?? null,
      validatedAt: this.props.validatedAt,
      rejectionReason: this.props.rejectionReason,
      queuedAt: this.props.queuedAt,
      sentAt: this.props.sentAt,
      acknowledgedAt: this.props.acknowledgedAt,
      failedAt: this.props.failedAt,
      errorMessage: this.props.errorMessage,
      providerCommandId: this.props.providerCommandId,
      attempts: this.props.attempts,
      expiresAt: this.props.expiresAt,
      policyId: this.props.policyId,
      alertId: this.props.alertId,
    }
  }
}
