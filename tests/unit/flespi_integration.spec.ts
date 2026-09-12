import { test } from '@japa/runner'
import { FlespiClient, FlespiApiError } from '#infrastructure/gateways/flespi/flespi_client'
import { FlespiChannelGateway } from '#infrastructure/gateways/flespi/flespi_channel_gateway'
import { FlespiDeviceGateway } from '#infrastructure/gateways/flespi/flespi_device_gateway'
import { FlespiProtocolGateway } from '#infrastructure/gateways/flespi/flespi_protocol_gateway'
import {
  HttpFlespiCommandGateway,
  buildBusinessCommand,
  checkAgainstCatalog,
} from '#infrastructure/gateways/flespi/flespi_command_gateway'
import {
  buildFlespiIdent,
  checkIdentAgainstSchema,
  FlespiIdentError,
} from '#infrastructure/gateways/flespi/flespi_ident'
import { validateAgainstSchema } from '#infrastructure/gateways/flespi/flespi_schema_validator'
import { FlespiFrameParser } from '#infrastructure/gateways/flespi/flespi_frame_parser'
import { MqttTelemetryTransport } from '#infrastructure/gateways/flespi/mqtt_transport'
import type {
  FlespiCommandDefinition,
  JsonSchema,
} from '#infrastructure/gateways/flespi/flespi_types'

/**
 * =========================================================================
 *  INTÉGRATION FLESPI — contrats vérifiés SANS réseau
 * =========================================================================
 *
 * Les réponses simulées reprennent à l'identique celles obtenues lors des
 * tests réels (02infrastructure.md : canal 1442013, device 8958982).
 */

// ------------------------------------------------------------------ fetch simulé

interface Appel {
  method: string
  url: URL
  body: unknown
}

function simulerFetch(reponses: Array<{ status?: number; json: unknown }>) {
  const appels: Appel[] = []
  const original = globalThis.fetch
  let i = 0
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    appels.push({
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const r = reponses[Math.min(i++, reponses.length - 1)]
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 })
  }) as typeof fetch
  return { appels, restaurer: () => (globalThis.fetch = original) }
}

const client = () =>
  new FlespiClient({ token: 'test', baseUrl: 'https://flespi.io', timeoutMs: 2000 })

const CANAL = {
  messages_ttl: 86400,
  protocol_id: 325,
  id: 1442013,
  enabled: true,
  name: 'sisbm_channel',
  configuration: null,
  cid: 2477992,
  secondary_uri: '',
  uri: 'ch1442013.flespi.gw:39142',
}

// ------------------------------------------------------------------ client

test.group('flespi · client HTTP', () => {
  test('passe les paramètres GET dans ?data= (JSON), pas en query-string', async ({ assert }) => {
    const f = simulerFetch([{ json: { result: [] } }])
    try {
      await new FlespiDeviceGateway(client()).lastMessage(8958982)
      const url = f.appels[0].url
      assert.equal(url.pathname, '/gw/devices/8958982/messages')
      assert.deepEqual(JSON.parse(url.searchParams.get('data')!), { count: 1, reverse: true })
      assert.isNull(url.searchParams.get('limit'))
    } finally {
      f.restaurer()
    }
  })

  test('HTTP 200 porteur d’erreurs et sans résultat → FlespiApiError', async ({ assert }) => {
    const f = simulerFetch([
      { json: { result: [], errors: [{ code: 2, reason: 'ident already exists' }] } },
    ])
    try {
      await assert.rejects(
        () => client().request('POST', '/gw/devices', { body: [{}] }),
        /ident already exists/
      )
    } finally {
      f.restaurer()
    }
  })

  test('HTTP 400 : le motif flespi est remonté et traduit en 422', async ({ assert }) => {
    const f = simulerFetch([{ status: 400, json: { errors: [{ reason: 'bad device_type_id' }] } }])
    try {
      const err = await client()
        .request('POST', '/gw/devices', { body: [{}] })
        .catch((e) => e)
      assert.instanceOf(err, FlespiApiError)
      assert.equal(err.reason, 'bad device_type_id')
      assert.equal(err.httpStatusForClient, 422)
      assert.lengthOf(f.appels, 1) // un POST n'est jamais rejoué
    } finally {
      f.restaurer()
    }
  })

  test('jeton absent : échec explicite sans appel réseau', async ({ assert }) => {
    const f = simulerFetch([{ json: { result: [] } }])
    try {
      const c = new FlespiClient({ token: '', baseUrl: 'https://flespi.io', timeoutMs: 1000 })
      await assert.rejects(() => c.request('GET', '/gw/channels/all'), /FLESPI_TOKEN absent/)
      assert.lengthOf(f.appels, 0)
    } finally {
      f.restaurer()
    }
  })
})

