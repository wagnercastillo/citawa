import { MigrationInterface, QueryRunner } from 'typeorm';

export class Agenda1759800000000 implements MigrationInterface {
  name = 'Agenda1759800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await q.query(`CREATE TYPE appointment_status AS ENUM ('SCHEDULED','CONFIRMED','CANCELLED','ATTENDED','NO_SHOW')`);
    await q.query(
      `CREATE TYPE appointment_event_type AS ENUM ('CREATED','UPDATED','CONFIRMED','CANCELLED','RESCHEDULED','ATTENDED','NO_SHOW')`,
    );
    await q.query(`CREATE TYPE event_source AS ENUM ('PANEL','WHATSAPP')`);
    await q.query(`
      CREATE TABLE business_hours (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        opens_at time NOT NULL,
        closes_at time NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT business_hours_range_chk CHECK (opens_at < closes_at)
      )`);
    await q.query(`CREATE INDEX business_hours_clinic_idx ON business_hours(clinic_id, weekday)`);
    await q.query(`
      CREATE TABLE services (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        name varchar(120) NOT NULL,
        duration_min integer NOT NULL CHECK (duration_min BETWEEN 5 AND 480),
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT services_clinic_name_uq UNIQUE (clinic_id, name)
      )`);
    await q.query(`
      CREATE TABLE patients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        full_name varchar(160) NOT NULL,
        phone_e164 varchar(20) NOT NULL,
        whatsapp_opt_in boolean NOT NULL DEFAULT false,
        opt_in_at timestamptz,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT patients_clinic_phone_uq UNIQUE (clinic_id, phone_e164)
      )`);
    await q.query(`CREATE INDEX patients_clinic_name_idx ON patients(clinic_id, full_name)`);
    await q.query(`
      CREATE TABLE appointments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        patient_id uuid REFERENCES patients(id),
        service_id uuid REFERENCES services(id),
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        status appointment_status NOT NULL DEFAULT 'SCHEDULED',
        is_block boolean NOT NULL DEFAULT false,
        google_event_id varchar(255),
        calendar_dirty boolean NOT NULL DEFAULT true,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT appointments_time_chk CHECK (starts_at < ends_at),
        CONSTRAINT appointments_block_chk CHECK (
          (is_block AND patient_id IS NULL AND service_id IS NULL)
          OR (NOT is_block AND patient_id IS NOT NULL AND service_id IS NOT NULL)
        ),
        CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
          clinic_id WITH =, tstzrange(starts_at, ends_at) WITH &&
        ) WHERE (status <> 'CANCELLED')
      )`);
    await q.query(`CREATE INDEX appointments_clinic_starts_idx ON appointments(clinic_id, starts_at)`);
    await q.query(`CREATE INDEX appointments_patient_idx ON appointments(patient_id)`);
    await q.query(`
      CREATE TABLE appointment_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        type appointment_event_type NOT NULL,
        source event_source NOT NULL,
        actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        data jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX appointment_events_appointment_idx ON appointment_events(appointment_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE appointment_events`);
    await q.query(`DROP TABLE appointments`);
    await q.query(`DROP TABLE patients`);
    await q.query(`DROP TABLE services`);
    await q.query(`DROP TABLE business_hours`);
    await q.query(`DROP TYPE event_source`);
    await q.query(`DROP TYPE appointment_event_type`);
    await q.query(`DROP TYPE appointment_status`);
  }
}
