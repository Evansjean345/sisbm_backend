import type { ApplicationService } from '@adonisjs/core/types'
import { LucidUnitOfWork } from '#infrastructure/persistence/unit_of_work'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { SystemClock } from '#infrastructure/services/clock'
import { UuidGenerator } from '#infrastructure/services/id_generator'
import { LucidDeviceCommandRepository } from '#infrastructure/persistence/repositories/device_command_repository'
import { LucidVehicleStateReader } from '#infrastructure/persistence/readers/vehicle_state_reader'
import { RequestImmobilization } from '#application/security/use_cases/request_immobilization'
import { ValidateImmobilization } from '#application/security/use_cases/validate_immobilization'
import sisbmConfig from '#config/sisbm'
import { HttpFlespiCommandGateway } from '#infrastructure/gateways/flespi/flespi_command_gateway'
import { FlespiDeviceGateway } from '#infrastructure/gateways/flespi/flespi_device_gateway'
import {
  LucidPositionRepository,
  LucidVehicleLastPositionRepository,
  LucidIngestMessageRepository,
} from '#infrastructure/persistence/repositories/telemetry_repositories'
import { LucidTripRepository } from '#infrastructure/persistence/repositories/trip_repository'
import { CachedDeviceResolver } from '#infrastructure/persistence/readers/device_resolver'
import { TransmitBroadcaster } from '#infrastructure/realtime/transmit_broadcaster'

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
    this.app.container.singleton(
      HttpFlespiCommandGateway,
      () => new HttpFlespiCommandGateway(flespi)
    )
    this.app.container.singleton(FlespiDeviceGateway, () => new FlespiDeviceGateway(flespi))

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
  }

  async boot() {}
  async start() {}
  async ready() {}
  async shutdown() {}
}
