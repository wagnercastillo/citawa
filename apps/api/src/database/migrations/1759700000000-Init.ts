import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1759700000000 implements MigrationInterface {
  name = 'Init1759700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE subscription_status AS ENUM ('ACTIVE','PAST_DUE','SUSPENDED')`);
    await q.query(`CREATE TYPE user_role AS ENUM ('SUPERADMIN','OWNER','RECEPTION')`);
    await q.query(`
      CREATE TABLE clinics (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(120) NOT NULL,
        address varchar(255),
        timezone varchar(64) NOT NULL DEFAULT 'America/Lima',
        payment_instructions text,
        send_2h_to_confirmed boolean NOT NULL DEFAULT false,
        subscription_status subscription_status NOT NULL DEFAULT 'ACTIVE',
        paid_until date,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(254) NOT NULL UNIQUE,
        password_hash varchar(100),
        name varchar(120) NOT NULL,
        role user_role NOT NULL,
        clinic_id uuid REFERENCES clinics(id) ON DELETE CASCADE,
        active boolean NOT NULL DEFAULT true,
        invite_token_hash char(64) UNIQUE,
        invite_expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT users_clinic_role_chk CHECK ((role = 'SUPERADMIN') = (clinic_id IS NULL))
      )`);
    await q.query(`CREATE INDEX users_clinic_id_idx ON users(clinic_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE users`);
    await q.query(`DROP TABLE clinics`);
    await q.query(`DROP TYPE user_role`);
    await q.query(`DROP TYPE subscription_status`);
  }
}
