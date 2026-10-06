import { MigrationInterface, QueryRunner } from 'typeorm';

export class Messaging1759900000000 implements MigrationInterface {
  name = 'Messaging1759900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE wa_account_status AS ENUM ('PENDING','CONNECTED','ERROR')`);
    await q.query(`CREATE TYPE scheduled_kind AS ENUM ('REMINDER_24H','REMINDER_2H','PAYMENT_REMINDER')`);
    await q.query(`CREATE TYPE scheduled_status AS ENUM ('PENDING','SENDING','SENT','FAILED','CANCELLED')`);
    await q.query(`CREATE TYPE message_direction AS ENUM ('IN','OUT')`);
    await q.query(`CREATE TYPE message_status AS ENUM ('SENT','DELIVERED','READ','FAILED')`);
    await q.query(`
      CREATE TABLE whatsapp_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id uuid NOT NULL UNIQUE REFERENCES clinics(id) ON DELETE CASCADE,
        phone_number varchar(20) NOT NULL,
        display_name varchar(120),
        channel_id varchar(64),
        sandbox boolean NOT NULL DEFAULT false,
        api_key_enc text NOT NULL,
        webhook_token varchar(64) NOT NULL UNIQUE,
        status wa_account_status NOT NULL DEFAULT 'PENDING',
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE scheduled_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        kind scheduled_kind NOT NULL,
        appointment_id uuid REFERENCES appointments(id) ON DELETE CASCADE,
        charge_id uuid,
        send_at timestamptz NOT NULL,
        status scheduled_status NOT NULL DEFAULT 'PENDING',
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        cancel_reason varchar(120),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE UNIQUE INDEX scheduled_messages_appointment_kind_uq ON scheduled_messages(appointment_id, kind) WHERE appointment_id IS NOT NULL`,
    );
    await q.query(`CREATE INDEX scheduled_messages_due_idx ON scheduled_messages(status, send_at)`);
    await q.query(`
      CREATE TABLE messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
        direction message_direction NOT NULL,
        wa_message_id varchar(128) UNIQUE,
        type varchar(32) NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}',
        status message_status,
        scheduled_message_id uuid REFERENCES scheduled_messages(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX messages_clinic_created_idx ON messages(clinic_id, created_at)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE messages`);
    await q.query(`DROP TABLE scheduled_messages`);
    await q.query(`DROP TABLE whatsapp_accounts`);
    await q.query(`DROP TYPE message_status`);
    await q.query(`DROP TYPE message_direction`);
    await q.query(`DROP TYPE scheduled_status`);
    await q.query(`DROP TYPE scheduled_kind`);
    await q.query(`DROP TYPE wa_account_status`);
  }
}
