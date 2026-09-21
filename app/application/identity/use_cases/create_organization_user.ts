import { Err, Ok, type DomainError, type Result } from '#domain/kernel'
import type {
  AuditLogger,
  ExecutionContext,
  IdGenerator,
  UnitOfWork,
  UseCase,
} from '#application/ports'
import type {
  OrganizationRepository,
  PasswordHasher,
  UserAccountRecord,
  UserAccountRepository,
  UserStatus,
} from '#application/identity/ports'
import type { RoleAssignment } from '#application/identity/services/role_assignment'
import {
  EmailTakenError,
  OrganizationInactiveError,
  OrganizationNotFoundError,
} from '#domain/identity/errors'
import { UserAccountCreated } from '#domain/identity/events'

export interface NewUserInput {
  email: string
  password: string
  fullName: string
  phone?: string | null
  roleId: string
  status?: UserStatus
  locale?: string
  /** Par défaut : le fuseau de l'organisation. */
  timezone?: string
}

export interface CreateOrganizationUserInput {
  context: ExecutionContext
  /** Habilitations de l'acteur — nécessaires à la règle de non-escalade. */
  actorPermissions: readonly string[]
  /** Organisation CIBLE : celle de l'acteur, ou une autre pour l'exploitant plateforme. */
  organizationId: string
  user: NewUserInput
}

export interface CreatedUserAccount extends UserAccountRecord {
  role: { id: string; code: string }
}

/**
 * =========================================================================
 *  CAS D'USAGE — Créer un compte rattaché à une organisation
 * =========================================================================
 *
 * Point d'entrée UNIQUE de création de compte, quel que soit le chemin :
 *
 *   POST /users                     → l'administrateur, dans SON organisation
 *   POST /organizations/:id/users   → l'exploitant plateforme, dans n'importe laquelle
 *
 * Les contrôles lourds (existence, unicité, rôle) sont faits AVANT la
 * transaction, et le hachage aussi : on ne garde pas une connexion ouverte
 * pendant les ~100 ms d'une dérivation de clé. Une course entre deux
 * créations simultanées du même e-mail reste tenue par l'index unique
 * `uq_users_email`, traduit en 409 par le gestionnaire d'exceptions.
 */
export class CreateOrganizationUser implements UseCase<
  CreateOrganizationUserInput,
  CreatedUserAccount
> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizations: OrganizationRepository,
    private readonly users: UserAccountRepository,
    private readonly roleAssignment: RoleAssignment,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
    private readonly audit: AuditLogger
  ) {}

  async execute(
    input: CreateOrganizationUserInput
  ): Promise<Result<CreatedUserAccount, DomainError>> {
    // ---- 1. organisation cible : existante ET active
    const organization = await this.organizations.findById(input.organizationId)
    if (!organization) return Err(new OrganizationNotFoundError(input.organizationId))
    if (!organization.isActive) return Err(new OrganizationInactiveError(organization.id))

    // ---- 2. unicité de l'identifiant de connexion
    const email = input.user.email.trim().toLowerCase()
    if (await this.users.emailExists(email)) return Err(new EmailTakenError(email))

    // ---- 3. cloisonnement + non-escalade
    const role = await this.roleAssignment.check({
      roleId: input.user.roleId,
      targetOrganizationId: organization.id,
      actorPermissions: input.actorPermissions,
    })
    if (!role.ok) return role

    // ---- 4. hachage, hors transaction
    const passwordHash = await this.hasher.make(input.user.password)
    const userId = this.ids.generate()

    // ---- 5. écriture + événement + trace
    return this.unitOfWork.run(async (tx) => {
      const created = await this.users.insert(
        userId,
        {
          organizationId: organization.id,
          roleId: role.value.id,
          email,
          passwordHash,
          fullName: input.user.fullName,
          phone: input.user.phone ?? null,
          status: input.user.status ?? 'active',
          locale: input.user.locale ?? 'fr',
          timezone: input.user.timezone ?? organization.timezone,
        },
        tx
      )

      tx.collect([
        new UserAccountCreated(created.id, {
          organizationId: organization.id,
          email: created.email,
          roleCode: role.value.code,
          status: created.status,
        }),
      ])

      // La trace est rangée dans l'organisation CIBLE : c'est son journal que
      // le client consultera. L'organisation de l'acteur reste en métadonnée.
      await this.audit.record({
        context: { ...input.context, organizationId: organization.id },
        action: 'identity.user.created',
        resourceType: 'user',
        resourceId: created.id,
        after: { ...created, role: role.value.code } as unknown as Record<string, unknown>,
        metadata: { actorOrganizationId: input.context.organizationId },
      })

      return Ok({ ...created, role: { id: role.value.id, code: role.value.code } })
    })
  }
}
