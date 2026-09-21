import { test } from '@japa/runner'
import type { TransactionScope, DomainEvent } from '#domain/kernel'
import type { AuditLogger, ExecutionContext, IdGenerator, UnitOfWork } from '#application/ports'
import type {
  OrganizationData,
  OrganizationRecord,
  OrganizationRepository,
  PasswordHasher,
  RoleCatalog,
  UserAccountData,
  UserAccountRecord,
  UserAccountRepository,
} from '#application/identity/ports'
import { RoleAssignment } from '#application/identity/services/role_assignment'
import { CreateOrganization } from '#application/identity/use_cases/create_organization'
import { CreateOrganizationUser } from '#application/identity/use_cases/create_organization_user'
import { covers, missingPermissions, type AssignableRole } from '#domain/identity/role_policy'

/**
 * =========================================================================
 *  IDENTITÉ — création d'organisations et de comptes, sans base
 * =========================================================================
 *
 * Ce qui est vérifié ici est ce qui coûterait le plus cher en production :
 * une fuite entre clients (cloisonnement) et une élévation de privilèges
 * (non-escalade). Les deux se testent en mémoire, en quelques millisecondes.
 */

// ---------------------------------------------------------------- fixtures

const ORG_SISBM = '11111111-1111-4111-8111-111111111111'
const ORG_CLIENT = '22222222-2222-4222-8222-222222222222'
const ORG_AUTRE = '33333333-3333-4333-8333-333333333333'

const ROLES: AssignableRole[] = [
  { id: 'r-super', code: 'super_admin', organizationId: null, permissions: ['*'] },
  {
    id: 'r-admin',
    code: 'admin',
    organizationId: null,
    permissions: ['vehicle:*', 'device:*', 'user:*', 'command:*'],
  },
  { id: 'r-viewer', code: 'viewer', organizationId: null, permissions: ['vehicle:read'] },
  { id: 'r-autre', code: 'chef', organizationId: ORG_AUTRE, permissions: ['vehicle:read'] },
]

const SUPER_ADMIN = ['*']
const ADMIN = ['vehicle:*', 'device:*', 'user:*', 'command:*']

const CONTEXTE: ExecutionContext = {
  actorId: '44444444-4444-4444-8444-444444444444',
  actorType: 'user',
  organizationId: ORG_SISBM,
}

function organisation(id: string, overrides: Partial<OrganizationRecord> = {}): OrganizationRecord {
  return {
    id,
    code: `org-${id.slice(0, 4)}`,
    name: 'Client',
    contactEmail: null,
    contactPhone: null,
    countryCode: 'CI',
    timezone: 'Africa/Abidjan',
    currency: 'XOF',
    isActive: true,
    settings: {},
    createdAt: new Date(),
    ...overrides,
  }
}

function assert_(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

/** Monde en mémoire : dépôts, UoW, audit. Tout ce qui est écrit est observable. */
function monde(options: { organisations?: OrganizationRecord[]; emails?: string[] } = {}) {
  const organisations = new Map((options.organisations ?? []).map((o) => [o.id, o]))
  const comptes: UserAccountRecord[] = []
  const emails = new Set(options.emails ?? [])
  const evenements: DomainEvent[] = []
  const audit: string[] = []
  let transactions = 0
  let sequence = 0

  const organizationRepo: OrganizationRepository = {
    async codeExists(code) {
      return [...organisations.values()].some((o) => o.code === code)
    },
    async findById(id) {
      return organisations.get(id) ?? null
    },
    async insert(id, data: OrganizationData) {
      const record = { id, ...data, createdAt: new Date() }
      organisations.set(id, record)
      return record
    },
  }

  const userRepo: UserAccountRepository = {
    async emailExists(email) {
      return emails.has(email)
    },
    async insert(id, data: UserAccountData) {
      const { passwordHash, ...rest } = data
      assert_(passwordHash.startsWith('hash('), 'le mot de passe doit arriver haché')
      const record = { id, ...rest, createdAt: new Date() }
      comptes.push(record)
      emails.add(data.email)
      return record
    },
  }

  const roles: RoleCatalog = {
    async findById(id) {
      return ROLES.find((r) => r.id === id) ?? null
    },
    async findSystemRole(code) {
      return ROLES.find((r) => r.code === code && r.organizationId === null) ?? null
    },
  }

  const uow: UnitOfWork = {
    async run(handler) {
      transactions++
      const scope: TransactionScope = {
        raw: null,
        collect: (events) => evenements.push(...events),
      }
      return handler(scope)
    },
  }

  const hasher: PasswordHasher = { make: async (p) => `hash(${p})` }
  const ids: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  }
  const auditLogger: AuditLogger = {
    async record(entry) {
      audit.push(`${entry.action}@${entry.context.organizationId}`)
    },
  }

  const assignment = new RoleAssignment(roles)
  return {
    organisations,
    comptes,
    evenements,
    audit,
    get transactions() {
      return transactions
    },
    createUser: new CreateOrganizationUser(
      uow,
      organizationRepo,
      userRepo,
      assignment,
      hasher,
      ids,
      auditLogger
    ),
    createOrganization: new CreateOrganization(
      uow,
      organizationRepo,
      userRepo,
      roles,
      assignment,
      hasher,
      ids,
      auditLogger
    ),
  }
}