// ------------------------------------------------------------------ canaux

test.group('flespi · canaux', () => {
  test('POST /gw/channels : corps en TABLEAU, réponse result[0]', async ({ assert }) => {
    const f = simulerFetch([{ json: { result: [CANAL] } }])
    try {
      const canal = await new FlespiChannelGateway(client()).create({
        name: 'sisbm_channel',
        protocolName: 'micodus',
      })
      assert.deepEqual(f.appels[0].body, [{ name: 'sisbm_channel', protocol_name: 'micodus' }])
      assert.equal(canal.id, 1442013)
      assert.equal(canal.uri, 'ch1442013.flespi.gw:39142')
    } finally {
      f.restaurer()
    }
  })

  test('messages du canal : curseur next_key conservé', async ({ assert }) => {
    const f = simulerFetch([{ json: { result: [], next_key: 0 } }])
    try {
      const r = await new FlespiChannelGateway(client()).messages(1442013)
      assert.deepEqual(r, { messages: [], nextKey: 0 })
      assert.deepEqual(JSON.parse(f.appels[0].url.searchParams.get('data')!), {
        curr_key: 0,
        limit_count: 100,
      })
    } finally {
      f.restaurer()
    }
  })
})

// ------------------------------------------------------------------ devices

test.group('flespi · devices', () => {
  test('POST /gw/devices : ident DANS configuration, type numérique, pas de channel_id', async ({
    assert,
  }) => {
    const f = simulerFetch([
      {
        json: {
          result: [
            {
              id: 8958982,
              device_type_id: 350,
              protocol_id: 13,
              name: 'Véhicule AB-123-CD',
              configuration: { ident: '864356060535359', settings_polling: 'once' },
            },
          ],
        },
      },
    ])
    try {
      const d = await new FlespiDeviceGateway(client()).create({
        name: 'Véhicule AB-123-CD',
        deviceTypeId: 350,
        ident: '864356060535359',
      })
      assert.deepEqual(f.appels[0].body, [
        {
          name: 'Véhicule AB-123-CD',
          device_type_id: 350,
          configuration: { ident: '864356060535359' },
        },
      ])
      assert.equal(d.id, 8958982)
      assert.equal(d.configuration.ident, '864356060535359')
    } finally {
      f.restaurer()
    }
  })

  test('id inconnu du compte : flespi répond 403 code 3 → null (introuvable)', async ({
    assert,
  }) => {
    // Réponse RÉELLE constatée sur GET /gw/devices/98765.
    const f = simulerFetch([
      {
        status: 403,
        json: {
          result: [],
          errors: [{ code: 3, id: 98765, reason: 'access denied or unable to process the item' }],
        },
      },
    ])
    try {
      assert.isNull(await new FlespiDeviceGateway(client()).get(98765))
    } finally {
      f.restaurer()
    }
  })

  test('jeton sans droits (403 sans id) : l’erreur est propagée', async ({ assert }) => {
    const f = simulerFetch([
      { status: 403, json: { errors: [{ code: 3, reason: 'access denied' }] } },
    ])
    try {
      await assert.rejects(() => new FlespiDeviceGateway(client()).get(1), /access denied/)
    } finally {
      f.restaurer()
    }
  })

  test('mise à jour du téléphone : configuration FUSIONNÉE, ident préservé', async ({ assert }) => {
    const f = simulerFetch([
      {
        json: { result: [{ configuration: { ident: '012345678901', settings_polling: 'once' } }] },
      },
      {
        json: {
          result: [{ id: 1, configuration: { ident: '012345678901', phone: '+2250700000000' } }],
        },
      },
    ])
    try {
      await new FlespiDeviceGateway(client()).update(1, { phone: '+2250700000000' })
      assert.equal(f.appels[1].method, 'PUT')
      assert.deepEqual(f.appels[1].body, {
        configuration: { ident: '012345678901', settings_polling: 'once', phone: '+2250700000000' },
      })
    } finally {
      f.restaurer()
    }
  })
})

