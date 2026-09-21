import type { ApplicationService } from '@adonisjs/core/types'
import { LucidUnitOfWork } from '#infrastructure/persistence/unit_of_work'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { SystemClock } from '#infrastructure/services/clock'
import { UuidGenerator } from '#infrastructure/services/id_generator'
import { LucidDeviceCommandRepository } from '#infrastructure/persistence/repositories/device_command_repository'
import { LucidVehicleStateReader } from '#infrastructure/persistence/readers/vehicle_state_reader'
import { RequestImmobilization } from '#application/security/use_cases/request_immobilization'
import { ValidateImmobilization } from '#application/security/use_cases/validate_immobilization'
import { DispatchEngineCommand } from '#application/security/use_cases/dispatch_engine_command'
import { RequestEngineRestore } from '#application/security/use_cases/request_engine_restore'
import { LucidDeviceProviderReader } from '#infrastructure/persistence/readers/device_provider_reader'
import sisbmConfig from '#config/sisbm'
import { FlespiClient } from '#infrastructure/gateways/flespi/flespi_client'
import {
  HttpFlespiCommandGateway,
  FlespiDeviceCommandGateway,
} from '#infrastructure/gateways/flespi/flespi_command_gateway'
import { FlespiDeviceGateway } from '#infrastructure/gateways/flespi/flespi_device_gateway'
import { FlespiChannelGateway } from '#infrastructure/gateways/flespi/flespi_channel_gateway'
import { FlespiProtocolGateway } from '#infrastructure/gateways/flespi/flespi_protocol_gateway'
import { FlespiCommandTracker } from '#infrastructure/gateways/flespi/flespi_command_tracker'
import { FlespiProvisioning } from '#infrastructure/gateways/flespi/flespi_provisioning'
import {
  LucidPositionRepository,
  LucidVehicleLastPositionRepository,
  LucidIngestMessageRepository,
} from '#infrastructure/persistence/repositories/telemetry_repositories'
import { LucidTripRepository } from '#infrastructure/persistence/repositories/trip_repository'
import { CachedDeviceResolver } from '#infrastructure/persistence/readers/device_resolver'
import { TransmitBroadcaster } from '#infrastructure/realtime/transmit_broadcaster'
import {
  LucidOrganizationRepository,
  LucidRoleCatalog,
  LucidUserAccountRepository,
} from '#infrastructure/persistence/repositories/identity_repositories'
import { AdonisPasswordHasher } from '#infrastructure/services/password_hasher'
import { RoleAssignment } from '#application/identity/services/role_assignment'
import { CreateOrganization } from '#application/identity/use_cases/create_organization'
import { CreateOrganizationUser } from '#application/identity/use_cases/create_organization_user'
import {
  LucidDeviceGroupMembership,
  LucidVehicleGroupMembership,
} from '#infrastructure/persistence/repositories/group_membership_repository'
import { LucidAuditLogReader } from '#infrastructure/persistence/readers/audit_log_reader'

/**
 * =========================================================================
 *  COMPOSITION ROOT
 * =========================================================================
 *
 * SEUL endroit du projet où les interfaces du domaine rencontrent leurs
 * implémentations concrètes. Partout ailleurs, le code dépend d'abstractions.
 *
 * Le câblage est EXPLICITE, pas auto-résolu. Les dépendances des cas d'usage
 * sont des interfaces TypeScript : elles n'existent pas au runtime, le
 * conteneur ne peut donc pas les déduire. C'est un avantage — la composition
 * complète du système se lit d'un seul coup d'oeil, ici.
 *
 * Pour brancher des doubles en test, on ne modifie que ce fichier.
 *
 * Vérification de la santé de l'architecture :
 *
 *     grep -rl "@adonisjs" app/modules/<ctx>/domain/       -> doit être vide
 *     grep -rl "@adonisjs" app/modules/<ctx>/application/  -> seulement `inject`
 */
