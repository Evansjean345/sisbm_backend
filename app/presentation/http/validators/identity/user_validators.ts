import vine from '@vinejs/vine'

const USER_STATUS = ['pending', 'active', 'suspended'] as const

export const listUsersValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.enum(USER_STATUS).optional(),
  })
)

export const createUserValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email().normalizeEmail(),
    // 12 caractères minimum : le compte peut demander l'immobilisation d'un
    // véhicule. Le seuil n'est pas aligné sur le confort de saisie.
    password: vine.string().minLength(12).maxLength(128),
    fullName: vine.string().trim().minLength(3).maxLength(120),
    phone: vine
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    roleId: vine.string().uuid(),
    status: vine.enum(USER_STATUS).optional(),
    locale: vine.enum(['fr', 'en'] as const).optional(),
    timezone: vine.string().trim().maxLength(60).optional(),
  })
)

export const updateUserValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().minLength(3).maxLength(120).optional(),
    phone: vine
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    roleId: vine.string().uuid().optional(),
    status: vine.enum(USER_STATUS).optional(),
    locale: vine.enum(['fr', 'en'] as const).optional(),
    timezone: vine.string().trim().maxLength(60).optional(),
  })
)

export const changePasswordValidator = vine.compile(
  vine.object({
    currentPassword: vine.string().minLength(8),
    newPassword: vine.string().minLength(12).maxLength(128).confirmed(),
  })
)