const NOUVEAU_COMPTE = {
  email: 'Agent@Client.ci',
  password: 'MotDePasse2026!',
  fullName: 'Agent Client',
  roleId: 'r-viewer',
}

// ---------------------------------------------------------------- règles pures

test.group('Identité — couverture des habilitations', () => {
  test('le joker absolu couvre tout', ({ assert }) => {
    assert.isTrue(covers(['*'], 'vehicle:read'))
    assert.isTrue(covers(['*'], '*'))
  })

  test('le joker de ressource couvre ses actions, pas le joker absolu', ({ assert }) => {
    assert.isTrue(covers(['vehicle:*'], 'vehicle:read'))
    assert.isTrue(covers(['vehicle:*'], 'vehicle:*'))
    assert.isFalse(covers(['vehicle:*'], '*'))
    assert.isFalse(covers(['vehicle:*'], 'device:read'))
  })

  test('une action ne couvre pas le joker de sa ressource', ({ assert }) => {
    assert.isFalse(covers(['vehicle:read'], 'vehicle:*'))
  })

  test("un administrateur ne détient pas ce qu'exige super_admin", ({ assert }) => {
    assert.deepEqual(missingPermissions(ADMIN, ROLES[0]), ['*'])
    assert.deepEqual(missingPermissions(ADMIN, ROLES[1]), [])
  })
})

// ---------------------------------------------------------------- création de compte