export default class ContainerProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    const immo = sisbmConfig.immobilization
    const flespi = {
      token: sisbmConfig.flespi.token,
      baseUrl: sisbmConfig.flespi.baseUrl,
      timeoutMs: sisbmConfig.flespi.timeoutMs,
    }

    // ------------------------------------------------------------- Flespi
    // Un SEUL client HTTP partagé : même jeton, même politique de réessai.
    this.app.container.singleton(FlespiClient, () => new FlespiClient(flespi))
    this.app.container.singleton(FlespiChannelGateway, async (resolver) => {
      return new FlespiChannelGateway(await resolver.make(FlespiClient))
    })
    this.app.container.singleton(FlespiDeviceGateway, async (resolver) => {
      return new FlespiDeviceGateway(await resolver.make(FlespiClient))
    })
    // Singleton : son cache du catalogue protocoles n'a d'intérêt que partagé.
    this.app.container.singleton(FlespiProtocolGateway, async (resolver) => {
      return new FlespiProtocolGateway(await resolver.make(FlespiClient))
    })
    this.app.container.singleton(HttpFlespiCommandGateway, async (resolver) => {
      return new HttpFlespiCommandGateway(await resolver.make(FlespiClient))
    })
    this.app.container.singleton(FlespiCommandTracker, async (resolver) => {
      return new FlespiCommandTracker(await resolver.make(HttpFlespiCommandGateway))
    })
    this.app.container.singleton(FlespiProvisioning, async (resolver) => {
      return new FlespiProvisioning(
        await resolver.make(FlespiChannelGateway),
        await resolver.make(FlespiDeviceGateway),
        await resolver.make(FlespiProtocolGateway)
      )
    })
    // Adaptateur du port sécurité — prêt pour le branchement de l'immobilisation (Jalon 3).
    this.app.container.singleton(FlespiDeviceCommandGateway, async (resolver) => {
      return new FlespiDeviceCommandGateway(
        await resolver.make(HttpFlespiCommandGateway),
        immo.commandTtlMinutes * 60
      )
    })

    // ------------------------------------------------------------- télémétrie
    // Le résolveur est un SINGLETON : son cache mémoire n'a d'intérêt que
    // partagé entre toutes les trames du processus.
    this.app.container.singleton(CachedDeviceResolver, () => new CachedDeviceResolver())
    this.app.container.singleton(LucidPositionRepository, () => new LucidPositionRepository())
    this.app.container.singleton(LucidTripRepository, () => new LucidTripRepository())
    this.app.container.singleton(
      LucidIngestMessageRepository,
      () => new LucidIngestMessageRepository()
    )
    this.app.container.singleton(
      LucidVehicleLastPositionRepository,
      () => new LucidVehicleLastPositionRepository()
    )
    this.app.container.singleton(TransmitBroadcaster, () => new TransmitBroadcaster())

    // ------------------------------------------------------------- sécurité
    this.app.container.singleton(RequestImmobilization, () => {
      return new RequestImmobilization(
        new LucidUnitOfWork(),
        new LucidDeviceCommandRepository(),
        new LucidVehicleStateReader(),
        new SystemClock(),
        new UuidGenerator(),
        new LucidAuditLogger(),
        {
          safetySpeedKph: immo.safetySpeedKph,
          requireValidation: immo.requireValidation,
          commandTtlMinutes: immo.commandTtlMinutes,
          maxPositionAgeSeconds: immo.maxPositionAgeSeconds,
        }
      )
    })

    /**
     * Émission réelle vers le boîtier. Le garde-fou `immo.enabled`
     * (IMMOBILIZATION_ENABLED) est porté par le cas d'usage : tant qu'il est
     * à `false`, aucune coupure ne part, quel que soit l'appelant.
     */
    this.app.container.singleton(DispatchEngineCommand, async (resolver) => {
      return new DispatchEngineCommand(
        new LucidUnitOfWork(),
        new LucidDeviceCommandRepository(),
        new LucidVehicleStateReader(),
        new LucidDeviceProviderReader(),
        await resolver.make(FlespiDeviceCommandGateway),
        new SystemClock(),
        new LucidAuditLogger(),
        {
          enabled: immo.enabled,
          maxPositionAgeSeconds: immo.maxPositionAgeSeconds,
        }
      )
    })

    this.app.container.singleton(RequestEngineRestore, () => {
      return new RequestEngineRestore(
        new LucidUnitOfWork(),
        new LucidDeviceCommandRepository(),
        new LucidVehicleStateReader(),
        new SystemClock(),
        new UuidGenerator(),
        new LucidAuditLogger(),
        {
          safetySpeedKph: immo.safetySpeedKph,
          commandTtlMinutes: immo.commandTtlMinutes,
        }
      )
    })

    this.app.container.singleton(ValidateImmobilization, () => {
      return new ValidateImmobilization(
        new LucidUnitOfWork(),
        new LucidDeviceCommandRepository(),
        new LucidVehicleStateReader(),
        new SystemClock(),
        new LucidAuditLogger(),
        immo.maxPositionAgeSeconds
      )
    })

    // ------------------------------------------------------------- identité
    this.registerIdentity()

    // ------------------------------------------------------------- groupes et audit
    // Adaptateurs sans état : un singleton suffit, et le conteneur peut les
    // injecter directement dans les contrôleurs (@inject).
    this.app.container.singleton(
      LucidVehicleGroupMembership,
      () => new LucidVehicleGroupMembership()
    )
    this.app.container.singleton(LucidDeviceGroupMembership, () => new LucidDeviceGroupMembership())
    this.app.container.singleton(LucidAuditLogger, () => new LucidAuditLogger())
    this.app.container.singleton(LucidAuditLogReader, () => new LucidAuditLogReader())
  }

  /**
   * Identité — création d'organisations et de comptes rattachés.
   * Appelé depuis `register()`.
   */
  private registerIdentity() {
    // Adaptateurs sans état : une instance partagée suffit.
    const organizations = new LucidOrganizationRepository()
    const users = new LucidUserAccountRepository()
    const roles = new LucidRoleCatalog()

    this.app.container.singleton(RoleAssignment, () => new RoleAssignment(roles))

    this.app.container.singleton(CreateOrganizationUser, async (resolver) => {
      return new CreateOrganizationUser(
        new LucidUnitOfWork(),
        organizations,
        users,
        await resolver.make(RoleAssignment),
        new AdonisPasswordHasher(),
        new UuidGenerator(),
        new LucidAuditLogger()
      )
    })

    this.app.container.singleton(CreateOrganization, async (resolver) => {
      return new CreateOrganization(
        new LucidUnitOfWork(),
        organizations,
        users,
        roles,
        await resolver.make(RoleAssignment),
        new AdonisPasswordHasher(),
        new UuidGenerator(),
        new LucidAuditLogger()
      )
    })
  }

  async boot() {}
  async start() {}
  async ready() {}
  async shutdown() {}
}
