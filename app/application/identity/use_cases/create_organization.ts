import { Err, Ok, type DomainError, type Result } from '#domain/kernel'
import type {
  AuditLogger,
  ExecutionContext,
  IdGenerator,
  UnitOfWork,
  UseCase,
} from '#application/ports'
import type {
  OrganizationRecord,
  OrganizationRepository,
  PasswordHasher,
  RoleCatalog,
  UserAccountRepository,
} from '#application/identity/ports'
import type { RoleAssignment } from '#application/identity/services/role_assignment'
import type { CreatedUserAccount } from '#application/identity/use_cases/create_organization_user'
import { ORGANIZATION_OWNER_ROLE } from '#domain/identity/role_policy'
import {
  EmailTakenError,
  InvalidRoleError,
  OrganizationCodeTakenError,
} from '#domain/identity/errors'
import { OrganizationCreated, UserAccountCreated } from '#domain/identity/events'

export interface NewOrganizationInput {
  code: string
  name: string
  contactEmail?: string | null
  contactPhone?: string | null
  countryCode?: string
  timezone?: string
  currency?: string
  settings?: Record<string, unknown>
}

/** Premier compte de l'organisation : il reçoit le rôle système `admin`. */
export interface OwnerAccountInput {
  email: string
  password: string
  fullName: string
  phone?: string | null
  locale?: string
}

export interface CreateOrganizationInput {
  context: ExecutionContext
  actorPermissions: readonly string[]
  organization: NewOrganizationInput
  admin?: OwnerAccountInput
}

export interface CreateOrganizationOutput {
  organization: OrganizationRecord
  admin: CreatedUserAccount | null
}

/**
 * =========================================================================
 *  CAS D'USAGE — Créer une organisation (client) et son administrateur
 * =========================================================================
 *
 * TOUT OU RIEN. Une organisation sans administrateur est inexploitable :
 * personne ne peut s'y connecter pour créer les véhicules et les comptes.
 * Un administrateur sans organisation est impossible (FK NOT NULL). Les deux
 * sont donc écrits dans UNE transaction.
 *
 * L'administrateur est facultatif pour un seul cas : l'exploitant qui prépare
 * le compte d'un client avant d'en connaître le responsable. Il le rattache
 * ensuite par `POST /organizations/:id/users`.
 *
 * Réservé à l'exploitant plateforme : le contrôle `organization:write` est fait
 * par la présentation, et la règle de non-escalade s'applique quand même au
 * rôle attribué — aucun chemin ne la contourne.
 */
export class CreateOrganization implements UseCase<
  CreateOrganizationInput,
  CreateOrganizationOutput
> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizations: OrganizationRepository,
    private readonly users: UserAccountRepository,
    private readonly roles: RoleCatalog,
    private readonly roleAssignment: RoleAssignment,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
    private readonly audit: AuditLogger
  ) {}

  async execute(
    input: CreateOrganizationInput
  ): Promise<Result<CreateOrganizationOutput, DomainError>> {
    const code = input.organization.code.trim().toLowerCase()
    // Identifiant connu AVANT l'écriture : il sert de périmètre au contrôle du rôle.
    const organizationId = this.ids.generate()

    // ---- 1. unicité du code (parmi les organisations non supprimées)
    if (await this.organizations.codeExists(code)) {
      return Err(new OrganizationCodeTakenError(code))
    }

    // ---- 2. préparation de l'administrateur, AVANT toute écriture
    let owner: {
      id: string
      email: string
      passwordHash: string
      roleId: string
      roleCode: string
      input: OwnerAccountInput
    } | null = null

    if (input.admin) {
      const email = input.admin.email.trim().toLowerCase()
      if (await this.users.emailExists(email)) return Err(new EmailTakenError(email))

      const ownerRole = await this.roles.findSystemRole(ORGANIZATION_OWNER_ROLE)
      if (!ownerRole) return Err(new InvalidRoleError(ORGANIZATION_OWNER_ROLE))

      const checked = await this.roleAssignment.check({
        roleId: ownerRole.id,
        targetOrganizationId: organizationId,
        actorPermissions: input.actorPermissions,
      })
      if (!checked.ok) return checked

      owner = {
        id: this.ids.generate(),
        email,
        passwordHash: await this.hasher.make(input.admin.password),
        roleId: checked.value.id,
        roleCode: checked.value.code,
        input: input.admin,
      }
    }

    const timezone = input.organization.timezone ?? 'Africa/Abidjan'

    // ---- 3. écriture atomique
    return this.unitOfWork.run(async (tx) => {
      const organization = await this.organizations.insert(
        organizationId,
        {
          code,
          name: input.organization.name.trim(),
          contactEmail: input.organization.contactEmail?.trim().toLowerCase() ?? null,
          contactPhone: input.organization.contactPhone ?? null,
          countryCode: (input.organization.countryCode ?? 'CI').toUpperCase(),
          timezone,
          currency: (input.organization.currency ?? 'XOF').toUpperCase(),
          isActive: true,
          settings: input.organization.settings ?? {},
        },
        tx
      )
      tx.collect([new OrganizationCreated(organization.id, { code, name: organization.name })])

      // L'acte est rangé dans le journal du NOUVEAU client.
      const auditContext = { ...input.context, organizationId: organization.id }
      await this.audit.record({
        context: auditContext,
        action: 'identity.organization.created',
        resourceType: 'organization',
        resourceId: organization.id,
        after: organization as unknown as Record<string, unknown>,
        metadata: { actorOrganizationId: input.context.organizationId },
      })

      let admin: CreatedUserAccount | null = null
      if (owner) {
        const created = await this.users.insert(
          owner.id,
          {
            organizationId: organization.id,
            roleId: owner.roleId,
            email: owner.email,
            passwordHash: owner.passwordHash,
            fullName: owner.input.fullName.trim(),
            phone: owner.input.phone ?? null,
            status: 'active',
            locale: owner.input.locale ?? 'fr',
            timezone,
          },
          tx
        )
        tx.collect([
          new UserAccountCreated(created.id, {
            organizationId: organization.id,
            email: created.email,
            roleCode: owner.roleCode,
            status: created.status,
          }),
        ])
        await this.audit.record({
          context: auditContext,
          action: 'identity.user.created',
          resourceType: 'user',
          resourceId: created.id,
          after: { ...created, role: owner.roleCode } as unknown as Record<string, unknown>,
          metadata: { actorOrganizationId: input.context.organizationId, bootstrap: true },
        })
        admin = { ...created, role: { id: owner.roleId, code: owner.roleCode } }
      }

      return Ok({ organization, admin })
    })
  }
}