test.group('Identité — créer un compte rattaché', () => {
  test("crée le compte dans l'organisation cible, e-mail normalisé", async ({ assert }) => {
    const m = monde({ organisations: [organisation(ORG_CLIENT)] })

    const r = await m.createUser.execute({
      context: CONTEXTE,
      actorPermissions: SUPER_ADMIN,
      organizationId: ORG_CLIENT,
      user: NOUVEAU_COMPTE,
    })

    assert.isTrue(r.ok)
    assert.lengthOf(m.comptes, 1)
    assert.equal(m.comptes[0].organizationId, ORG_CLIENT)
    assert.equal(m.comptes[0].email, 'agent@client.ci')
    assert.equal(m.comptes[0].timezone, 'Africa/Abidjan')
    assert.notProperty(m.comptes[0], 'passwordHash')
    assert.deepEqual(
      m.evenements.map((e) => e.eventName),
      ['identity.user.created']
    )
    // Tracé dans le journal du CLIENT, pas dans celui de l'exploitant.
    assert.deepEqual(m.audit, [`identity.user.created@${ORG_CLIENT}`])
  })

  test('refuse une organisation inconnue', async ({ assert }) => {
    const m = monde()
    const r = await m.createUser.execute({
      context: CONTEXTE,
      actorPermissions: SUPER_ADMIN,
      organizationId: ORG_CLIENT,
      user: NOUVEAU_COMPTE,
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_ORGANIZATION_NOT_FOUND')
  })

  test('refuse une organisation désactivée', async ({ assert }) => {
    const m = monde({ organisations: [organisation(ORG_CLIENT, { isActive: false })] })
    const r = await m.createUser.execute({
      context: CONTEXTE,
      actorPermissions: SUPER_ADMIN,
      organizationId: ORG_CLIENT,
      user: NOUVEAU_COMPTE,
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_ORGANIZATION_INACTIVE')
    assert.equal(m.transactions, 0)
  })

  test('refuse un e-mail déjà utilisé, quelle que soit la casse', async ({ assert }) => {
    const m = monde({ organisations: [organisation(ORG_CLIENT)], emails: ['agent@client.ci'] })
    const r = await m.createUser.execute({
      context: CONTEXTE,
      actorPermissions: SUPER_ADMIN,
      organizationId: ORG_CLIENT,
      user: NOUVEAU_COMPTE,
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_EMAIL_TAKEN')
  })

  test('CLOISONNEMENT — refuse le rôle propre à une autre organisation', async ({ assert }) => {
    const m = monde({ organisations: [organisation(ORG_CLIENT)] })
    const r = await m.createUser.execute({
      context: CONTEXTE,
      actorPermissions: SUPER_ADMIN,
      organizationId: ORG_CLIENT,
      user: { ...NOUVEAU_COMPTE, roleId: 'r-autre' },
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_INVALID_ROLE')
    assert.lengthOf(m.comptes, 0)
  })

  test('NON-ESCALADE — un administrateur ne peut pas créer de super_admin', async ({ assert }) => {
    const m = monde({ organisations: [organisation(ORG_CLIENT)] })
    const r = await m.createUser.execute({
      context: { ...CONTEXTE, organizationId: ORG_CLIENT },
      actorPermissions: ADMIN,
      organizationId: ORG_CLIENT,
      user: { ...NOUVEAU_COMPTE, roleId: 'r-super' },
    })
    assert.isFalse(r.ok)
    if (!r.ok) {
      assert.equal(r.error.code, 'E_ROLE_ESCALATION')
      assert.equal(r.error.httpStatus, 403)
    }
    assert.lengthOf(m.comptes, 0)
  })

  test('un administrateur peut créer un compte de rôle inférieur', async ({ assert }) => {
    const m = monde({ organisations: [organisation(ORG_CLIENT)] })
    const r = await m.createUser.execute({
      context: { ...CONTEXTE, organizationId: ORG_CLIENT },
      actorPermissions: ADMIN,
      organizationId: ORG_CLIENT,
      user: NOUVEAU_COMPTE,
    })
    assert.isTrue(r.ok)
  })
})

// ---------------------------------------------------------------- création d'organisation

test.group('Identité — créer une organisation et son administrateur', () => {
  const ORGANISATION = { code: ' Transports-Kone ', name: 'Transports Koné' }
  const ADMIN_CLIENT = {
    email: 'Direction@Kone.ci',
    password: 'MotDePasse2026!',
    fullName: 'Directeur Koné',
  }

  test("crée l'organisation ET l'administrateur dans UNE transaction", async ({ assert }) => {
    const m = monde()
    const r = await m.createOrganization.execute({
      context: CONTEXTE,
      actorPermissions: SUPER_ADMIN,
      organization: ORGANISATION,
      admin: ADMIN_CLIENT,
    })

    assert.isTrue(r.ok)
    if (!r.ok) return
    assert.equal(m.transactions, 1)
    assert.equal(r.value.organization.code, 'transports-kone')
    assert.equal(r.value.organization.currency, 'XOF')
    assert.equal(r.value.admin?.organizationId, r.value.organization.id)
    assert.equal(r.value.admin?.role.code, 'admin')
    assert.equal(r.value.admin?.email, 'direction@kone.ci')
    assert.deepEqual(
      m.evenements.map((e) => e.eventName),
      ['identity.organization.created', 'identity.user.created']
    )
    assert.lengthOf(m.audit, 2)
  })

  test("l'administrateur est facultatif", async ({ assert }) => {
    const m = monde()
    const r = await m.createOrganization.execute({
      context: CONTEXTE,
      actorPermissions: SUPER_ADMIN,
      organization: ORGANISATION,
    })
    assert.isTrue(r.ok)
    if (r.ok) assert.isNull(r.value.admin)
    assert.lengthOf(m.comptes, 0)
  })

  test('refuse un code déjà pris — rien n’est écrit', async ({ assert }) => {
    const m = monde({ organisations: [organisation(ORG_CLIENT, { code: 'transports-kone' })] })
    const r = await m.createOrganization.execute({
      context: CONTEXTE,
      actorPermissions: SUPER_ADMIN,
      organization: ORGANISATION,
      admin: ADMIN_CLIENT,
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_ORGANIZATION_CODE_TAKEN')
    assert.equal(m.transactions, 0)
  })

  test("refuse un e-mail d'administrateur déjà utilisé AVANT de créer l'organisation", async ({
    assert,
  }) => {
    const m = monde({ emails: ['direction@kone.ci'] })
    const r = await m.createOrganization.execute({
      context: CONTEXTE,
      actorPermissions: SUPER_ADMIN,
      organization: ORGANISATION,
      admin: ADMIN_CLIENT,
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_EMAIL_TAKEN')
    assert.equal(m.organisations.size, 0)
  })
})
