import vine from '@vinejs/vine'

/**
 * Validation de FORME (VineJS).
 *
 * Les règles structurelles restent en base : unicité de l'immatriculation,
 * contraintes `EXCLUDE` sur les affectations, `CHECK` sur les statuts et les
 * types. Le validateur filtre les entrées manifestement invalides ; la base
 * reste le dernier rempart.
 */

const VEHICLE_TYPES = [
  'car',
  'van',
  'truck',
  'tanker',
  'bus',
  'motorcycle',
  'trailer',
  'machinery',
  'other',
] as const
const VEHICLE_STATUS = ['draft', 'active', 'maintenance', 'inactive', 'archived'] as const
const DEVICE_STATUS = ['stock', 'active', 'maintenance', 'decommissioned'] as const
const MANUFACTURERS = ['micodus', 'teltonika', 'concox', 'queclink', 'other'] as const

export const listVehiclesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    search: vine.string().trim().minLength(1).maxLength(40).optional(),
    status: vine.enum(VEHICLE_STATUS).optional(),
  })
)

export const createVehicleValidator = vine.compile(
  vine.object({
    registration: vine.string().trim().minLength(3).maxLength(20),
    vin: vine
      .string()
      .trim()
      .regex(/^[A-HJ-NPR-Z0-9]{11,17}$/)
      .optional(),
    label: vine.string().trim().maxLength(80).optional(),
    brand: vine.string().trim().maxLength(40).optional(),
    model: vine.string().trim().maxLength(40).optional(),
    year: vine.number().min(1950).max(2100).optional(),
    vehicleType: vine.enum(VEHICLE_TYPES).optional(),
    color: vine.string().trim().maxLength(30).optional(),
    status: vine.enum(VEHICLE_STATUS).optional(),
    odometerKm: vine.number().min(0).optional(),
    /**
     * Seuil PAR VÉHICULE — règle du Jalon 2. Un dépassement déclenche une
     * alerte, il ne coupe plus le moteur.
     */
    speedLimitKph: vine.number().min(1).max(300).optional(),
    immobilizationEnabled: vine.boolean().optional(),
    notes: vine.string().trim().maxLength(500).optional(),
  })
)

export const updateVehicleValidator = vine.compile(
  vine.object({
    registration: vine.string().trim().minLength(3).maxLength(20).optional(),
    label: vine.string().trim().maxLength(80).optional(),
    brand: vine.string().trim().maxLength(40).optional(),
    model: vine.string().trim().maxLength(40).optional(),
    year: vine.number().min(1950).max(2100).optional(),
    vehicleType: vine.enum(VEHICLE_TYPES).optional(),
    color: vine.string().trim().maxLength(30).optional(),
    status: vine.enum(VEHICLE_STATUS).optional(),
    odometerKm: vine.number().min(0).optional(),
    speedLimitKph: vine.number().min(1).max(300).optional(),
    immobilizationEnabled: vine.boolean().optional(),
    notes: vine.string().trim().maxLength(500).optional(),
  })
)

export const listDevicesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.enum(DEVICE_STATUS).optional(),
    search: vine.string().trim().minLength(3).maxLength(20).optional(),
    /** Boîtiers en stock, non montés — la question la plus fréquente en exploitation. */
    unassigned: vine.boolean().optional(),
  })
)

export const createDeviceValidator = vine.compile(
  vine.object({
    /**
     * 15 chiffres exactement. Le `0` de tête exigé par Flespi pour les
     * boîtiers Micodus est ajouté automatiquement dans `flespiIdent` : la base
     * ne contient que des IMEI normalisés.
     */
    /**
     * Chiffres uniquement, SANS limite de longueur : les Micodus font 15
     * caractères, d'autres constructeurs non. Le « 0 » de tête Flespi est
     * retiré par `DeviceIdent`, pas ici.
     */
    imei: vine.string().trim().regex(/^\d+$/),
    //.regex(/^\d{15}$/),
    serialNumber: vine.string().trim().maxLength(40).optional(),
    manufacturer: vine.enum(MANUFACTURERS).optional(),
    model: vine.string().trim().minLength(2).maxLength(40),
    protocol: vine.string().trim().maxLength(40).optional(),
    hasRelay: vine.boolean().optional(),
    simMsisdn: vine
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    simIccid: vine
      .string()
      .trim()
      .regex(/^\d{18,22}$/)
      .optional(),
    simOperator: vine.string().trim().maxLength(40).optional(),
    flespiDeviceId: vine.number().min(1).optional(),
    flespiChannelId: vine.number().min(1).optional(),
    flespiIdent: vine.string().trim().maxLength(30).optional(),
    status: vine.enum(DEVICE_STATUS).optional(),
    notes: vine.string().trim().maxLength(500).optional(),
    /**
     * Crée aussi le device chez Flespi. Exige `flespiChannelId`.
     * Laisser à `false` pour préparer un parc avant d'avoir le canal.
     */
    syncFlespi: vine.boolean().optional(),
    flespiDeviceTypeId: vine.string().trim().maxLength(60).optional(),
  })
)

export const updateDeviceValidator = vine.compile(
  vine.object({
    serialNumber: vine.string().trim().maxLength(40).optional(),
    model: vine.string().trim().minLength(2).maxLength(40).optional(),
    protocol: vine.string().trim().maxLength(40).optional(),
    hasRelay: vine.boolean().optional(),
    simMsisdn: vine
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    simOperator: vine.string().trim().maxLength(40).optional(),
    flespiDeviceId: vine.number().min(1).optional(),
    flespiChannelId: vine.number().min(1).optional(),
    status: vine.enum(DEVICE_STATUS).optional(),
    notes: vine.string().trim().maxLength(500).optional(),
  })
)

export const assignDeviceValidator = vine.compile(
  vine.object({
    vehicleId: vine.string().uuid(),
    installNotes: vine.string().trim().maxLength(300).optional(),
  })
)
