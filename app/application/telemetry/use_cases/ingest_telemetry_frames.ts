import { Ok, type DomainError, type Result } from '#domain/kernel'
import { Coordinates, GpsQuality, Heading, Speed } from '#domain/measures'
import { TelemetryReading } from '#domain/telemetry/entities/telemetry_reading'
import { Trip } from '#domain/telemetry/entities/trip'
import { DeviceId, DeviceIdent, TripId, VehicleId } from '#domain/telemetry/value_objects'
import type { QualityThresholds } from '#domain/telemetry/services/quality_filter'
import type {
  IngestMessageRepository,
  PositionRepository,
  TripRepository,
  VehicleLastPositionRepository,
} from '#domain/telemetry/repositories/telemetry_repositories'
import { UnknownDeviceError } from '#domain/telemetry/errors'
import { IgnitionTurnedOff, IgnitionTurnedOn, PositionRecorded } from '#domain/telemetry/events'
import type { Clock, IdGenerator, UnitOfWork, UseCase } from '#application/ports'
import type {
  DeviceResolver,
  RealtimeBroadcaster,
  TelemetryFrame,
} from '#application/telemetry/ports'

export interface IngestTelemetryInput {
  frames: TelemetryFrame[]
}

export interface IngestTelemetryOutput {
  received: number
  persisted: number
  rejected: number
  unknownDevices: number
  tripsStarted: number
  tripsClosed: number
  /**
   * Trames déjà présentes (`ON CONFLICT DO NOTHING`), typiquement un rejeu de
   * session MQTT. À distinguer d'un échec : sans cette mesure, un rejeu complet
   * s'affiche « 0 persistée » et se lit comme une panne.
   */
  duplicates: number
  /**
   * Décompte par MOTIF de rejet (`null_island`, `invalid_fix`, `poor_hdop`,
   * `few_satellites`, `future_timestamp`, `implausible_jump`…).
   *
   * Sans ce détail, le worker annonce « 6 rejetée(s) » et rien ne permet de
   * savoir s'il faut sortir le véhicule du parking souterrain, corriger un
   * seuil ou soupçonner le boîtier. C'est la mesure qui rend l'ingestion
   * diagnosticable.
   */
  rejectedReasons: Record<string, number>
}

export interface IngestSettings extends QualityThresholds {
  backlogThresholdSeconds: number
  tripIdleTimeoutSeconds: number
  tripMaxDurationHours: number
  tripMinDistanceMeters: number
  idleSpeedThresholdKph: number
}

/**
 * =========================================================================
 *  CAS D'USAGE — Ingestion de trames de télémétrie
 * =========================================================================
 *
 * Orchestration pure : ce cas d'usage ne DÉCIDE rien. Il résout le boîtier,
 * délègue la qualification au domaine, persiste, ajuste le trajet et publie.
 * Toute règle qui apparaîtrait ici serait au mauvais endroit.
 *
 * Traite un LOT plutôt qu'une trame unitaire : au sortir d'une zone blanche,
 * un boîtier rejoue des centaines de points d'un coup. Une transaction pour
 * 200 points plutôt que 200 transactions.
 *
 * Isolation `read committed` : les insertions sont indépendantes et la clé
 * d'idempotence absorbe les concurrences. Le verrou consultatif ne porte que
 * sur le trajet.
 */
