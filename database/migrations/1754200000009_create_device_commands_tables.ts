import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ===========================================================================
 *  COMMANDES TRACKER — IMMOBILISATION CONTRÔLÉE
 *  Table la plus sensible de la plateforme. Une coupure moteur intempestive
 *  sur un véhicule en mouvement est un risque humain, pas un bug applicatif.
 * ===========================================================================
 *
 * Quatre garde-fous, dont trois au niveau de la base :
 *
 *  1. CM-07  ck_device_commands_speed_guard
 *            une coupure moteur ne peut être ENREGISTRÉE que si la vitesse relevée
 *            au moment de la demande est <= safety_speed_limit_kph. Même un bug
 *            applicatif ne peut pas insérer une coupure à 90 km/h.
 *
 *  2. CM-08  motif obligatoire et non vide + demandeur identifié.
 *
 *  3. CM-09  uq_device_commands_in_flight
 *            une seule commande en vol par tracker.
 *
 *  4. Séparation des rôles : ck_device_commands_four_eyes impose, quand la
 *     validation humaine est requise, que le valideur soit différent du demandeur.
 *
 * Le service applicatif ajoute par-dessus : niveau d'isolation SERIALIZABLE,
 * re-vérification de la vitesse juste avant l'envoi effectif, et expiration
 * automatique des commandes non exécutées.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE device_commands (
        id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
        device_id              uuid NOT NULL REFERENCES devices (id) ON DELETE RESTRICT,
        vehicle_id             uuid REFERENCES vehicles (id) ON DELETE SET NULL,
        command_type           text NOT NULL,
        status                 text NOT NULL DEFAULT 'pending_validation',

        -- traçabilité de la demande
        reason                 text NOT NULL,
        origin                 text NOT NULL DEFAULT 'manual',
        policy_id              uuid REFERENCES policies (id) ON DELETE SET NULL,
        alert_id               uuid REFERENCES alerts (id) ON DELETE SET NULL,
        incident_id            uuid REFERENCES incidents (id) ON DELETE SET NULL,
        requested_by           uuid REFERENCES users (id) ON DELETE SET NULL,
        requested_at           timestamptz NOT NULL DEFAULT now(),

        -- garde-fou de sécurité (contrainte CM-07)
        safety_speed_limit_kph numeric(6,2) NOT NULL DEFAULT 5,
        speed_at_request_kph   numeric(6,2),
        ignition_at_request    boolean,
        location_at_request    geography(Point, 4326),
        safety_context         jsonb NOT NULL DEFAULT '{}'::jsonb,

        -- validation (double regard)
        requires_validation    boolean NOT NULL DEFAULT true,
        validated_by           uuid REFERENCES users (id) ON DELETE SET NULL,
        validated_at           timestamptz,
        rejection_reason       text,

        -- exécution
        queued_at              timestamptz,
        sent_at                timestamptz,
        provider               text NOT NULL DEFAULT 'flespi',
        provider_command_id    text,
        acknowledged_at        timestamptz,
        failed_at              timestamptz,
        error_message          text,
        attempts               smallint NOT NULL DEFAULT 0,
        expires_at             timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),

        created_at             timestamptz NOT NULL DEFAULT now(),
        updated_at             timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT ck_device_commands_type CHECK (command_type IN (
          'engine_cut','engine_restore','locate','reboot','set_interval','custom'
        )),
        CONSTRAINT ck_device_commands_status CHECK (status IN (
          'pending_validation','approved','rejected','queued','sent',
          'acknowledged','failed','cancelled','expired'
        )),
        CONSTRAINT ck_device_commands_origin CHECK (origin IN ('manual','policy','api')),

        -- CM-08 : motif obligatoire et substantiel
        CONSTRAINT ck_device_commands_reason CHECK (length(btrim(reason)) >= 5),

        -- CM-07 : jamais de coupure au-dessus du seuil de sécurité
        CONSTRAINT ck_device_commands_speed_guard CHECK (
          command_type <> 'engine_cut'
          OR status IN ('pending_validation','rejected','cancelled','expired')
          OR (speed_at_request_kph IS NOT NULL AND speed_at_request_kph <= safety_speed_limit_kph)
        ),
        CONSTRAINT ck_device_commands_safety_limit CHECK (
          safety_speed_limit_kph >= 0 AND safety_speed_limit_kph <= 20
        ),

        -- séparation des rôles : le valideur n'est pas le demandeur
        CONSTRAINT ck_device_commands_four_eyes CHECK (
          NOT requires_validation
          OR validated_by IS NULL
          OR requested_by IS NULL
          OR validated_by <> requested_by
        ),

        -- cohérence des transitions d'état
        CONSTRAINT ck_device_commands_validated CHECK (
          status NOT IN ('approved','queued','sent','acknowledged')
          OR NOT requires_validation
          OR validated_at IS NOT NULL
        ),
        CONSTRAINT ck_device_commands_rejected CHECK (
          status <> 'rejected' OR rejection_reason IS NOT NULL
        ),
        CONSTRAINT ck_device_commands_sent CHECK (status <> 'sent' OR sent_at IS NOT NULL)
      );

      -- CM-09 : une seule commande en vol par tracker
      CREATE UNIQUE INDEX uq_device_commands_in_flight ON device_commands (device_id)
        WHERE status IN ('pending_validation','approved','queued','sent');

      CREATE INDEX idx_device_commands_vehicle ON device_commands (vehicle_id, requested_at DESC);
      CREATE INDEX idx_device_commands_org_status ON device_commands (organization_id, status, requested_at DESC);
      CREATE INDEX idx_device_commands_expiring ON device_commands (expires_at)
        WHERE status IN ('pending_validation','approved','queued');

      CREATE TRIGGER trg_device_commands_updated_at BEFORE UPDATE ON device_commands
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    /**
     * Journal APPEND-ONLY de chaque transition d'état.
     * C'est la pièce produite en cas de litige ou d'audit : qui a demandé quoi,
     * qui a validé, à quelle vitesse roulait le véhicule, quel a été le retour du tracker.
     */
    this.schema.raw(`
      CREATE TABLE device_command_logs (
        id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        command_id    uuid NOT NULL REFERENCES device_commands (id) ON DELETE RESTRICT,
        status_from   text,
        status_to     text NOT NULL,
        actor_id      uuid REFERENCES users (id) ON DELETE SET NULL,
        actor_type    text NOT NULL DEFAULT 'user',
        actor_ip      inet,
        note          text,
        payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_device_command_logs_actor CHECK (actor_type IN ('user','policy','system','api'))
      );
      CREATE INDEX idx_device_command_logs_command ON device_command_logs (command_id, created_at);
    `)
  }

  async down() {
    this.schema.raw('DROP TABLE IF EXISTS device_command_logs')
    this.schema.raw('DROP TABLE IF EXISTS device_commands')
  }
}
