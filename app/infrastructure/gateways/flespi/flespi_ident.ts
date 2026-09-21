import type { JsonSchema } from '#infrastructure/gateways/flespi/flespi_types'

/**
 * =========================================================================
 *  RÈGLE D'IDENT FLESPI — par protocole
 * =========================================================================
 *
 * L'`ident` est la SEULE clé qui relie une trame reçue sur un canal au
 * device flespi. S'il est faux d'un caractère, le boîtier se connecte, le
 * canal reçoit ses trames… et le device reste vide.
 *
 * Ce que dit flespi (https://flespi.com/protocols/micodus) :
 *   « use the device ID (not IMEI) and add a leading zero to the ID when
 *     registering the device in the ident field »
 *
 * ⚠ CONSTAT SUR BOÎTIER RÉEL (MV730, firmware 2023/08/18, 11/09/2026) :
 *   ID du boîtier (SMS `param1`) = 7301151405
 *   ident publié par flespi      = 7301151405   ← SANS zéro de tête
 *   Un device déclaré « 07301151405 » (règle de la doc) ne recevait RIEN.
 *
 * ⇒ Pour un Micodus, l'ident est l'ID du boîtier (champ « id » de `param1`,
 *   étiquette « ID »), SANS zéro de tête, et jamais l'IMEI. Pour un Concox /
 *   Jimi (protocole `concox`), l'ident est l'IMEI nu, 15 chiffres.
 *
 * En cas de doute, la vérité est sur le canal : `GET /api/v1/flespi/channels/:id/idents`
 * liste les idents réellement envoyés par les boîtiers connectés.
 */

export class FlespiIdentError extends Error {
  constructor(
    message: string,
    readonly hint?: string
  ) {
    super(message)
  }
}

export interface IdentInput {
  imei: string
  /** ID constructeur imprimé sur l'étiquette (Micodus : « ID »). */
  terminalId?: string | null
  /** Ident explicite, déjà au format flespi : prioritaire sur tout le reste. */
  flespiIdent?: string | null
}

export function buildFlespiIdent(protocolName: string, input: IdentInput): string {
  const explicite = input.flespiIdent?.trim()
  if (explicite) return explicite

  const protocole = protocolName.trim().toLowerCase()

  if (protocole === 'micodus') {
    const id = input.terminalId?.trim()
    if (!id) {
      throw new FlespiIdentError(
        "Protocole micodus : l'ident flespi est l'ID du boîtier (SMS param1), pas l'IMEI. " +
          'Renseigner `terminalId` (ID du boîtier) ou `flespiIdent`.',
        'Brancher le boîtier sur le canal puis lire GET /api/v1/flespi/channels/:id/idents'
      )
    }
    if (!/^\d+$/.test(id)) {
      throw new FlespiIdentError(`ID Micodus invalide : ${id} (chiffres uniquement)`)
    }
    // flespi publie l'ID sans zéros de tête (constaté en réel) : on les retire.
    return id.replace(/^0+(?=\d)/, '')
  }

  // concox, jimi, teltonika… : IMEI nu.
  return input.imei.trim()
}

/**
 * Vérifie l'ident contre le schéma de configuration du TYPE de boîtier,
 * tel que publié par flespi (`configuration.properties.ident.pattern`).
 *
 * C'est ce contrôle qui aurait signalé d'emblée le problème : le type 350
 * (Concox AT6) exige `^\d{15}$`, donc refuse tout ident préfixé d'un `0`.
 */
export function checkIdentAgainstSchema(ident: string, configuration?: JsonSchema): string | null {
  const regle = configuration?.properties?.ident
  if (!regle) return null
  if (regle.minLength !== undefined && ident.length < regle.minLength) {
    return `ident trop court (minimum ${regle.minLength})`
  }
  if (regle.maxLength !== undefined && ident.length > regle.maxLength) {
    return `ident trop long (maximum ${regle.maxLength})`
  }
  if (regle.pattern) {
    try {
      if (!new RegExp(regle.pattern).test(ident)) {
        const msg = (regle['x-schema-errors'] as { pattern?: string } | undefined)?.pattern
        return msg ?? `ident « ${ident} » non conforme au motif ${regle.pattern}`
      }
    } catch {
      return null
    }
  }
  return null
}
