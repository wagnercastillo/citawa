import { MigrationInterface, QueryRunner } from 'typeorm';

export class Onboarding1760000000000 implements MigrationInterface {
  name = 'Onboarding1760000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE wa_template_status AS ENUM ('PENDING','APPROVED','REJECTED','PAUSED','DISABLED')`);
    await q.query(`
      CREATE TABLE whatsapp_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        name varchar(64) NOT NULL,
        language varchar(10) NOT NULL DEFAULT 'es',
        status wa_template_status NOT NULL DEFAULT 'PENDING',
        rejection_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT whatsapp_templates_clinic_name_uq UNIQUE (clinic_id, name)
      )`);
    await q.query(`
      CREATE TABLE whatsapp_onboarding_states (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        state_hash char(64) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE whatsapp_onboarding_states`);
    await q.query(`DROP TABLE whatsapp_templates`);
    await q.query(`DROP TYPE wa_template_status`);
  }
}