// ------------------------------------------------------------------ protocoles

test.group('flespi · protocole et type de boîtier', () => {
  test('« Micodus MV730 » est résolu DANS le protocole du canal ; Concox AT6 est refusé', async ({
    assert,
  }) => {
    const f = simulerFetch([
      {
        json: {
          result: [
            { id: 900, name: 'mv730', title: 'Micodus MV730' },
            { id: 901, name: 'mv720', title: 'Micodus MV720' },
          ],
        },
      },
    ])
    try {
      const gw = new FlespiProtocolGateway(client())
      for (const reference of ['Micodus MV730', 'mv730', 'MV730', 900]) {
        const type = await gw.resolveDeviceType(325, reference)
        assert.equal(type?.id, 900, `référence ${reference}`)
      }
      assert.isNull(await gw.resolveDeviceType(325, 350)) // Concox AT6
      assert.lengthOf(f.appels, 1) // catalogue mis en cache
    } finally {
      f.restaurer()
    }
  })
})

test.group('flespi · catalogue des protocoles', () => {
  test('protocoles demandés sans `title` ; champ refusé par flespi retiré puis relance', async ({
    assert,
  }) => {
    // Réponse RÉELLE constatée : un protocole n'a pas de champ `title`.
    const f = simulerFetch([
      {
        status: 400,
        json: { result: [], errors: [{ code: 2, field: 'name', reason: 'field is not allowed' }] },
      },
      { json: { result: [{ id: 325 }, { id: 13 }] } },
    ])
    try {
      const liste = await new FlespiProtocolGateway(client()).protocols()
      assert.equal(f.appels[0].url.searchParams.get('fields'), 'id,name')
      assert.equal(f.appels[1].url.searchParams.get('fields'), 'id')
      assert.lengthOf(liste, 2)
    } finally {
      f.restaurer()
    }
  })
})

// ------------------------------------------------------------------ ident

test.group('flespi · règle d’ident', () => {
  test('micodus : ID du boîtier SANS zéro de tête (constaté sur MV730 réel)', ({ assert }) => {
    // param1 → id 7301151405 ; flespi publie ident=7301151405
    assert.equal(
      buildFlespiIdent('micodus', { imei: '864356060535359', terminalId: '7301151405' }),
      '7301151405'
    )
    assert.equal(
      buildFlespiIdent('micodus', { imei: '864356060535359', terminalId: '07301151405' }),
      '7301151405'
    )
    assert.throws(
      () => buildFlespiIdent('micodus', { imei: '864356060535359' }),
      FlespiIdentError as never
    )
  })

  test('ident explicite prioritaire ; concox = IMEI nu', ({ assert }) => {
    assert.equal(buildFlespiIdent('micodus', { imei: '1', flespiIdent: '0999' }), '0999')
    assert.equal(buildFlespiIdent('concox', { imei: '864356060535359' }), '864356060535359')
  })

  test('le schéma du type 350 (Concox AT6) refuse un ident préfixé de 0', ({ assert }) => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        ident: {
          'type': 'string',
          'pattern': '^\\d{15}$',
          'x-schema-errors': { pattern: 'expecting ident to be an IMEI number (15 digits)' },
        },
      },
    }
    assert.isNull(checkIdentAgainstSchema('864356060535359', schema))
    assert.equal(
      checkIdentAgainstSchema('0864356060535359', schema),
      'expecting ident to be an IMEI number (15 digits)'
    )
  })
})

