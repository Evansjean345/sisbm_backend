/**
 * =========================================================================
 *  PORTS DU CONTEXTE FLOTTE — appartenance aux groupes
 * =========================================================================
 *
 * Le contexte `fleet` est PRAGMATIQUE (docs/03 §3) : le CRUD des groupes se
 * fait contrôleur → Lucid. L'APPARTENANCE fait exception et passe par un
 * port, pour deux raisons :
 *
 *  - elle s'écrit dans une table d'association sans modèle naturel ;
 *  - elle porte la règle de CLOISONNEMENT (un membre appartient forcément à
 *    l'organisation de son groupe), qui ne doit pas vivre dans un contrôleur.
 */

export interface GroupMember {
  id: string
  /** Immatriculation (véhicule) ou IMEI (boîtier). */
  label: string
  addedAt: Date
}

export interface MembershipChange {
  /** Membres effectivement ajoutés (ou retirés) par l'appel. */
  applied: string[]
  /** Déjà membres (ajout) ou non membres (retrait) : l'opération est idempotente. */
  unchanged: string[]
  /** Identifiants inconnus, supprimés, ou appartenant à une AUTRE organisation. */
  rejected: string[]
}

/**
 * Un seul port pour les deux familles de groupes : les tables sont
 * symétriques, l'implémentation est paramétrée par le type de groupe.
 */
export interface GroupMembershipRepository {
  members(groupId: string): Promise<GroupMember[]>
  countByGroup(groupIds: string[]): Promise<Record<string, number>>
  /** N'ajoute que les membres de `organizationId` : le reste part en `rejected`. */
  add(groupId: string, organizationId: string, memberIds: string[]): Promise<MembershipChange>
  remove(groupId: string, memberIds: string[]): Promise<MembershipChange>
  /** Identifiants des membres — utilisé pour filtrer le journal d'audit. */
  memberIds(groupId: string): Promise<string[]>
  /**
   * Commandes émises sur ces membres.
   *
   * Sans elles, « les logs du groupe » manqueraient précisément les actes les
   * plus sensibles : les immobilisations sont tracées sous `device_command`,
   * pas sous `vehicle` ni `device`.
   */
  commandIdsForMembers(memberIds: string[]): Promise<string[]>
}
