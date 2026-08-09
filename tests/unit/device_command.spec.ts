import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'

/**
 * Jeu de données de recette — Jalon 1.
 *
 * Objectif : rendre l'API immédiatement testable, avec de quoi exercer
 * l'ensemble des garde-fous d'immobilisation.
 *
 * Trois véhicules aux états DIFFÉRENTS, choisis pour couvrir les cas de rejet :
 *   1234 AB 01 — à l'arrêt, immobilisation activée   → la demande doit RÉUSSIR
 *   5678 CD 01 — roule à 62 km/h                     → doit être refusée (CM-07)
 *   9012 EF 01 — immobilisation désactivée           → doit être refusée
 */
export default class extends BaseSeeder {
  async run() {
    const ORG = '11111111-1111-4111-8111-111111111111'
    const password = await hash.make('Sisbm2026!')

    await db
      .table('organizations')
      .insert({
        id: ORG,
        code: 'sisbm',
        name: 'SISBM',
        country_code: 'CI',
        timezone: 'Africa/Abidjan',
        currency: 'XOF',
      })
      .onConflict('id')
      .ignore()

    const roles = await db.from('roles').whereNull('organization_id').select('id', 'code')
    const roleId = (code: string) => roles.find((r) => r.code === code)!.id

    // Deux comptes DISTINCTS : le principe des quatre yeux impose que le
    // valideur ne soit pas le demandeur. Un seul compte rendrait le
    // scénario nominal intestable.
    const users = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'admin@sisbm.ci',
        full_name: 'Administrateur SISBM',
        role: 'admin',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'superviseur@sisbm.ci',
        full_name: 'Superviseur SISBM',
        role: 'supervisor',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        email: 'operateur@sisbm.ci',
        full_name: 'Opérateur SISBM',
        role: 'operator',
      },
    ]
    for (const u of users) {
      await db
        .table('users')
        .insert({
          id: u.id,
          organization_id: ORG,
          role_id: roleId(u.role),
          email: u.email,
          password_hash: password,
          full_name: u.full_name,
          status: 'active',
          locale: 'fr',
          timezone: 'Africa/Abidjan',
        })
        .onConflict('id')
        .ignore()
    }

    // Le rôle admin doit pouvoir valider : on ajoute la permission explicite.
    await db
      .from('roles')
      .where('code', 'supervisor')
      .whereNull('organization_id')
      .update({ permissions: db.raw("array_append(permissions, 'command:validate')") })

    const vehicles = [
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        reg: '1234 AB 01',
        brand: 'Toyota',
        model: 'Hilux',
        immo: true,
        speed: 0,
        ignition: false,
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        reg: '5678 CD 01',
        brand: 'Renault',
        model: 'Master',
        immo: true,
        speed: 62,
        ignition: true,
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000003',
        reg: '9012 EF 01',
        brand: 'Isuzu',
        model: 'NPR',
        immo: false,
        speed: 0,
        ignition: false,
      },
    ]
    const devices = [
      { id: 'bbbbbbbb-0000-4000-8000-000000000001', imei: '868120200000001', model: 'MV730' },
      { id: 'bbbbbbbb-0000-4000-8000-000000000002', imei: '868120200000002', model: 'MV730' },
      { id: 'bbbbbbbb-0000-4000-8000-000000000003', imei: '868120200000003', model: 'FMB920' },
    ]

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i]
      const d = devices[i]

      await db
        .table('vehicles')
        .insert({
          id: v.id,
          organization_id: ORG,
          registration: v.reg,
          brand: v.brand,
          model: v.model,
          vehicle_type: 'truck',
          status: 'active',
          odometer_km: 12500 + i * 1000,
          speed_limit_kph: 90,
          immobilization_enabled: v.immo,
        })
        .onConflict('id')
        .ignore()

      await db
        .table('devices')
        .insert({
          id: d.id,
          organization_id: ORG,
          imei: d.imei,
          manufacturer: i === 2 ? 'teltonika' : 'micodus',
          model: d.model,
          has_relay: true,
          status: 'active',
          sim_msisdn: `+2250161899${900 + i}`,
          last_seen_at: DateTime.now().toSQL(),
        })
        .onConflict('id')
        .ignore()

      // Affectation datée, ouverte à droite : [maintenant, ∞)
      await db
        .table('device_assignments')
        .insert({
          device_id: d.id,
          vehicle_id: v.id,
          period: db.raw("tstzrange(now() - interval '30 days', NULL)"),
        })
        .onConflict()
        .ignore()

      // Position fraîche : l'immobilisation refuse toute position de plus
      // de 120 s (elle ne prouverait plus que le véhicule est à l'arrêt).
      await db
        .table('vehicle_last_positions')
        .insert({
          vehicle_id: v.id,
          organization_id: ORG,
          device_id: d.id,
          recorded_at: DateTime.now().toSQL(),
          location: db.raw(
            `ST_SetSRID(ST_MakePoint(${-4.0083 + i * 0.01}, ${5.36 + i * 0.01}), 4326)::geography`
          ),
          speed_kph: v.speed,
          ignition: v.ignition,
          connection_state: 'online',
          gsm_signal: 24,
          battery_pct: 87,
        })
        .onConflict('vehicle_id')
        .merge()
    }

    // Zone autorisée autour du port d'Abidjan (rayon 3 km)
    await db
      .table('geofences')
      .insert({
        id: 'eeeeeeee-0000-4000-8000-000000000001',
        organization_id: ORG,
        name: 'Zone Port Abidjan',
        kind: 'authorized',
        shape_type: 'circle',
        geom: db.raw(
          'ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(-4.0083, 5.28), 4326)::geography, 3000)::geometry)::geography'
        ),
        center: db.raw('ST_SetSRID(ST_MakePoint(-4.0083, 5.28), 4326)::geography'),
        radius_m: 3000,
        is_active: true,
      })
      .onConflict('id')
      .ignore()

    await db
      .table('sms_accounts')
      .insert({
        organization_id: ORG,
        provider: 'local_gateway',
        label: 'Passerelle SMS CI',
        balance_credits: 1000,
        unit_price_amount: 25,
        currency: 'XOF',
        low_balance_threshold: 100,
      })
      .onConflict()
      .ignore()

    console.log('  → 1 organisation · 3 utilisateurs · 3 véhicules · 3 trackers · 1 geofence')
    console.log('  → mot de passe commun : Sisbm2026!')
  }
}
