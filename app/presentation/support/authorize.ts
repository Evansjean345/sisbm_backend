import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import { ForbiddenError } from '#domain/kernel'
import type { PermissionReader } from '#application/ports'
import { LucidPermissionReader } from '#infrastructure/persistence/readers/permission_reader'
import type UserModel from '#infrastructure/persistence/models/user_model'

/**
 * Contrôle d'habilitation.
 *
 * Bouncer 4 n'expose plus `ctx.bouncer` ; les habilitations s'évaluent
 * explicitement. Centraliser ici donne deux avantages : un point unique de
 * décision, et une `ForbiddenError` du domaine plutôt qu'une exception de
 * framework — la réponse garde ainsi le format d'erreur unique de l'API.
 *
 * La lecture passe par un port : la présentation ne touche jamais la base.
 */

type Permission =
  'requestImmobilization' | 'validateImmobilization' | 'viewVehicles' | 'manageVehicles'

/**
 * Demander et VALIDER une immobilisation sont deux permissions distinctes.
 * C'est ce qui rend applicable le principe des quatre yeux : un opérateur
 * peut demander sans pouvoir valider.
 */
const PERMISSION_MAP: Record<Permission, string> = {
  requestImmobilization: 'command:request',
  validateImmobilization: 'command:validate',
  viewVehicles: 'vehicle:read',
  manageVehicles: 'vehicle:write',
}

/** Cache par instance d'utilisateur, donc par requête. */
const cache = new WeakMap<object, string[]>()

export async function authorize(ctx: HttpContext, permission: Permission): Promise<void> {
  const user = ctx.auth.user as UserModel | undefined
  if (!user) throw new ForbiddenError('Authentification requise')
  if (!user.isActive || user.isLocked) {
    throw new ForbiddenError('Compte inactif ou verrouillé')
  }

  let granted = cache.get(user)
  if (!granted) {
    const reader = (await app.container.make(LucidPermissionReader)) as PermissionReader
    granted = await reader.readPermissions(user.roleId)
    cache.set(user, granted)
  }

  const required = PERMISSION_MAP[permission]
  const [resource] = required.split(':')
  const allowed =
    granted.includes('*') || granted.includes(required) || granted.includes(`${resource}:*`)

  if (!allowed) {
    throw new ForbiddenError("Vous n'avez pas l'habilitation requise", { required })
  }
}
