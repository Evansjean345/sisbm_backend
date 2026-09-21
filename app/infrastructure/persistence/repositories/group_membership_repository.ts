import db from '@adonisjs/lucid/services/db'
import type {
  GroupMember,
  GroupMembershipRepository,
  MembershipChange,
} from '#application/fleet/ports'

/**
 * Appartenance aux groupes — adaptateur unique pour les deux familles.
 *
 * `vehicle_group_members` et `device_group_members` ont la même forme :
 * (groupe, membre, added_at). Une seule implémentation paramétrée évite d'en
 * écrire deux qui divergeront à la première correction.
 *
 * Le CLOISONNEMENT est appliqué ici, à l'endroit où la requête est écrite :
 * les identifiants candidats sont d'abord filtrés sur `organization_id` du
 * groupe. Un identifiant d'une autre organisation ressort en `rejected`,
 * exactement comme un identifiant inconnu — on ne révèle pas son existence.
 * La base tient le même invariant par trigger (migration 013).
 */

interface Tables {
  /** Table d'association. */
  pivot: string
  /** Colonne portant le groupe. */
  groupColumn: string
  /** Colonne portant le membre. */
  memberColumn: string
  /** Table des membres. */
  memberTable: string
  /** Colonne lisible par un humain (immatriculation, IMEI). */
  labelColumn: string
  /** Colonne de `device_commands` qui référence ce type de membre. */
  commandColumn: 'vehicle_id' | 'device_id'
}

const VEHICLES: Tables = {
  pivot: 'vehicle_group_members',
  groupColumn: 'vehicle_group_id',
  memberColumn: 'vehicle_id',
  memberTable: 'vehicles',
  labelColumn: 'registration',
  commandColumn: 'vehicle_id',
}

const DEVICES: Tables = {
  pivot: 'device_group_members',
  groupColumn: 'device_group_id',
  memberColumn: 'device_id',
  memberTable: 'devices',
  labelColumn: 'imei',
  commandColumn: 'device_id',
}

class LucidGroupMembership implements GroupMembershipRepository {
  constructor(private readonly t: Tables) {}

  async members(groupId: string): Promise<GroupMember[]> {
    const rows = await db
      .from(`${this.t.pivot} as m`)
      .innerJoin(`${this.t.memberTable} as x`, 'x.id', `m.${this.t.memberColumn}`)
      .where(`m.${this.t.groupColumn}`, groupId)
      .whereNull('x.deleted_at')
      .orderBy(`x.${this.t.labelColumn}`)
      .select('x.id', `x.${this.t.labelColumn} as label`, 'm.added_at')

    return rows.map((r) => ({ id: r.id, label: r.label, addedAt: r.added_at }))
  }

  async countByGroup(groupIds: string[]): Promise<Record<string, number>> {
    if (groupIds.length === 0) return {}
    const rows = await db
      .from(`${this.t.pivot} as m`)
      .innerJoin(`${this.t.memberTable} as x`, 'x.id', `m.${this.t.memberColumn}`)
      .whereIn(`m.${this.t.groupColumn}`, groupIds)
      .whereNull('x.deleted_at')
      .groupBy(`m.${this.t.groupColumn}`)
      .select(`m.${this.t.groupColumn} as gid`)
      .count('* as total')

    return Object.fromEntries(rows.map((r) => [r.gid, Number(r.total)]))
  }

  async memberIds(groupId: string): Promise<string[]> {
    const rows = await db
      .from(this.t.pivot)
      .where(this.t.groupColumn, groupId)
      .select(`${this.t.memberColumn} as id`)
    return rows.map((r) => r.id as string)
  }

  async commandIdsForMembers(memberIds: string[]): Promise<string[]> {
    if (memberIds.length === 0) return []
    const rows = await db
      .from('device_commands')
      .whereIn(this.t.commandColumn, memberIds)
      .select('id')
    return rows.map((r) => r.id as string)
  }

  async add(
    groupId: string,
    organizationId: string,
    memberIds: string[]
  ): Promise<MembershipChange> {
    const candidats = [...new Set(memberIds)]

    // Cloisonnement : seuls les membres vivants de CETTE organisation.
    const eligibles = await db
      .from(this.t.memberTable)
      .whereIn('id', candidats)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id')
    const eligibleIds = eligibles.map((r) => r.id as string)

    const existants = await db
      .from(this.t.pivot)
      .where(this.t.groupColumn, groupId)
      .whereIn(
        this.t.memberColumn,
        eligibleIds.length > 0 ? eligibleIds : ['00000000-0000-0000-0000-000000000000']
      )
      .select(`${this.t.memberColumn} as id`)
    const dejaMembres = new Set(existants.map((r) => r.id as string))

    const aAjouter = eligibleIds.filter((id) => !dejaMembres.has(id))
    if (aAjouter.length > 0) {
      await db
        .table(this.t.pivot)
        .multiInsert(
          aAjouter.map((id) => ({ [this.t.groupColumn]: groupId, [this.t.memberColumn]: id }))
        )
    }

    return {
      applied: aAjouter,
      unchanged: [...dejaMembres],
      rejected: candidats.filter((id) => !eligibleIds.includes(id)),
    }
  }

  async remove(groupId: string, memberIds: string[]): Promise<MembershipChange> {
    const candidats = [...new Set(memberIds)]
    const existants = await db
      .from(this.t.pivot)
      .where(this.t.groupColumn, groupId)
      .whereIn(this.t.memberColumn, candidats)
      .select(`${this.t.memberColumn} as id`)
    const presents = existants.map((r) => r.id as string)

    if (presents.length > 0) {
      await db
        .from(this.t.pivot)
        .where(this.t.groupColumn, groupId)
        .whereIn(this.t.memberColumn, presents)
        .delete()
    }

    return {
      applied: presents,
      unchanged: candidats.filter((id) => !presents.includes(id)),
      rejected: [],
    }
  }
}

export class LucidVehicleGroupMembership extends LucidGroupMembership {
  constructor() {
    super(VEHICLES)
  }
}

export class LucidDeviceGroupMembership extends LucidGroupMembership {
  constructor() {
    super(DEVICES)
  }
}
