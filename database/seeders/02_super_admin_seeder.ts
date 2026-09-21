import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'

/**
 * Compte EXPLOITANT PLATEFORME — Jalon 2, phase 5.
 *
 * Seul le rôle système `super_admin` (joker `*`) couvre `organization:*` :
 * sans ce compte, les routes `/organizations` sont inexploitables en recette.
 *
 * Il est rattaché à l'organisation SISBM (users.organization_id est NOT NULL),
 * ce qui en fait aussi l'organisation « exploitant » de la plateforme.
 *
 * Jamais joué en production : le premier super_admin de production se crée
 * à la main, avec un mot de passe qui ne figure dans aucun dépôt.
 */
export default class extends BaseSeeder {
  static environment = ['development', 'testing']

  async run() {
    const ORG = '11111111-1111-4111-8111-111111111111'
    const password = process.env.SUPER_ADMIN_PASSWORD ?? 'SuperAdmin2026!'

    const role = await db
      .from('roles')
      .where('code', 'super_admin')
      .whereNull('organization_id')
      .select('id')
      .first()
    if (!role) throw new Error('Rôle système super_admin absent : migrations non jouées ?')

    await db
      .table('users')
      .insert({
        id: '99999999-9999-4999-8999-999999999999',
        organization_id: ORG,
        role_id: role.id,
        email: 'superadmin@sisbm.ci',
        password_hash: await hash.make(password),
        full_name: 'Exploitant SISBM',
        status: 'active',
        locale: 'fr',
        timezone: 'Africa/Abidjan',
      })
      .onConflict('id')
      .ignore()
  }
}