// ------------------------------------------------------------------ commandes

const WORKING_MODE: FlespiCommandDefinition = {
  name: 'setting.working_mode.set',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: {
      mode: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: { type: { const: 0, type: 'integer' } },
            title: 'Standby Mode',
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'time_move', 'time_stat'],
            title: 'Tracking Mode',
            properties: {
              type: { const: 1, type: 'integer' },
              time_move: { type: 'integer', minimum: 10, maximum: 3600 },
              time_stat: { type: 'integer', minimum: 180, maximum: 86400 },
            },
          },
        ],
      },
    },
  },
}

const CUSTOM_MICODUS: FlespiCommandDefinition = {
  name: 'custom',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['command_code'],
    properties: { command_code: { type: 'string' }, data: { type: 'string' } },
  },
}

test.group('flespi · commandes', () => {
  test('coupure moteur MV730 = custom { command_code: S20, data: "1,1" }', ({ assert }) => {
    assert.deepEqual(buildBusinessCommand('cut_engine'), {
      name: 'custom',
      properties: { command_code: 'S20', data: '1,1' },
    })
    assert.throws(() => buildBusinessCommand('set_apn'), /exige un paramètre/)
    assert.throws(() => buildBusinessCommand('set_apn', '  '), /exige un paramètre/)
  })

  test('validation contre le catalogue réel du boîtier', ({ assert }) => {
    const catalogue = [WORKING_MODE, CUSTOM_MICODUS]
    const ok = {
      name: 'setting.working_mode.set',
      properties: { mode: { type: 1, time_move: 30, time_stat: 600 } },
    }
    assert.deepEqual(checkAgainstCatalog(ok, catalogue), [])

    const tropRapide = {
      name: 'setting.working_mode.set',
      properties: { mode: { type: 1, time_move: 5, time_stat: 600 } },
    }
    assert.isNotEmpty(checkAgainstCatalog(tropRapide, catalogue))

    const inconnue = { name: 'setting.nope.set', properties: {} }
    assert.match(checkAgainstCatalog(inconnue, catalogue)[0], /n'existe pas/)

    assert.deepEqual(checkAgainstCatalog(buildBusinessCommand('request_status'), catalogue), [])
  })

  test('propriété non prévue refusée (additionalProperties: false)', ({ assert }) => {
    const e = validateAgainstSchema({ command_code: 'S20', foo: 1 }, CUSTOM_MICODUS.schema)
    assert.match(e[0], /foo n'est pas une propriété autorisée/)
  })

  test('file d’attente : POST /commands-queue, ttl borné, identifiant retourné', async ({
    assert,
  }) => {
    const f = simulerFetch([
      {
        json: {
          result: [
            {
              id: 1789070047258876,
              device_id: 8958982,
              name: 'setting.auto_apn.get',
              properties: {},
              executed: false,
              expires: 1789156447,
            },
          ],
        },
      },
    ])
    try {
      const r = await new HttpFlespiCommandGateway(client()).queue(
        8958982,
        { name: 'setting.auto_apn.get', properties: {} },
        { ttl: 10, maxAttempts: 3 }
      )
      assert.equal(f.appels[0].url.pathname, '/gw/devices/8958982/commands-queue')
      assert.deepEqual(f.appels[0].body, [
        { name: 'setting.auto_apn.get', properties: {}, ttl: 60, max_attempts: 3 },
      ])
      assert.equal(r.providerCommandId, '1789070047258876')
      assert.equal(r.expiresAt?.getTime(), 1789156447000)
    } finally {
      f.restaurer()
    }
  })
})

// ------------------------------------------------------------------ MQTT

test.group('flespi · trames MQTT', () => {
  const trame = {
    'ident': '012345678901',
    'device.id': 8958982,
    'timestamp': 1789070047.5,
    'server.timestamp': 1789070048.1,
    'position.latitude': 5.3364,
    'position.longitude': -4.0267,
    'position.speed': 42,
    'position.satellites': 9,
    'engine.ignition.status': true,
    // Noms RÉELS publiés par le MV730 (relevé de télémétrie du 12/09/2026).
    'gsm.signal.dbm': 15,
    'gsm.signal.dbm.1': -79,
    'external.powersource.voltage': 12.9,
    'vehicle.state': 'FFFFFBFF',
    'vehicle.state.bitmask': 0xffff_fbff,
  }

  test('ident de la trame ; device.id n’est plus pris pour un IMEI', ({ assert }) => {
    const [f] = new FlespiFrameParser().parse(
      JSON.stringify(trame),
      'flespi/message/gw/devices/8958982'
    )
    assert.equal(f.ident, '012345678901')
    assert.equal(f.recordedAt.getTime(), 1789070047500)
    assert.equal(f.externalId, '012345678901:1789070047500')
    assert.isTrue(f.ignition)
    // gsm.signal.dbm, et surtout PAS la cellule voisine gsm.signal.dbm.1
    assert.equal(f.gsmSignal, 15)
    assert.equal(f.externalVoltageV, 12.9)
    assert.isFalse(f.engineBlocked) // FFFFFBFF : moteur alimenté
  })

  test('moteur coupé : bit 0x08000000 du masque vehicle.state à 0', ({ assert }) => {
    // Relevé réel : S20 1,1 → F7FFFBFF ; S20 0,0 → FFFFFBFF.
    const coupe = { ...trame, 'vehicle.state': 'F7FFFBFF', 'vehicle.state.bitmask': 0xf7ff_fbff }
    const [f] = new FlespiFrameParser().parse(JSON.stringify(coupe), 'flespi/message/gw/devices/1')
    assert.isTrue(f.engineBlocked)
  })

  test('sans masque : engineBlocked reste null, jamais deviné', ({ assert }) => {
    const sansMasque: Record<string, unknown> = { ...trame }
    delete sansMasque['vehicle.state.bitmask']
    const [f] = new FlespiFrameParser().parse(
      JSON.stringify(sansMasque),
      'flespi/message/gw/devices/1'
    )
    assert.isNull(f.engineBlocked)
  })

  test('sans ident : repli sur l’id du device flespi tiré du topic', ({ assert }) => {
    const sansIdent: Record<string, unknown> = { ...trame }
    delete sansIdent.ident
    delete sansIdent['device.id']
    const [f] = new FlespiFrameParser().parse(
      JSON.stringify(sansIdent),
      'flespi/message/gw/devices/8958982'
    )
    assert.equal(f.ident, 'flespi:8958982')
  })

  test('souscription partagée : préfixe $share/<groupe>/', ({ assert }) => {
    const t = new MqttTelemetryTransport({
      host: 'mqtt.flespi.io',
      port: 8883,
      tls: true,
      clientId: 'sisbm-core-1',
      topics: ['flespi/message/gw/devices/+'],
      qos: 1,
      reconnectPeriodMs: 2000,
      connectTimeoutMs: 10000,
      receiveMaximum: 100,
      sessionExpirySeconds: 3600,
      shareGroup: 'sisbm',
    })
    assert.deepEqual(t.subscriptions, ['$share/sisbm/flespi/message/gw/devices/+'])
  })
})

// ------------------------------------------------------------------ câblage

test.group('flespi · composition', () => {
  test('les contrôleurs se construisent depuis le conteneur', async ({ assert }) => {
    const { default: app } = await import('@adonisjs/core/services/app')
    for (const chemin of [
      '#presentation/http/controllers/fleet/device_controller',
      '#presentation/http/controllers/fleet/device_command_controller',
      '#presentation/http/controllers/fleet/flespi_channel_controller',
    ]) {
      const { default: Controleur } = await import(chemin)
      const instance = await app.container.make(Controleur)
      assert.instanceOf(instance, Controleur)
    }
  })
})