export class IngestTelemetryFrames implements UseCase<IngestTelemetryInput, IngestTelemetryOutput> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ingestMessages: IngestMessageRepository,
    private readonly positions: PositionRepository,
    private readonly lastPositions: VehicleLastPositionRepository,
    private readonly trips: TripRepository,
    private readonly devices: DeviceResolver,
    private readonly broadcaster: RealtimeBroadcaster,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly settings: IngestSettings
  ) {}

  async execute(input: IngestTelemetryInput): Promise<Result<IngestTelemetryOutput, DomainError>> {
    const now = this.clock.now()
    const out: IngestTelemetryOutput = {
      received: input.frames.length,
      persisted: 0,
      rejected: 0,
      unknownDevices: 0,
      tripsStarted: 0,
      tripsClosed: 0,
      duplicates: 0,
      rejectedReasons: {},
    }
    if (input.frames.length === 0) return Ok(out)

    // ---- 1. Regrouper par boîtier : chaque boîtier a son propre trajet et son
    //         propre point de référence pour le contrôle de plausibilité.
    const parLot = new Map<string, TelemetryFrame[]>()
    for (const f of input.frames) {
      const ident = DeviceIdent.create(f.ident)
      if (!ident.ok) {
        this.compter(out, 'ident_invalide')
        continue
      }
      const cle = ident.value.imei
      if (!parLot.has(cle)) parLot.set(cle, [])
      parLot.get(cle)!.push(f)
    }

    for (const [imei, frames] of parLot) {
      const resultat = await this.ingestDevice(imei, frames, now, out)
      if (!resultat.ok) return resultat
    }

    return Ok(out)
  }

  // -------------------------------------------------------------------------

  private async ingestDevice(
    imei: string,
    frames: TelemetryFrame[],
    now: Date,
    out: IngestTelemetryOutput
  ): Promise<Result<void, DomainError>> {
    const device = await this.devices.resolve(imei)

    // Boîtier inconnu : la trame est journalisée mais non exploitée. Elle
    // pourra être rejouée après enregistrement du boîtier — d'où l'intérêt
    // de conserver `ingest_messages`.
    if (!device) {
      out.unknownDevices += frames.length
      await this.journaliserInconnues(imei, frames)
      return Ok(undefined)
    }

    // Chronologie stricte : le Store & Forward ne garantit pas l'ordre.
    frames.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())

    const dernierFix = await this.positions.findLastValidFix(DeviceId.from(device.deviceId))
    let reference = dernierFix
      ? {
          coordinates: Coordinates.trusted(dernierFix.latitude, dernierFix.longitude),
          recordedAt: dernierFix.recordedAt,
        }
      : null

    const lectures: TelemetryReading[] = []
    for (const frame of frames) {
      const lecture = this.qualifier(frame, device, reference, now)
      if (!lecture) {
        this.compter(out, 'mesure_hors_domaine')
        continue
      }
      lectures.push(lecture)
      // Seul un point VALIDE devient la nouvelle référence : sinon une position
      // aberrante deviendrait le repère et rejetterait les points corrects.
      if (lecture.isValid) {
        reference = { coordinates: lecture.coordinates, recordedAt: lecture.recordedAt }
      }
    }
    if (lectures.length === 0) return Ok(undefined)

    return this.unitOfWork.run(async (tx) => {
      // ---- Journal des trames brutes
      for (const f of frames) {
        await this.ingestMessages.record(
          {
            source: 'flespi',
            externalId: f.externalId,
            deviceIdent: imei,
            deviceId: device.deviceId,
            payload: f.raw,
            receivedAt: f.receivedAt,
          },
          tx
        )
      }

      // ---- Positions, par lot et idempotentes
      const inserees = await this.positions.insertBatch(
        lectures.map((l) => l.toPersistence()),
        tx
      )
      out.persisted += inserees
      // Écart entre lignes soumises et lignes écrites = doublons ignorés par
      // `ON CONFLICT DO NOTHING`, donc un rejeu, pas un échec.
      out.duplicates += Math.max(0, lectures.length - inserees)
      for (const l of lectures) {
        if (!l.isValid) this.compter(out, l.invalidReason ?? 'inconnu')
      }

      // ---- État courant : uniquement le dernier point temps réel
      const live = lectures.filter((l) => l.isLive)
      const dernier = live.at(-1)

      // `vehicle_last_positions` est indexée PAR VÉHICULE : un boîtier en
      // stock, ou installé mais pas encore rattaché, n'y a pas sa place.
      // Sans cette garde, une seule trame d'un boîtier non affecté fait
      // échouer la transaction et donc TOUT le lot.
      if (dernier && device.vehicleId) {
        await this.lastPositions.upsert(dernier.toPersistence(), tx)
      }

      // ---- Trajets
      if (device.vehicleId) {
        await this.majTrajet(device, lectures, tx, out)
      }

      // ---- Événements de domaine → outbox, publiés après COMMIT
      if (dernier) {
        tx.collect([
          new PositionRecorded(device.deviceId, {
            organizationId: device.organizationId,
            vehicleId: device.vehicleId,
            recordedAt: dernier.recordedAt.toISOString(),
            latitude: dernier.coordinates.latitude,
            longitude: dernier.coordinates.longitude,
            speedKph: dernier.speed.kph,
            ignition: dernier.ignitionState,
          }),
        ])
      }

      for (const f of frames) {
        await this.ingestMessages.markProcessed(f.externalId, f.receivedAt, tx)
      }

      // ---- Diffusion temps réel, hors transaction critique
      if (dernier) {
        await this.broadcaster.publishPosition(device.organizationId, {
          vehicleId: device.vehicleId,
          deviceId: device.deviceId,
          latitude: dernier.coordinates.latitude,
          longitude: dernier.coordinates.longitude,
          speedKph: dernier.speed.kph,
          ignition: dernier.ignitionState,
          recordedAt: dernier.recordedAt.toISOString(),
        })
      }

      return Ok(undefined)
    })
  }

  // -------------------------------------------------------------------------

  /** Incrémente le total de rejets ET le compteur du motif. */
  private compter(out: IngestTelemetryOutput, motif: string): void {
    out.rejected += 1
    out.rejectedReasons[motif] = (out.rejectedReasons[motif] ?? 0) + 1
  }

  private qualifier(
    frame: TelemetryFrame,
    device: { deviceId: string; organizationId: string; vehicleId: string | null },
    reference: { coordinates: Coordinates; recordedAt: Date } | null,
    now: Date
  ): TelemetryReading | null {
    const coords = Coordinates.create(frame.latitude, frame.longitude)
    const speed = Speed.fromKph(Math.max(0, frame.speedKph ?? 0))
    const ident = DeviceIdent.create(frame.ident)
    if (!coords.ok || !speed.ok || !ident.ok) return null

    const heading = frame.headingDeg === null ? null : Heading.fromDegrees(frame.headingDeg)

    return TelemetryReading.qualify(
      {
        organizationId: device.organizationId,
        deviceId: DeviceId.from(device.deviceId),
        vehicleId: device.vehicleId ? VehicleId.from(device.vehicleId) : null,
        ident: ident.value,
        recordedAt: frame.recordedAt,
        receivedAt: frame.receivedAt,
        coordinates: coords.value,
        speed: speed.value,
        heading: heading && heading.ok ? heading.value : null,
        quality: GpsQuality.create({
          hdop: frame.hdop,
          satellites: frame.satellites,
          isValidFix: frame.isValidFix,
        }),
        altitudeM: frame.altitudeM,
        ignition: frame.ignition,
        movement: frame.movement,
        gsmSignal: frame.gsmSignal,
        batteryPct: frame.batteryPct,
        externalVoltageV: frame.externalVoltageV,
        source: 'flespi',
        raw: frame.raw,
      },
      reference,
      this.settings,
      this.settings.backlogThresholdSeconds,
      now
    )
  }

  /**
   * Reconstitution du trajet.
   *
   * Le trajet ouvre sur un contact ON et clôt sur un contact OFF. Les positions
   * hors trajet — contact inconnu, véhicule non affecté — sont historisées sans
   * rattachement : elles restent consultables sans fausser les kilométrages.
   */
  private async majTrajet(
    device: { deviceId: string; organizationId: string; vehicleId: string | null },
    lectures: TelemetryReading[],
    tx: import('#application/ports').TransactionScope,
    out: IngestTelemetryOutput
  ): Promise<void> {
    const vehicleId = VehicleId.from(device.vehicleId!)
    let trip = await this.trips.findOpenByVehicle(vehicleId, tx)

    for (const l of lectures) {
      if (!l.countsForTrip) continue

      if (l.ignitionState === 'on') {
        if (!trip) {
          trip = Trip.start({
            id: TripId.from(this.ids.generate()),
            organizationId: device.organizationId,
            vehicleId,
            deviceId: DeviceId.from(device.deviceId),
            at: l.recordedAt,
            location: l.coordinates,
            speed: l.speed,
          })
          out.tripsStarted += 1
          tx.collect([
            new IgnitionTurnedOn(device.deviceId, {
              vehicleId: device.vehicleId,
              at: l.recordedAt.toISOString(),
            }),
          ])
        } else {
          trip.addPosition({
            at: l.recordedAt,
            location: l.coordinates,
            speed: l.speed,
            idleThresholdKph: this.settings.idleSpeedThresholdKph,
          })
        }
        continue
      }

      if (l.ignitionState === 'off' && trip) {
        trip.addPosition({
          at: l.recordedAt,
          location: l.coordinates,
          speed: l.speed,
          idleThresholdKph: this.settings.idleSpeedThresholdKph,
        })
        trip.close({
          at: l.recordedAt,
          reason: 'ignition_off',
          minDistanceMeters: this.settings.tripMinDistanceMeters,
        })
        await this.trips.save(trip, tx)
        tx.collect(trip.pullDomainEvents())
        tx.collect([
          new IgnitionTurnedOff(device.deviceId, {
            vehicleId: device.vehicleId,
            at: l.recordedAt.toISOString(),
          }),
        ])
        out.tripsClosed += 1
        trip = null
      }
    }

    if (trip) {
      await this.trips.save(trip, tx)
      tx.collect(trip.pullDomainEvents())
    }
  }

  private async journaliserInconnues(imei: string, frames: TelemetryFrame[]): Promise<void> {
    await this.unitOfWork.run(async (tx) => {
      for (const f of frames) {
        await this.ingestMessages.record(
          {
            source: 'flespi',
            externalId: f.externalId,
            deviceIdent: imei,
            deviceId: null,
            payload: f.raw,
            receivedAt: f.receivedAt,
          },
          tx
        )
        await this.ingestMessages.markRejected(
          f.externalId,
          f.receivedAt,
          new UnknownDeviceError(imei).message,
          tx
        )
      }
      return Ok(undefined)
    })
  }
}
