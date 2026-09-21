import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'

/**
 * Schémas des organisations.
 *
 * Ils reprennent À L'IDENTIQUE les CHECK de la table `organizations`
 * (`ck_organizations_code`, `ck_organizations_phone`) : une donnée refusée
 * par la base doit l'être ici d'abord, avec un message exploitable, plutôt
 * qu'en 409 « contrainte d'intégrité ».
 */

const E164 = /^\+[1-9]\d{7,14}$/

/** Fuseau IANA réellement connu du moteur (`Africa/Abidjan`, `Europe/Paris`…). */
const ianaTimezone = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
  } catch {
    field.report('Le champ {{ field }} doit être un fuseau horaire IANA valide', 'timezone', field)
  }
})

/** Premier administrateur, créé dans la même transaction que l'organisation. */
const ownerSchema = vine.object({
  email: vine.string().trim().email().normalizeEmail(),
  // Même seuil que `createUserValidator` : ce compte pourra demander une
  // immobilisation et créer d'autres comptes.
  password: vine.string().minLength(12).maxLength(128),
  fullName: vine.string().trim().minLength(3).maxLength(120),
  phone: vine.string().trim().regex(E164).optional(),
  locale: vine.enum(['fr', 'en'] as const).optional(),
})

export const createOrganizationValidator = vine.compile(
  vine.object({
    code: vine
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_-]{2,40}$/),
    name: vine.string().trim().minLength(2).maxLength(150),
    contactEmail: vine.string().trim().email().normalizeEmail().optional(),
    contactPhone: vine.string().trim().regex(E164).optional(),
    countryCode: vine
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    timezone: vine.string().trim().maxLength(60).use(ianaTimezone()).optional(),
    currency: vine
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    settings: vine.record(vine.any()).optional(),
    admin: ownerSchema.optional(),
  })
)

/**
 * Le `code` n'est PAS modifiable : il sert d'identifiant stable aux
 * intégrations tierces (ERP, SIEM) et aux exports. Le changer casserait
 * silencieusement leurs rapprochements.
 */
export const updateOrganizationValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(150).optional(),
    contactEmail: vine.string().trim().email().normalizeEmail().optional(),
    contactPhone: vine.string().trim().regex(E164).optional(),
    countryCode: vine
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    timezone: vine.string().trim().maxLength(60).use(ianaTimezone()).optional(),
    currency: vine
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    isActive: vine.boolean().optional(),
    settings: vine.record(vine.any()).optional(),
  })
)

export const listOrganizationsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    search: vine.string().trim().maxLength(100).optional(),
    isActive: vine.boolean().optional(),
  })
)
