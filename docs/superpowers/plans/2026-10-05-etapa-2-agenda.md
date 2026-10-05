# Etapa 2 — Agenda: pacientes, servicios, horario y citas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el consultorio configure su horario y servicios, registre pacientes y gestione citas y bloqueos en una agenda de día y semana, sin que nunca se crucen dos citas.

**Architecture:** La API (NestJS + TypeORM) agrega cuatro tablas y un historial de eventos de cita. El cruce de horarios lo impide PostgreSQL con un *exclusion constraint* (`btree_gist`), que la API traduce a 409. La API recibe fechas como "hora de pared" del consultorio (`date` `YYYY-MM-DD` + `time` `HH:MM`) y las convierte a UTC con la zona horaria del consultorio, todo en una utilidad pura con tests. Las respuestas devuelven instantes ISO en UTC y el panel los formatea con `Intl` en la zona del consultorio.

**Tech Stack:** Lo de la Etapa 1 (NestJS 11, TypeORM 0.3, PostgreSQL 16, Jest 29, Next.js 15 + shadcn) + `libphonenumber-js`.

**Spec:** `docs/superpowers/specs/2026-10-05-recepcionista-wa-design.md` (§4 tablas `business_hours`, `services`, `patients`, `appointments`, `appointment_events`; §5.1 crear/editar/cancelar citas sin los pasos de recordatorios; §6 `/app` agenda y pacientes, `/app/settings` datos, horario y servicios; §7).

## Global Constraints

- Prefijo global `api`; nunca poner `api` en `@Controller()`.
- Claves `uuid`, columnas `created_at`/`updated_at` `timestamptz`, nombres en snake_case.
- `clinic_id` siempre sale de `AuthUser.clinicId`; nunca se acepta del cliente.
- Endpoints del consultorio: `@Roles(Role.OWNER, Role.RECEPTION)`. Configuración (datos, horario, servicios): solo `Role.OWNER`. SUPERADMIN recibe 403.
- Recursos de otro consultorio → **404** (nunca 403, para no revelar que existen).
- Fechas de entrada: `date` = `YYYY-MM-DD`, `time` = `HH:MM` (24 h), interpretadas en `clinics.timezone` (por defecto `America/Lima`). Fechas de salida: ISO 8601 UTC.
- `weekday`: 0 = domingo … 6 = sábado.
- Teléfonos: E.164 con `libphonenumber-js`, país por defecto `PE`.
- Estados de cita: `SCHEDULED | CONFIRMED | CANCELLED | ATTENDED | NO_SHOW`.
- Tipos de evento: `CREATED | UPDATED | CONFIRMED | CANCELLED | RESCHEDULED | ATTENDED | NO_SHOW`; origen `PANEL | WHATSAPP` (en esta etapa siempre `PANEL`).
- Toda escritura sobre una cita pone `calendar_dirty = true` (lo consumirá la Etapa 6).
- Mensajes de error en español. El cruce de horario responde 409 con `"Horario ocupado: ya hay otra cita en ese horario"`.
- JSON se escribe con la herramienta de archivos, no con heredoc de bash (en la Etapa 1 se corrompían los `\\`). Los comandos npm usan `-w @recep/api` / `-w @recep/web`.
- Ejecutar en la rama `etapa-2-agenda`, creada desde `main`.

## Review Focus

1. **Cita a las 23:30 hora Lima** → aparece en la agenda de ese día, no del siguiente (borde de zona horaria UTC−5). Test en Task 6.
2. **Mover una cita encima de otra** → 409, y la cita original queda intacta (hora y estado). Test en Task 6.
3. **Cita cancelada** → su horario queda libre y se puede reservar de nuevo. Test en Task 6.
4. **El mismo teléfono escrito de otra forma** (`987 654 321` y `+51 987-654-321`) → se reconoce como duplicado (409), no crea un segundo paciente. Test en Task 5.
5. **El dueño intenta cambiar su suscripción o su `clinicId` por `PATCH /clinic`** → 400 y nada cambia. Test en Task 3.

---

## File Structure

```
apps/api/src/
├─ common/zoned-time.ts (+ .spec)     hora de pared ↔ UTC, addDays, daysBetween, DATE_RE, TIME_RE
├─ common/phone.ts (+ .spec)          normalizePhone → E.164 | null
├─ common/all-exceptions.filter.ts    + 23P01 → 409 "Horario ocupado…"
├─ database/migrations/1759800000000-Agenda.ts
├─ clinics/business-hour.entity.ts
├─ clinics/clinic-settings.dto.ts, clinic-settings.service.ts, clinic-settings.controller.ts, clinics.module.ts
├─ services/service.entity.ts, services.dto.ts, services.service.ts, services.controller.ts, services.module.ts
├─ patients/patient.entity.ts, patients.dto.ts, patients.service.ts, patients.controller.ts, patients.module.ts
└─ appointments/
   ├─ appointment.entity.ts, appointment-event.entity.ts
   ├─ appointment-status.ts (+ .spec)  reglas de transición
   ├─ appointments.dto.ts, appointments.service.ts
   ├─ appointments.controller.ts       /appointments y /patients/:id/appointments
   └─ appointments.module.ts
apps/api/test/  agenda-schema, clinic, services, patients, appointments (.e2e-spec.ts); utils.ts (+ seeds)
apps/web/src/
├─ lib/types.ts (+ tipos de agenda), lib/format.ts, lib/use-me.ts (+ useClinicMe)
├─ components/app-header.tsx
└─ app/app/page.tsx (agenda), app/app/patients/page.tsx, app/app/patients/[id]/page.tsx,
   app/app/settings/page.tsx, app/app/users/page.tsx (usa AppHeader)
```

---

### Task 1: Utilidades puras de zona horaria y teléfono

**Files:**
- Create: `apps/api/src/common/zoned-time.ts`, `apps/api/src/common/phone.ts`
- Test: `apps/api/src/common/zoned-time.spec.ts`, `apps/api/src/common/phone.spec.ts`

**Interfaces:**
- Produces:
  - `DATE_RE: RegExp`, `TIME_RE: RegExp`.
  - `zonedToUtc(date: string, time: string, timeZone: string): Date`.
  - `addDays(date: string, days: number): string`.
  - `daysBetween(from: string, to: string): number`.
  - `normalizePhone(input: string, defaultCountry?: CountryCode): string | null`.

- [ ] **Step 0: Rama e instalación**

Run:
```bash
git checkout -b etapa-2-agenda
npm i -w @recep/api libphonenumber-js
```
Expected: rama creada; `libphonenumber-js` aparece en `apps/api/package.json`.

- [ ] **Step 1: Tests (fallan)**

`apps/api/src/common/zoned-time.spec.ts`:
```ts
import { addDays, DATE_RE, daysBetween, TIME_RE, zonedToUtc } from './zoned-time';

describe('zoned-time', () => {
  it('convierte hora de pared de Lima (UTC-5) a UTC', () => {
    expect(zonedToUtc('2026-10-06', '09:30', 'America/Lima').toISOString()).toBe('2026-10-06T14:30:00.000Z');
  });

  it('23:30 en Lima es el día siguiente en UTC', () => {
    expect(zonedToUtc('2026-10-06', '23:30', 'America/Lima').toISOString()).toBe('2026-10-07T04:30:00.000Z');
  });

  it('respeta horario de verano (Madrid)', () => {
    expect(zonedToUtc('2026-07-01', '10:00', 'Europe/Madrid').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-01-15', '10:00', 'Europe/Madrid').toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it('medianoche', () => {
    expect(zonedToUtc('2026-10-06', '00:00', 'America/Lima').toISOString()).toBe('2026-10-06T05:00:00.000Z');
  });

  it('addDays cruza meses y años', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('daysBetween', () => {
    expect(daysBetween('2026-10-05', '2026-10-11')).toBe(6);
    expect(daysBetween('2026-10-05', '2026-10-05')).toBe(0);
    expect(daysBetween('2026-10-05', '2026-10-04')).toBe(-1);
  });

  it('regex de fecha y hora', () => {
    expect(DATE_RE.test('2026-10-06')).toBe(true);
    expect(DATE_RE.test('6/10/2026')).toBe(false);
    expect(TIME_RE.test('09:30')).toBe(true);
    expect(TIME_RE.test('9:30')).toBe(false);
    expect(TIME_RE.test('24:00')).toBe(false);
  });
});
```

`apps/api/src/common/phone.spec.ts`:
```ts
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('celular peruano con espacios → E.164', () => {
    expect(normalizePhone('987 654 321')).toBe('+51987654321');
  });
  it('con +51 y guiones → mismo E.164', () => {
    expect(normalizePhone('+51 987-654-321')).toBe('+51987654321');
  });
  it('número extranjero con prefijo', () => {
    expect(normalizePhone('+34 612 345 678')).toBe('+34612345678');
  });
  it('basura → null', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('hola')).toBeNull();
  });
});
```

Run: `npm test -w @recep/api`
Expected: FAIL, "Cannot find module './zoned-time'" y "'./phone'".

- [ ] **Step 2: Implementación**

`apps/api/src/common/zoned-time.ts`:
```ts
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Diferencia (ms) entre la hora de pared de `timeZone` y UTC en el instante dado. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const n = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - instant;
}

/** Convierte fecha `YYYY-MM-DD` + hora `HH:MM` "de pared" en `timeZone` al instante UTC correspondiente. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const firstGuess = wall - offsetMs(wall, timeZone);
  return new Date(wall - offsetMs(firstGuess, timeZone));
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
```

`apps/api/src/common/phone.ts`:
```ts
import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

/** Devuelve el teléfono en E.164 (+51987654321) o null si no es válido. */
export function normalizePhone(input: string, defaultCountry: CountryCode = 'PE'): string | null {
  const parsed = parsePhoneNumberFromString(input, defaultCountry);
  return parsed && parsed.isValid() ? parsed.number : null;
}
```

- [ ] **Step 3: Tests pasan**

Run: `npm test -w @recep/api`
Expected: PASS (3 suites unitarias: invite-token, zoned-time, phone).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add zoned time and phone normalization utilities"
```

---

### Task 2: Esquema de la agenda (migración, entidades, exclusion constraint)

**Files:**
- Create: `apps/api/src/database/migrations/1759800000000-Agenda.ts`
- Create: `apps/api/src/clinics/business-hour.entity.ts`, `apps/api/src/services/service.entity.ts`, `apps/api/src/patients/patient.entity.ts`, `apps/api/src/appointments/appointment.entity.ts`, `apps/api/src/appointments/appointment-event.entity.ts`
- Modify: `apps/api/src/database/data-source.ts` (entidades + migración)
- Modify: `apps/api/test/utils.ts` (seeds `seedService`, `seedPatient`, `seedHours`)
- Test: `apps/api/test/agenda-schema.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `BusinessHour { id; clinicId; weekday: number; opensAt: string; closesAt: string }`
  - `Service { id; clinicId; name; durationMin: number; active: boolean }`
  - `Patient { id; clinicId; fullName; phoneE164; whatsappOptIn: boolean; optInAt: Date | null; notes: string | null }`
  - `enum AppointmentStatus`
  - `Appointment { id; clinicId; patientId: string | null; patient?: Patient; serviceId: string | null; service?: Service; startsAt: Date; endsAt: Date; status; isBlock; googleEventId: string | null; calendarDirty: boolean; createdBy: string | null }`
  - `enum AppointmentEventType`, `enum EventSource`
  - `AppointmentEvent { id; appointmentId; clinicId; type; source; actorUserId: string | null; data: Record<string, unknown>; createdAt }`
  - Seeds de test:
    - `seedService(app, clinicId, name?, durationMin?): Promise<Service>`
    - `seedPatient(app, clinicId, data?): Promise<Patient>`
    - `seedHours(app, clinicId, rows): Promise<void>`

- [ ] **Step 1: Test del esquema (falla)**

`apps/api/test/agenda-schema.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb, seedClinic, seedPatient, seedService } from './utils';

describe('agenda schema', () => {
  let app: INestApplication;
  let ds: DataSource;
  let clinicA: string;
  let clinicB: string;
  let patientA: string;
  let serviceA: string;
  let patientB: string;
  let serviceB: string;

  const insert = (clinicId: string, starts: string, ends: string, extra: Record<string, unknown> = {}) => {
    const block = extra.is_block === true;
    return ds.query(
      `INSERT INTO appointments (clinic_id, patient_id, service_id, starts_at, ends_at, status, is_block)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        clinicId,
        block ? null : (extra.patient_id ?? (clinicId === clinicA ? patientA : patientB)),
        block ? null : (extra.service_id ?? (clinicId === clinicA ? serviceA : serviceB)),
        starts,
        ends,
        extra.status ?? 'SCHEDULED',
        block,
      ],
    );
  };

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDb(app);
    clinicA = (await seedClinic(app, 'A')).id;
    clinicB = (await seedClinic(app, 'B')).id;
    patientA = (await seedPatient(app, clinicA)).id;
    serviceA = (await seedService(app, clinicA)).id;
    patientB = (await seedPatient(app, clinicB)).id;
    serviceB = (await seedService(app, clinicB)).id;
  });
  afterAll(async () => { await app.close(); });

  it('rechaza citas que se cruzan en el mismo consultorio', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z');
    await expect(insert(clinicA, '2026-10-06T14:15:00Z', '2026-10-06T14:45:00Z')).rejects.toMatchObject({ code: '23P01' });
  });

  it('permite citas pegadas (una termina cuando empieza la otra)', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z');
    await expect(insert(clinicA, '2026-10-06T14:30:00Z', '2026-10-06T15:00:00Z')).resolves.toBeDefined();
  });

  it('una cita cancelada no ocupa el horario', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z', { status: 'CANCELLED' });
    await expect(insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z')).resolves.toBeDefined();
  });

  it('otro consultorio puede tener cita a la misma hora', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z');
    await expect(insert(clinicB, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z')).resolves.toBeDefined();
  });

  it('un bloqueo también ocupa el horario', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T16:00:00Z', { is_block: true });
    await expect(insert(clinicA, '2026-10-06T15:00:00Z', '2026-10-06T15:30:00Z')).rejects.toMatchObject({ code: '23P01' });
  });

  it('rechaza fin antes del inicio y bloqueo con paciente', async () => {
    await expect(insert(clinicA, '2026-10-06T15:00:00Z', '2026-10-06T14:00:00Z')).rejects.toMatchObject({ code: '23514' });
    await expect(
      ds.query(
        `INSERT INTO appointments (clinic_id, patient_id, service_id, starts_at, ends_at, is_block)
         VALUES ($1, $2, $3, '2026-10-06T14:00:00Z', '2026-10-06T15:00:00Z', true)`,
        [clinicA, patientA, serviceA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('borrar el consultorio borra pacientes, servicios y citas', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z');
    await ds.query('DELETE FROM clinics WHERE id = $1', [clinicA]);
    const [{ count }] = await ds.query('SELECT count(*)::int AS count FROM appointments WHERE clinic_id = $1', [clinicA]);
    expect(count).toBe(0);
  });
});
```

En `apps/api/test/utils.ts`, agregar estos imports y funciones al final (el resto del archivo no cambia):
```ts
import { BusinessHour } from '../src/clinics/business-hour.entity';
import { Patient } from '../src/patients/patient.entity';
import { Service } from '../src/services/service.entity';

export async function seedService(app: INestApplication, clinicId: string, name = 'Limpieza', durationMin = 30): Promise<Service> {
  const repo = app.get(DataSource).getRepository(Service);
  return repo.save(repo.create({ clinicId, name, durationMin }));
}

export async function seedPatient(
  app: INestApplication,
  clinicId: string,
  data: { fullName?: string; phone?: string; optIn?: boolean } = {},
): Promise<Patient> {
  const repo = app.get(DataSource).getRepository(Patient);
  const optIn = data.optIn ?? true;
  return repo.save(
    repo.create({
      clinicId,
      fullName: data.fullName ?? 'Juan Pérez',
      phoneE164: data.phone ?? '+51987654321',
      whatsappOptIn: optIn,
      optInAt: optIn ? new Date() : null,
    }),
  );
}

export async function seedHours(
  app: INestApplication,
  clinicId: string,
  rows: { weekday: number; opensAt: string; closesAt: string }[],
): Promise<void> {
  const repo = app.get(DataSource).getRepository(BusinessHour);
  await repo.save(rows.map((r) => repo.create({ clinicId, ...r })));
}
```
(Los `import` nuevos van arriba, junto a los existentes.)

Run: `npm run test:e2e -w @recep/api -- agenda-schema`
Expected: FAIL, "Cannot find module '../src/clinics/business-hour.entity'".

- [ ] **Step 2: Migración**

`apps/api/src/database/migrations/1759800000000-Agenda.ts`:
```ts
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
```

- [ ] **Step 3: Entidades**

`apps/api/src/clinics/business-hour.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('business_hours')
export class BusinessHour {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ type: 'smallint' }) weekday: number;
  @Column({ name: 'opens_at', type: 'time' }) opensAt: string;
  @Column({ name: 'closes_at', type: 'time' }) closesAt: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

`apps/api/src/services/service.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('services')
export class Service {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ name: 'duration_min', type: 'integer' }) durationMin: number;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

`apps/api/src/patients/patient.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ name: 'full_name', type: 'varchar', length: 160 }) fullName: string;
  @Column({ name: 'phone_e164', type: 'varchar', length: 20 }) phoneE164: string;
  @Column({ name: 'whatsapp_opt_in', type: 'boolean', default: false }) whatsappOptIn: boolean;
  @Column({ name: 'opt_in_at', type: 'timestamptz', nullable: true }) optInAt: Date | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

`apps/api/src/appointments/appointment.entity.ts`:
```ts
import {
  Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Patient } from '../patients/patient.entity';
import { Service } from '../services/service.entity';

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  ATTENDED = 'ATTENDED',
  NO_SHOW = 'NO_SHOW',
}

@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ name: 'patient_id', type: 'uuid', nullable: true }) patientId: string | null;
  @ManyToOne(() => Patient)
  @JoinColumn({ name: 'patient_id' })
  patient?: Patient | null;
  @Column({ name: 'service_id', type: 'uuid', nullable: true }) serviceId: string | null;
  @ManyToOne(() => Service)
  @JoinColumn({ name: 'service_id' })
  service?: Service | null;
  @Column({ name: 'starts_at', type: 'timestamptz' }) startsAt: Date;
  @Column({ name: 'ends_at', type: 'timestamptz' }) endsAt: Date;
  @Column({ type: 'enum', enum: AppointmentStatus, enumName: 'appointment_status', default: AppointmentStatus.SCHEDULED })
  status: AppointmentStatus;
  @Column({ name: 'is_block', type: 'boolean', default: false }) isBlock: boolean;
  @Column({ name: 'google_event_id', type: 'varchar', length: 255, nullable: true }) googleEventId: string | null;
  @Column({ name: 'calendar_dirty', type: 'boolean', default: true }) calendarDirty: boolean;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

`apps/api/src/appointments/appointment-event.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum AppointmentEventType {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  RESCHEDULED = 'RESCHEDULED',
  ATTENDED = 'ATTENDED',
  NO_SHOW = 'NO_SHOW',
}

export enum EventSource {
  PANEL = 'PANEL',
  WHATSAPP = 'WHATSAPP',
}

@Entity('appointment_events')
export class AppointmentEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'appointment_id', type: 'uuid' }) appointmentId: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ type: 'enum', enum: AppointmentEventType, enumName: 'appointment_event_type' }) type: AppointmentEventType;
  @Column({ type: 'enum', enum: EventSource, enumName: 'event_source' }) source: EventSource;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true }) actorUserId: string | null;
  @Column({ type: 'jsonb', default: {} }) data: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
```

`apps/api/src/database/data-source.ts`: reemplazar los arrays `entities` y `migrations` y agregar los imports:
```ts
import { AppointmentEvent } from '../appointments/appointment-event.entity';
import { Appointment } from '../appointments/appointment.entity';
import { BusinessHour } from '../clinics/business-hour.entity';
import { Patient } from '../patients/patient.entity';
import { Service } from '../services/service.entity';
import { Agenda1759800000000 } from './migrations/1759800000000-Agenda';
// ...
  entities: [Clinic, User, BusinessHour, Service, Patient, Appointment, AppointmentEvent],
  migrations: [Init1759700000000, Agenda1759800000000],
```

- [ ] **Step 4: Tests pasan y migración en desarrollo**

Run: `npm run test:e2e -w @recep/api`
Expected: PASS (todas las suites; `agenda schema` con 7 tests).

Run: `npm run migration:run -w @recep/api`
Expected: "Migration Agenda1759800000000 has been executed successfully."

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add agenda schema with no-overlap exclusion constraint"
```

---

### Task 3: Configuración del consultorio y horario de atención

**Files:**
- Create: `apps/api/src/clinics/clinic-settings.dto.ts`, `clinic-settings.service.ts`, `clinic-settings.controller.ts`, `clinics.module.ts`
- Modify: `apps/api/src/app.module.ts` (importar `ClinicsModule`)
- Test: `apps/api/test/clinic.e2e-spec.ts`

**Interfaces:**
- Consumes: `Clinic`, `BusinessHour`, `TIME_RE`, `@Roles`, `@CurrentUser`, `AuthUser`.
- Produces:
  - `GET /api/clinic` (OWNER, RECEPTION) → `ClinicSettings { id; name; address; timezone; paymentInstructions; send2hToConfirmed; subscriptionStatus; paidUntil }`
  - `PATCH /api/clinic` (OWNER) `{ name?, address?, paymentInstructions?, send2hToConfirmed? }` → `ClinicSettings`. `address` y `paymentInstructions` vacíos ("") se guardan como null.
  - `GET /api/clinic/hours` (OWNER, RECEPTION) → `HourDto[] { weekday; opensAt 'HH:MM'; closesAt 'HH:MM' }`, ordenado por día y hora.
  - `PUT /api/clinic/hours` (OWNER) `{ hours: HourDto[] }` → reemplaza todo el horario y devuelve `HourDto[]`.
  - `ClinicSettingsService.getTimezone(clinicId): Promise<string>` (exportado para la Task 6).

- [ ] **Step 1: Test (falla)**

`apps/api/test/clinic.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedUser } from './utils';

describe('clinic settings', () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;

  const loginAs = async (email: string): Promise<ReturnType<typeof request.agent>> => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: 'secreta123' }).expect(200);
    return agent;
  };

  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(async () => {
    await resetDb(app);
    const a = await seedClinic(app, 'Sonrisas');
    const b = await seedClinic(app, 'Otra');
    await seedUser(app, { email: 'owner@a.com', password: 'secreta123', role: Role.OWNER, clinicId: a.id });
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId: a.id });
    await seedUser(app, { email: 'owner@b.com', password: 'secreta123', role: Role.OWNER, clinicId: b.id });
    await seedUser(app, { email: 'root@x.com', password: 'secreta123', role: Role.SUPERADMIN });
    owner = await loginAs('owner@a.com');
  });
  afterAll(async () => { await app.close(); });

  it('el dueño ve y edita los datos del consultorio', async () => {
    const get = await owner.get('/api/clinic').expect(200);
    expect(get.body).toEqual(expect.objectContaining({
      name: 'Sonrisas', timezone: 'America/Lima', send2hToConfirmed: false, paymentInstructions: null,
    }));
    const upd = await owner
      .patch('/api/clinic')
      .send({ name: 'Sonrisas Miraflores', address: 'Av. Larco 123', paymentInstructions: 'Yape 987654321', send2hToConfirmed: true })
      .expect(200);
    expect(upd.body).toEqual(expect.objectContaining({
      name: 'Sonrisas Miraflores', address: 'Av. Larco 123', paymentInstructions: 'Yape 987654321', send2hToConfirmed: true,
    }));
    const cleared = await owner.patch('/api/clinic').send({ address: '' }).expect(200);
    expect(cleared.body.address).toBeNull();
  });

  it('el dueño no puede cambiar su suscripción ni su clinicId', async () => {
    await owner.patch('/api/clinic').send({ subscriptionStatus: 'ACTIVE', paidUntil: '2099-12-31' }).expect(400);
    await owner.patch('/api/clinic').send({ id: '00000000-0000-0000-0000-000000000000' }).expect(400);
    const get = await owner.get('/api/clinic').expect(200);
    expect(get.body.paidUntil).toBeNull();
  });

  it('recepción ve pero no edita; superadmin no entra', async () => {
    const recep = await loginAs('recep@a.com');
    await recep.get('/api/clinic').expect(200);
    await recep.patch('/api/clinic').send({ name: 'Hack' }).expect(403);
    await recep.put('/api/clinic/hours').send({ hours: [] }).expect(403);
    const root = await loginAs('root@x.com');
    await root.get('/api/clinic').expect(403);
  });

  it('guarda y devuelve el horario ordenado en HH:MM', async () => {
    const hours = [
      { weekday: 6, opensAt: '09:00', closesAt: '12:00' },
      { weekday: 1, opensAt: '14:00', closesAt: '18:00' },
      { weekday: 1, opensAt: '09:00', closesAt: '13:00' },
    ];
    const put = await owner.put('/api/clinic/hours').send({ hours }).expect(200);
    expect(put.body).toEqual([
      { weekday: 1, opensAt: '09:00', closesAt: '13:00' },
      { weekday: 1, opensAt: '14:00', closesAt: '18:00' },
      { weekday: 6, opensAt: '09:00', closesAt: '12:00' },
    ]);
    const get = await owner.get('/api/clinic/hours').expect(200);
    expect(get.body).toEqual(put.body);
    await owner.put('/api/clinic/hours').send({ hours: [] }).expect(200);
    expect((await owner.get('/api/clinic/hours').expect(200)).body).toEqual([]);
  });

  it('rechaza horarios inválidos o que se cruzan', async () => {
    await owner.put('/api/clinic/hours').send({ hours: [{ weekday: 1, opensAt: '09:00', closesAt: '13:00' }, { weekday: 1, opensAt: '12:00', closesAt: '15:00' }] }).expect(400);
    await owner.put('/api/clinic/hours').send({ hours: [{ weekday: 1, opensAt: '13:00', closesAt: '09:00' }] }).expect(400);
    await owner.put('/api/clinic/hours').send({ hours: [{ weekday: 7, opensAt: '09:00', closesAt: '13:00' }] }).expect(400);
    await owner.put('/api/clinic/hours').send({ hours: [{ weekday: 1, opensAt: '25:00', closesAt: '26:00' }] }).expect(400);
  });

  it('cada consultorio ve solo su horario', async () => {
    await owner.put('/api/clinic/hours').send({ hours: [{ weekday: 1, opensAt: '09:00', closesAt: '13:00' }] }).expect(200);
    const ownerB = await loginAs('owner@b.com');
    expect((await ownerB.get('/api/clinic/hours').expect(200)).body).toEqual([]);
  });
});
```

Run: `npm run test:e2e -w @recep/api -- clinic`
Expected: FAIL (404 en `/api/clinic`).

- [ ] **Step 2: Implementación**

`apps/api/src/clinics/clinic-settings.dto.ts`:
```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { TIME_RE } from '../common/zoned-time';

export class UpdateClinicSettingsDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsOptional() @IsString() @MaxLength(500) paymentInstructions?: string;
  @IsOptional() @IsBoolean() send2hToConfirmed?: boolean;
}

export class HourDto {
  @IsInt() @Min(0) @Max(6) weekday: number;
  @Matches(TIME_RE, { message: 'opensAt debe tener formato HH:MM' }) opensAt: string;
  @Matches(TIME_RE, { message: 'closesAt debe tener formato HH:MM' }) closesAt: string;
}

export class PutHoursDto {
  @IsArray() @ArrayMaxSize(21) @ValidateNested({ each: true }) @Type(() => HourDto) hours: HourDto[];
}
```

`apps/api/src/clinics/clinic-settings.service.ts`:
```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BusinessHour } from './business-hour.entity';
import { Clinic, SubscriptionStatus } from './clinic.entity';
import { HourDto, UpdateClinicSettingsDto } from './clinic-settings.dto';

export interface ClinicSettings {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  paymentInstructions: string | null;
  send2hToConfirmed: boolean;
  subscriptionStatus: SubscriptionStatus;
  paidUntil: string | null;
}

const toSettings = (c: Clinic): ClinicSettings => ({
  id: c.id,
  name: c.name,
  address: c.address,
  timezone: c.timezone,
  paymentInstructions: c.paymentInstructions,
  send2hToConfirmed: c.send2hToConfirmed,
  subscriptionStatus: c.subscriptionStatus,
  paidUntil: c.paidUntil,
});

const toHourDto = (h: BusinessHour): HourDto => ({
  weekday: h.weekday,
  opensAt: h.opensAt.slice(0, 5),
  closesAt: h.closesAt.slice(0, 5),
});

const emptyToNull = (v: string | undefined): string | null | undefined => (v === undefined ? undefined : v.trim() || null);

@Injectable()
export class ClinicSettingsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async get(clinicId: string): Promise<ClinicSettings> {
    return toSettings(await this.ds.getRepository(Clinic).findOneByOrFail({ id: clinicId }));
  }

  async getTimezone(clinicId: string): Promise<string> {
    return (await this.ds.getRepository(Clinic).findOneByOrFail({ id: clinicId })).timezone;
  }

  async update(clinicId: string, dto: UpdateClinicSettingsDto): Promise<ClinicSettings> {
    const repo = this.ds.getRepository(Clinic);
    const clinic = await repo.findOneByOrFail({ id: clinicId });
    if (dto.name !== undefined) clinic.name = dto.name;
    const address = emptyToNull(dto.address);
    if (address !== undefined) clinic.address = address;
    const payment = emptyToNull(dto.paymentInstructions);
    if (payment !== undefined) clinic.paymentInstructions = payment;
    if (dto.send2hToConfirmed !== undefined) clinic.send2hToConfirmed = dto.send2hToConfirmed;
    return toSettings(await repo.save(clinic));
  }

  async hours(clinicId: string): Promise<HourDto[]> {
    const rows = await this.ds
      .getRepository(BusinessHour)
      .find({ where: { clinicId }, order: { weekday: 'ASC', opensAt: 'ASC' } });
    return rows.map(toHourDto);
  }

  async replaceHours(clinicId: string, hours: HourDto[]): Promise<HourDto[]> {
    const sorted = [...hours].sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt));
    sorted.forEach((h, i) => {
      if (h.opensAt >= h.closesAt) throw new BadRequestException('La hora de apertura debe ser menor que la de cierre');
      const prev = sorted[i - 1];
      if (prev && prev.weekday === h.weekday && h.opensAt < prev.closesAt) {
        throw new BadRequestException('Hay horarios que se cruzan el mismo día');
      }
    });
    await this.ds.transaction(async (m) => {
      await m.delete(BusinessHour, { clinicId });
      await m.save(sorted.map((h) => m.create(BusinessHour, { clinicId, ...h })));
    });
    return this.hours(clinicId);
  }
}
```

`apps/api/src/clinics/clinic-settings.controller.ts`:
```ts
import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { Role } from '../users/role.enum';
import { HourDto, PutHoursDto, UpdateClinicSettingsDto } from './clinic-settings.dto';
import { ClinicSettings, ClinicSettingsService } from './clinic-settings.service';

@Roles(Role.OWNER, Role.RECEPTION)
@Controller('clinic')
export class ClinicSettingsController {
  constructor(private readonly settings: ClinicSettingsService) {}

  @Get()
  get(@CurrentUser() me: AuthUser): Promise<ClinicSettings> {
    return this.settings.get(me.clinicId!);
  }

  @Roles(Role.OWNER)
  @Patch()
  update(@CurrentUser() me: AuthUser, @Body() dto: UpdateClinicSettingsDto): Promise<ClinicSettings> {
    return this.settings.update(me.clinicId!, dto);
  }

  @Get('hours')
  hours(@CurrentUser() me: AuthUser): Promise<HourDto[]> {
    return this.settings.hours(me.clinicId!);
  }

  @Roles(Role.OWNER)
  @Put('hours')
  replaceHours(@CurrentUser() me: AuthUser, @Body() dto: PutHoursDto): Promise<HourDto[]> {
    return this.settings.replaceHours(me.clinicId!, dto.hours);
  }
}
```

`apps/api/src/clinics/clinics.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ClinicSettingsController } from './clinic-settings.controller';
import { ClinicSettingsService } from './clinic-settings.service';

@Module({
  controllers: [ClinicSettingsController],
  providers: [ClinicSettingsService],
  exports: [ClinicSettingsService],
})
export class ClinicsModule {}
```

En `apps/api/src/app.module.ts`: `import { ClinicsModule } from './clinics/clinics.module';` y agregar `ClinicsModule` al final del array `imports`.

- [ ] **Step 3: Tests pasan**

Run: `npm run test:e2e -w @recep/api`
Expected: PASS (todas las suites; `clinic settings` con 6 tests).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add clinic settings and business hours endpoints"
```

---

### Task 4: Servicios del consultorio

**Files:**
- Create: `apps/api/src/services/services.dto.ts`, `services.service.ts`, `services.controller.ts`, `services.module.ts`
- Modify: `apps/api/src/app.module.ts` (importar `ServicesModule`)
- Test: `apps/api/test/services.e2e-spec.ts`

**Interfaces:**
- Consumes: `Service`, `@Roles`, `@CurrentUser`.
- Produces:
  - `GET /api/services` (OWNER, RECEPTION) → `ServiceDto[] { id; name; durationMin; active }`, ordenado por nombre.
  - `POST /api/services` (OWNER) `{ name, durationMin }` → 201 `ServiceDto`
  - `PATCH /api/services/:id` (OWNER) `{ name?, durationMin?, active? }` → `ServiceDto`
  - `ServicesService.findInClinic(clinicId, id): Promise<Service>` (404 si no es del consultorio; lo usa la Task 6).

- [ ] **Step 1: Test (falla)**

`apps/api/test/services.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedService, seedUser } from './utils';

describe('services', () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let serviceB: string;

  const loginAs = async (email: string): Promise<ReturnType<typeof request.agent>> => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: 'secreta123' }).expect(200);
    return agent;
  };

  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(async () => {
    await resetDb(app);
    const a = await seedClinic(app, 'A');
    const b = await seedClinic(app, 'B');
    await seedUser(app, { email: 'owner@a.com', password: 'secreta123', role: Role.OWNER, clinicId: a.id });
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId: a.id });
    serviceB = (await seedService(app, b.id, 'Servicio de B')).id;
    owner = await loginAs('owner@a.com');
  });
  afterAll(async () => { await app.close(); });

  it('crea, lista ordenado y edita servicios', async () => {
    const created = await owner.post('/api/services').send({ name: 'Ortodoncia', durationMin: 45 }).expect(201);
    expect(created.body).toEqual({ id: expect.any(String), name: 'Ortodoncia', durationMin: 45, active: true });
    await owner.post('/api/services').send({ name: 'Limpieza', durationMin: 30 }).expect(201);
    const list = await owner.get('/api/services').expect(200);
    expect(list.body.map((s: { name: string }) => s.name)).toEqual(['Limpieza', 'Ortodoncia']);
    const upd = await owner.patch(`/api/services/${created.body.id}`).send({ durationMin: 60, active: false }).expect(200);
    expect(upd.body).toEqual(expect.objectContaining({ durationMin: 60, active: false }));
  });

  it('valida duración y nombre duplicado', async () => {
    await owner.post('/api/services').send({ name: 'Rápido', durationMin: 3 }).expect(400);
    await owner.post('/api/services').send({ name: 'Eterno', durationMin: 600 }).expect(400);
    await owner.post('/api/services').send({ name: 'Limpieza', durationMin: 30 }).expect(201);
    await owner.post('/api/services').send({ name: 'Limpieza', durationMin: 40 }).expect(409);
  });

  it('recepción lista pero no crea ni edita', async () => {
    const recep = await loginAs('recep@a.com');
    await recep.get('/api/services').expect(200);
    await recep.post('/api/services').send({ name: 'X servicio', durationMin: 30 }).expect(403);
  });

  it('no ve ni edita servicios de otro consultorio', async () => {
    expect((await owner.get('/api/services').expect(200)).body).toEqual([]);
    await owner.patch(`/api/services/${serviceB}`).send({ active: false }).expect(404);
  });
});
```

Run: `npm run test:e2e -w @recep/api -- services`
Expected: FAIL (404 en `/api/services`).

- [ ] **Step 2: Implementación**

`apps/api/src/services/services.dto.ts`:
```ts
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateServiceDto {
  @IsString() @Length(2, 120) name: string;
  @IsInt() @Min(5) @Max(480) durationMin: number;
}

export class UpdateServiceDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsInt() @Min(5) @Max(480) durationMin?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

`apps/api/src/services/services.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Service } from './service.entity';
import { CreateServiceDto, UpdateServiceDto } from './services.dto';

export interface ServiceDto {
  id: string;
  name: string;
  durationMin: number;
  active: boolean;
}

const toDto = (s: Service): ServiceDto => ({ id: s.id, name: s.name, durationMin: s.durationMin, active: s.active });

@Injectable()
export class ServicesService {
  constructor(@InjectRepository(Service) private readonly services: Repository<Service>) {}

  async list(clinicId: string): Promise<ServiceDto[]> {
    return (await this.services.find({ where: { clinicId }, order: { name: 'ASC' } })).map(toDto);
  }

  async create(clinicId: string, dto: CreateServiceDto): Promise<ServiceDto> {
    return toDto(await this.services.save(this.services.create({ clinicId, ...dto })));
  }

  async update(clinicId: string, id: string, dto: UpdateServiceDto): Promise<ServiceDto> {
    const service = await this.findInClinic(clinicId, id);
    Object.assign(service, dto);
    return toDto(await this.services.save(service));
  }

  async findInClinic(clinicId: string, id: string): Promise<Service> {
    const service = await this.services.findOne({ where: { id, clinicId } });
    if (!service) throw new NotFoundException('Servicio no encontrado');
    return service;
  }
}
```

`apps/api/src/services/services.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { Role } from '../users/role.enum';
import { CreateServiceDto, UpdateServiceDto } from './services.dto';
import { ServiceDto, ServicesService } from './services.service';

@Roles(Role.OWNER, Role.RECEPTION)
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(@CurrentUser() me: AuthUser): Promise<ServiceDto[]> {
    return this.services.list(me.clinicId!);
  }

  @Roles(Role.OWNER)
  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateServiceDto): Promise<ServiceDto> {
    return this.services.create(me.clinicId!, dto);
  }

  @Roles(Role.OWNER)
  @Patch(':id')
  update(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ): Promise<ServiceDto> {
    return this.services.update(me.clinicId!, id, dto);
  }
}
```

`apps/api/src/services/services.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Service } from './service.entity';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [TypeOrmModule.forFeature([Service])],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
```

En `apps/api/src/app.module.ts`: `import { ServicesModule } from './services/services.module';` y agregar `ServicesModule` al final de `imports`.

- [ ] **Step 3: Tests pasan**

Run: `npm run test:e2e -w @recep/api`
Expected: PASS (todas; `services` con 4 tests).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add clinic services endpoints"
```

---

### Task 5: Pacientes

**Files:**
- Create: `apps/api/src/patients/patients.dto.ts`, `patients.service.ts`, `patients.controller.ts`, `patients.module.ts`
- Modify: `apps/api/src/app.module.ts` (importar `PatientsModule`)
- Test: `apps/api/test/patients.e2e-spec.ts`

**Interfaces:**
- Consumes: `Patient`, `normalizePhone`, `@Roles`, `@CurrentUser`.
- Produces:
  - `PatientDto { id; fullName; phone: string (E.164); whatsappOptIn; optInAt: string | null; notes: string | null }`
  - Rutas (OWNER, RECEPTION):
    - `GET /api/patients?q=` → `PatientDto[]` (máx. 50, por nombre; busca en nombre y, si hay ≥ 3 dígitos, en teléfono)
    - `GET /api/patients/:id` → `PatientDto`
    - `POST /api/patients` `{ fullName, phone, whatsappOptIn?, notes? }` → 201
    - `PATCH /api/patients/:id` `{ fullName?, phone?, whatsappOptIn?, notes? }`
  - `PatientsService.findInClinic(clinicId, id): Promise<Patient>` (404; lo usa la Task 6).
  - `toPatientDto(p: Patient): PatientDto` (exportado).

- [ ] **Step 1: Test (falla)**

`apps/api/test/patients.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedPatient, seedUser } from './utils';

describe('patients', () => {
  let app: INestApplication;
  let recep: ReturnType<typeof request.agent>;
  let patientB: string;

  const loginAs = async (email: string): Promise<ReturnType<typeof request.agent>> => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: 'secreta123' }).expect(200);
    return agent;
  };

  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(async () => {
    await resetDb(app);
    const a = await seedClinic(app, 'A');
    const b = await seedClinic(app, 'B');
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId: a.id });
    await seedUser(app, { email: 'root@x.com', password: 'secreta123', role: Role.SUPERADMIN });
    patientB = (await seedPatient(app, b.id, { fullName: 'Paciente de B', phone: '+51911111111' })).id;
    recep = await loginAs('recep@a.com');
  });
  afterAll(async () => { await app.close(); });

  it('crea paciente normalizando el teléfono y registrando el consentimiento', async () => {
    const res = await recep
      .post('/api/patients')
      .send({ fullName: 'Juan Pérez', phone: '987 654 321', whatsappOptIn: true, notes: 'Alergia a la penicilina' })
      .expect(201);
    expect(res.body).toEqual({
      id: expect.any(String), fullName: 'Juan Pérez', phone: '+51987654321', whatsappOptIn: true,
      optInAt: expect.any(String), notes: 'Alergia a la penicilina',
    });
  });

  it('teléfono inválido da 400', () =>
    recep.post('/api/patients').send({ fullName: 'Juan Pérez', phone: '12345' }).expect(400));

  it('el mismo teléfono escrito distinto es duplicado (409)', async () => {
    await recep.post('/api/patients').send({ fullName: 'Juan Pérez', phone: '987 654 321' }).expect(201);
    const dup = await recep.post('/api/patients').send({ fullName: 'Otro Juan', phone: '+51 987-654-321' }).expect(409);
    expect(dup.body.message).toBe('Ya existe un paciente con ese teléfono');
  });

  it('busca por nombre (sin distinguir mayúsculas) y por teléfono', async () => {
    await recep.post('/api/patients').send({ fullName: 'Juan Pérez', phone: '987654321' }).expect(201);
    await recep.post('/api/patients').send({ fullName: 'María López', phone: '912345678' }).expect(201);
    const byName = await recep.get('/api/patients').query({ q: 'juan' }).expect(200);
    expect(byName.body.map((p: { fullName: string }) => p.fullName)).toEqual(['Juan Pérez']);
    const byPhone = await recep.get('/api/patients').query({ q: '345' }).expect(200);
    expect(byPhone.body.map((p: { fullName: string }) => p.fullName)).toEqual(['María López']);
    const wildcard = await recep.get('/api/patients').query({ q: '%' }).expect(200);
    expect(wildcard.body).toEqual([]);
    const all = await recep.get('/api/patients').expect(200);
    expect(all.body.map((p: { fullName: string }) => p.fullName)).toEqual(['Juan Pérez', 'María López']);
  });

  it('quitar el consentimiento borra la fecha; cambiar a un teléfono ocupado da 409', async () => {
    const a = await recep.post('/api/patients').send({ fullName: 'Juan Pérez', phone: '987654321', whatsappOptIn: true }).expect(201);
    await recep.post('/api/patients').send({ fullName: 'María López', phone: '912345678' }).expect(201);
    const off = await recep.patch(`/api/patients/${a.body.id}`).send({ whatsappOptIn: false }).expect(200);
    expect(off.body).toEqual(expect.objectContaining({ whatsappOptIn: false, optInAt: null }));
    await recep.patch(`/api/patients/${a.body.id}`).send({ phone: '912 345 678' }).expect(409);
    const same = await recep.patch(`/api/patients/${a.body.id}`).send({ phone: '+51987654321', notes: '' }).expect(200);
    expect(same.body.notes).toBeNull();
  });

  it('no ve ni edita pacientes de otro consultorio; superadmin no entra', async () => {
    expect((await recep.get('/api/patients').expect(200)).body).toEqual([]);
    await recep.get(`/api/patients/${patientB}`).expect(404);
    await recep.patch(`/api/patients/${patientB}`).send({ fullName: 'Hack' }).expect(404);
    const root = await loginAs('root@x.com');
    await root.get('/api/patients').expect(403);
  });
});
```

Run: `npm run test:e2e -w @recep/api -- patients`
Expected: FAIL (404 en `/api/patients`).

- [ ] **Step 2: Implementación**

`apps/api/src/patients/patients.dto.ts`:
```ts
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreatePatientDto {
  @IsString() @Length(2, 160) fullName: string;
  @IsString() @MaxLength(30) phone: string;
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdatePatientDto {
  @IsOptional() @IsString() @Length(2, 160) fullName?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class SearchPatientsDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
```

`apps/api/src/patients/patients.service.ts`:
```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { normalizePhone } from '../common/phone';
import { Patient } from './patient.entity';
import { CreatePatientDto, UpdatePatientDto } from './patients.dto';

export interface PatientDto {
  id: string;
  fullName: string;
  phone: string;
  whatsappOptIn: boolean;
  optInAt: string | null;
  notes: string | null;
}

export const toPatientDto = (p: Patient): PatientDto => ({
  id: p.id,
  fullName: p.fullName,
  phone: p.phoneE164,
  whatsappOptIn: p.whatsappOptIn,
  optInAt: p.optInAt ? p.optInAt.toISOString() : null,
  notes: p.notes,
});

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class PatientsService {
  constructor(@InjectRepository(Patient) private readonly patients: Repository<Patient>) {}

  async search(clinicId: string, q?: string): Promise<PatientDto[]> {
    const qb = this.patients.createQueryBuilder('p').where('p.clinic_id = :clinicId', { clinicId });
    const text = q?.trim();
    if (text) {
      const digits = text.replace(/\D/g, '');
      const params = { name: `%${escapeLike(text)}%`, digits: `%${digits}%` };
      qb.andWhere(
        digits.length >= 3 ? '(p.full_name ILIKE :name OR p.phone_e164 LIKE :digits)' : 'p.full_name ILIKE :name',
        params,
      );
    }
    const rows = await qb.orderBy('p.full_name', 'ASC').limit(50).getMany();
    return rows.map(toPatientDto);
  }

  async get(clinicId: string, id: string): Promise<PatientDto> {
    return toPatientDto(await this.findInClinic(clinicId, id));
  }

  async create(clinicId: string, dto: CreatePatientDto): Promise<PatientDto> {
    const phone = this.parsePhone(dto.phone);
    await this.assertPhoneFree(clinicId, phone);
    const optIn = dto.whatsappOptIn ?? false;
    const patient = this.patients.create({
      clinicId,
      fullName: dto.fullName.trim(),
      phoneE164: phone,
      whatsappOptIn: optIn,
      optInAt: optIn ? new Date() : null,
      notes: dto.notes?.trim() || null,
    });
    return toPatientDto(await this.patients.save(patient));
  }

  async update(clinicId: string, id: string, dto: UpdatePatientDto): Promise<PatientDto> {
    const patient = await this.findInClinic(clinicId, id);
    if (dto.fullName !== undefined) patient.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) {
      const phone = this.parsePhone(dto.phone);
      await this.assertPhoneFree(clinicId, phone, patient.id);
      patient.phoneE164 = phone;
    }
    if (dto.whatsappOptIn !== undefined && dto.whatsappOptIn !== patient.whatsappOptIn) {
      patient.whatsappOptIn = dto.whatsappOptIn;
      patient.optInAt = dto.whatsappOptIn ? new Date() : null;
    }
    if (dto.notes !== undefined) patient.notes = dto.notes.trim() || null;
    return toPatientDto(await this.patients.save(patient));
  }

  async findInClinic(clinicId: string, id: string): Promise<Patient> {
    const patient = await this.patients.findOne({ where: { id, clinicId } });
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    return patient;
  }

  private parsePhone(input: string): string {
    const phone = normalizePhone(input);
    if (!phone) throw new BadRequestException('Teléfono inválido');
    return phone;
  }

  private async assertPhoneFree(clinicId: string, phone: string, exceptId?: string): Promise<void> {
    const taken = await this.patients.findOne({
      where: { clinicId, phoneE164: phone, ...(exceptId ? { id: Not(exceptId) } : {}) },
    });
    if (taken) throw new ConflictException('Ya existe un paciente con ese teléfono');
  }
}
```

`apps/api/src/patients/patients.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { Role } from '../users/role.enum';
import { CreatePatientDto, SearchPatientsDto, UpdatePatientDto } from './patients.dto';
import { PatientDto, PatientsService } from './patients.service';

@Roles(Role.OWNER, Role.RECEPTION)
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  search(@CurrentUser() me: AuthUser, @Query() query: SearchPatientsDto): Promise<PatientDto[]> {
    return this.patients.search(me.clinicId!, query.q);
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PatientDto> {
    return this.patients.get(me.clinicId!, id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreatePatientDto): Promise<PatientDto> {
    return this.patients.create(me.clinicId!, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
  ): Promise<PatientDto> {
    return this.patients.update(me.clinicId!, id, dto);
  }
}
```

`apps/api/src/patients/patients.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Patient } from './patient.entity';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  imports: [TypeOrmModule.forFeature([Patient])],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
```

En `apps/api/src/app.module.ts`: `import { PatientsModule } from './patients/patients.module';` y agregar `PatientsModule` al final de `imports`.

- [ ] **Step 3: Tests pasan**

Run: `npm run test:e2e -w @recep/api`
Expected: PASS (todas; `patients` con 6 tests).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add patients with phone normalization, search and consent"
```

---

### Task 6: Citas y bloqueos (crear, listar, editar, cambiar estado, historial)

**Files:**
- Create: `apps/api/src/appointments/appointment-status.ts` (+ `appointment-status.spec.ts`)
- Create: `apps/api/src/appointments/appointments.dto.ts`, `appointments.service.ts`, `appointments.controller.ts`, `appointments.module.ts`
- Modify: `apps/api/src/common/all-exceptions.filter.ts` (23P01 → 409)
- Modify: `apps/api/src/app.module.ts` (importar `AppointmentsModule`)
- Test: `apps/api/test/appointments.e2e-spec.ts`

**Interfaces:**
- Consumes:
  - `zonedToUtc`, `addDays`, `daysBetween`, `DATE_RE`, `TIME_RE`
  - `ClinicSettingsService.getTimezone`
  - `ServicesService.findInClinic`
  - `PatientsService.findInClinic`, `toPatientDto`
  - Entidades `Appointment` y `AppointmentEvent` con sus enums
- Produces:
  - `canTransition(from: AppointmentStatus, to: AppointmentStatus, isBlock: boolean): boolean`
  - `AppointmentDto { id; startsAt; endsAt; status; isBlock; patient: { id; fullName; phone } | null; service: { id; name; durationMin } | null }`
  - Rutas (OWNER, RECEPTION):
    - `GET /api/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD` → `AppointmentDto[]` (rango inclusivo en la zona del consultorio, máximo 31 días)
    - `POST /api/appointments` `{ patientId, serviceId, date, time }` → 201
    - `POST /api/appointments/blocks` `{ date, time, endTime }` → 201
    - `PATCH /api/appointments/:id` `{ date, time, serviceId }` → `AppointmentDto`
    - `POST /api/appointments/:id/status` `{ status: CONFIRMED | CANCELLED | ATTENDED | NO_SHOW }` → `AppointmentDto` (código 200)
    - `GET /api/patients/:id/appointments` → `AppointmentDto[]` (más recientes primero, máximo 100)

- [ ] **Step 1: Test unitario de transiciones (falla)**

`apps/api/src/appointments/appointment-status.spec.ts`:
```ts
import { AppointmentStatus as S } from './appointment.entity';
import { canTransition } from './appointment-status';

describe('canTransition', () => {
  it('cita programada puede confirmarse, cancelarse, asistir o no asistir', () => {
    for (const to of [S.CONFIRMED, S.CANCELLED, S.ATTENDED, S.NO_SHOW]) expect(canTransition(S.SCHEDULED, to, false)).toBe(true);
  });
  it('confirmada no vuelve a confirmarse', () => {
    expect(canTransition(S.CONFIRMED, S.CONFIRMED, false)).toBe(false);
    expect(canTransition(S.CONFIRMED, S.ATTENDED, false)).toBe(true);
  });
  it('asistió/no asistió se pueden corregir entre sí', () => {
    expect(canTransition(S.ATTENDED, S.NO_SHOW, false)).toBe(true);
    expect(canTransition(S.NO_SHOW, S.ATTENDED, false)).toBe(true);
    expect(canTransition(S.ATTENDED, S.CANCELLED, false)).toBe(false);
  });
  it('cancelada es final', () => {
    for (const to of [S.SCHEDULED, S.CONFIRMED, S.ATTENDED, S.NO_SHOW]) expect(canTransition(S.CANCELLED, to, false)).toBe(false);
  });
  it('un bloqueo solo se puede cancelar', () => {
    expect(canTransition(S.SCHEDULED, S.CANCELLED, true)).toBe(true);
    expect(canTransition(S.SCHEDULED, S.CONFIRMED, true)).toBe(false);
    expect(canTransition(S.SCHEDULED, S.ATTENDED, true)).toBe(false);
  });
});
```

Run: `npm test -w @recep/api`
Expected: FAIL, "Cannot find module './appointment-status'".

- [ ] **Step 2: Implementar transiciones**

`apps/api/src/appointments/appointment-status.ts`:
```ts
import { AppointmentStatus as S } from './appointment.entity';

const ALLOWED: Record<S, S[]> = {
  [S.SCHEDULED]: [S.CONFIRMED, S.CANCELLED, S.ATTENDED, S.NO_SHOW],
  [S.CONFIRMED]: [S.CANCELLED, S.ATTENDED, S.NO_SHOW],
  [S.ATTENDED]: [S.NO_SHOW],
  [S.NO_SHOW]: [S.ATTENDED],
  [S.CANCELLED]: [],
};

export function canTransition(from: S, to: S, isBlock: boolean): boolean {
  if (isBlock) return from === S.SCHEDULED && to === S.CANCELLED;
  return ALLOWED[from].includes(to);
}
```

Run: `npm test -w @recep/api`
Expected: PASS.

- [ ] **Step 3: Test e2e de citas (falla)**

`apps/api/test/appointments.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedPatient, seedService, seedUser } from './utils';

describe('appointments', () => {
  let app: INestApplication;
  let ds: DataSource;
  let recep: ReturnType<typeof request.agent>;
  let patientA: string;
  let serviceA: string;
  let patientB: string;
  let serviceB: string;

  const loginAs = async (email: string): Promise<ReturnType<typeof request.agent>> => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: 'secreta123' }).expect(200);
    return agent;
  };
  const book = (time: string, date = '2026-10-06', extra: Record<string, unknown> = {}) =>
    recep.post('/api/appointments').send({ patientId: patientA, serviceId: serviceA, date, time, ...extra });

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDb(app);
    const a = await seedClinic(app, 'A');
    const b = await seedClinic(app, 'B');
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId: a.id });
    await seedUser(app, { email: 'owner@b.com', password: 'secreta123', role: Role.OWNER, clinicId: b.id });
    await seedUser(app, { email: 'root@x.com', password: 'secreta123', role: Role.SUPERADMIN });
    patientA = (await seedPatient(app, a.id, { fullName: 'Juan Pérez' })).id;
    serviceA = (await seedService(app, a.id, 'Limpieza', 30)).id;
    patientB = (await seedPatient(app, b.id)).id;
    serviceB = (await seedService(app, b.id)).id;
    recep = await loginAs('recep@a.com');
  });
  afterAll(async () => { await app.close(); });

  it('crea una cita en hora de Lima, calcula el fin y registra el evento', async () => {
    const res = await book('09:30').expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      startsAt: '2026-10-06T14:30:00.000Z',
      endsAt: '2026-10-06T15:00:00.000Z',
      status: 'SCHEDULED',
      isBlock: false,
      patient: { id: patientA, fullName: 'Juan Pérez', phone: '+51987654321' },
      service: { id: serviceA, name: 'Limpieza', durationMin: 30 },
    });
    const [row] = await ds.query('SELECT calendar_dirty, created_by FROM appointments WHERE id = $1', [res.body.id]);
    expect(row.calendar_dirty).toBe(true);
    expect(row.created_by).toEqual(expect.any(String));
    const events = await ds.query('SELECT type, source, actor_user_id FROM appointment_events WHERE appointment_id = $1', [res.body.id]);
    expect(events).toEqual([{ type: 'CREATED', source: 'PANEL', actor_user_id: row.created_by }]);
  });

  it('impide citas que se cruzan (409) y permite las pegadas', async () => {
    await book('09:30').expect(201);
    const clash = await book('09:45').expect(409);
    expect(clash.body.message).toBe('Horario ocupado: ya hay otra cita en ese horario');
    await book('10:00').expect(201);
  });

  it('un bloqueo ocupa el horario y valida que el fin sea posterior', async () => {
    const block = await recep.post('/api/appointments/blocks').send({ date: '2026-10-06', time: '13:00', endTime: '14:00' }).expect(201);
    expect(block.body).toEqual(expect.objectContaining({ isBlock: true, patient: null, service: null }));
    await book('13:30').expect(409);
    await recep.post('/api/appointments/blocks').send({ date: '2026-10-06', time: '15:00', endTime: '15:00' }).expect(400);
  });

  it('lista por rango de fechas en hora local: una cita a las 23:30 cae en su día', async () => {
    await book('23:30', '2026-10-06').expect(201);
    await book('08:00', '2026-10-07').expect(201);
    const day6 = await recep.get('/api/appointments').query({ from: '2026-10-06', to: '2026-10-06' }).expect(200);
    expect(day6.body.map((a: { startsAt: string }) => a.startsAt)).toEqual(['2026-10-07T04:30:00.000Z']);
    const day7 = await recep.get('/api/appointments').query({ from: '2026-10-07', to: '2026-10-07' }).expect(200);
    expect(day7.body.map((a: { startsAt: string }) => a.startsAt)).toEqual(['2026-10-07T13:00:00.000Z']);
    const week = await recep.get('/api/appointments').query({ from: '2026-10-05', to: '2026-10-11' }).expect(200);
    expect(week.body).toHaveLength(2);
  });

  it('valida el rango de fechas', async () => {
    await recep.get('/api/appointments').query({ from: '2026-10-07', to: '2026-10-06' }).expect(400);
    await recep.get('/api/appointments').query({ from: '2026-10-01', to: '2026-11-15' }).expect(400);
    await recep.get('/api/appointments').query({ from: '2026-02-30', to: '2026-03-01' }).expect(400);
    await recep.get('/api/appointments').expect(400);
  });

  it('reprogramar mueve la cita, vuelve a SCHEDULED y registra RESCHEDULED', async () => {
    const appt = await book('09:30').expect(201);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CONFIRMED' }).expect(200);
    const moved = await recep.patch(`/api/appointments/${appt.body.id}`).send({ date: '2026-10-08', time: '11:00', serviceId: serviceA }).expect(200);
    expect(moved.body).toEqual(expect.objectContaining({ startsAt: '2026-10-08T16:00:00.000Z', status: 'SCHEDULED' }));
    const types = await ds.query('SELECT type FROM appointment_events WHERE appointment_id = $1 ORDER BY created_at', [appt.body.id]);
    expect(types.map((t: { type: string }) => t.type)).toEqual(['CREATED', 'CONFIRMED', 'RESCHEDULED']);
  });

  it('mover una cita encima de otra da 409 y la deja intacta', async () => {
    await book('09:30').expect(201);
    const other = await book('11:00').expect(201);
    await recep.post(`/api/appointments/${other.body.id}/status`).send({ status: 'CONFIRMED' }).expect(200);
    await recep.patch(`/api/appointments/${other.body.id}`).send({ date: '2026-10-06', time: '09:30', serviceId: serviceA }).expect(409);
    const day = await recep.get('/api/appointments').query({ from: '2026-10-06', to: '2026-10-06' }).expect(200);
    const kept = day.body.find((a: { id: string }) => a.id === other.body.id);
    expect(kept).toEqual(expect.objectContaining({ startsAt: '2026-10-06T16:00:00.000Z', status: 'CONFIRMED' }));
  });

  it('cancelar libera el horario; una cancelada no cambia de estado', async () => {
    const appt = await book('09:30').expect(201);
    const cancelled = await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CANCELLED' }).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    await book('09:30').expect(201);
    const bad = await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CONFIRMED' }).expect(400);
    expect(bad.body.message).toBe('No se puede pasar de CANCELLED a CONFIRMED');
    await recep.patch(`/api/appointments/${appt.body.id}`).send({ date: '2026-10-09', time: '09:30', serviceId: serviceA }).expect(400);
  });

  it('asistió y no asistió se pueden corregir; un bloqueo no se confirma', async () => {
    const appt = await book('09:30').expect(201);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'NO_SHOW' }).expect(200);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'ATTENDED' }).expect(200);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'SCHEDULED' }).expect(400);
    const block = await recep.post('/api/appointments/blocks').send({ date: '2026-10-06', time: '13:00', endTime: '14:00' }).expect(201);
    await recep.post(`/api/appointments/${block.body.id}/status`).send({ status: 'CONFIRMED' }).expect(400);
    await recep.post(`/api/appointments/${block.body.id}/status`).send({ status: 'CANCELLED' }).expect(200);
  });

  it('servicio inactivo da 400; paciente o servicio de otro consultorio da 404', async () => {
    await ds.query('UPDATE services SET active = false WHERE id = $1', [serviceA]);
    await book('09:30').expect(400);
    await ds.query('UPDATE services SET active = true WHERE id = $1', [serviceA]);
    await book('09:30', '2026-10-06', { patientId: patientB }).expect(404);
    await book('09:30', '2026-10-06', { serviceId: serviceB }).expect(404);
  });

  it('otro consultorio no ve ni modifica las citas; superadmin no entra', async () => {
    const appt = await book('09:30').expect(201);
    const ownerB = await loginAs('owner@b.com');
    expect((await ownerB.get('/api/appointments').query({ from: '2026-10-06', to: '2026-10-06' }).expect(200)).body).toEqual([]);
    await ownerB.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CANCELLED' }).expect(404);
    await ownerB.patch(`/api/appointments/${appt.body.id}`).send({ date: '2026-10-06', time: '10:00', serviceId: serviceB }).expect(404);
    await ownerB.get(`/api/patients/${patientA}/appointments`).expect(404);
    const root = await loginAs('root@x.com');
    await root.get('/api/appointments').query({ from: '2026-10-06', to: '2026-10-06' }).expect(403);
  });

  it('historial del paciente: más recientes primero', async () => {
    await book('09:30', '2026-10-06').expect(201);
    await book('09:30', '2026-10-08').expect(201);
    const res = await recep.get(`/api/patients/${patientA}/appointments`).expect(200);
    expect(res.body.map((a: { startsAt: string }) => a.startsAt)).toEqual(['2026-10-08T14:30:00.000Z', '2026-10-06T14:30:00.000Z']);
  });
});
```

Run: `npm run test:e2e -w @recep/api -- appointments`
Expected: FAIL (404 en `/api/appointments`).

- [ ] **Step 4: 23P01 en el filtro de excepciones**

En `apps/api/src/common/all-exceptions.filter.ts`, justo antes del bloque `if (exception instanceof QueryFailedError && ... '23505')`, agregar:
```ts
    if (exception instanceof QueryFailedError && (exception as QueryFailedError & { code?: string }).code === '23P01') {
      res.status(409).json({ statusCode: 409, message: 'Horario ocupado: ya hay otra cita en ese horario', error: 'CONFLICT' });
      return;
    }
```

- [ ] **Step 5: DTOs, servicio, controladores y módulo**

`apps/api/src/appointments/appointments.dto.ts`:
```ts
import { IsDateString, IsIn, IsUUID, Matches } from 'class-validator';
import { DATE_RE, TIME_RE } from '../common/zoned-time';
import { AppointmentStatus } from './appointment.entity';

const DATE_MSG = { message: 'La fecha debe tener formato AAAA-MM-DD' };
const TIME_MSG = { message: 'La hora debe tener formato HH:MM' };

export class ListAppointmentsDto {
  @Matches(DATE_RE, DATE_MSG) @IsDateString({ strict: true }, DATE_MSG) from: string;
  @Matches(DATE_RE, DATE_MSG) @IsDateString({ strict: true }, DATE_MSG) to: string;
}

export class CreateAppointmentDto {
  @IsUUID() patientId: string;
  @IsUUID() serviceId: string;
  @Matches(DATE_RE, DATE_MSG) @IsDateString({ strict: true }, DATE_MSG) date: string;
  @Matches(TIME_RE, TIME_MSG) time: string;
}

export class CreateBlockDto {
  @Matches(DATE_RE, DATE_MSG) @IsDateString({ strict: true }, DATE_MSG) date: string;
  @Matches(TIME_RE, TIME_MSG) time: string;
  @Matches(TIME_RE, TIME_MSG) endTime: string;
}

export class UpdateAppointmentDto {
  @Matches(DATE_RE, DATE_MSG) @IsDateString({ strict: true }, DATE_MSG) date: string;
  @Matches(TIME_RE, TIME_MSG) time: string;
  @IsUUID() serviceId: string;
}

export const SETTABLE_STATUSES = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CANCELLED,
  AppointmentStatus.ATTENDED,
  AppointmentStatus.NO_SHOW,
] as const;

export class SetStatusDto {
  @IsIn(SETTABLE_STATUSES, { message: 'Estado inválido' }) status: (typeof SETTABLE_STATUSES)[number];
}
```

`apps/api/src/appointments/appointments.service.ts`:
```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/session';
import { ClinicSettingsService } from '../clinics/clinic-settings.service';
import { addDays, daysBetween, zonedToUtc } from '../common/zoned-time';
import { PatientsService } from '../patients/patients.service';
import { ServicesService } from '../services/services.service';
import { AppointmentEvent, AppointmentEventType, EventSource } from './appointment-event.entity';
import { canTransition } from './appointment-status';
import { Appointment, AppointmentStatus } from './appointment.entity';
import { CreateAppointmentDto, CreateBlockDto, SetStatusDto, UpdateAppointmentDto } from './appointments.dto';

export interface AppointmentDto {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  isBlock: boolean;
  patient: { id: string; fullName: string; phone: string } | null;
  service: { id: string; name: string; durationMin: number } | null;
}

const toDto = (a: Appointment): AppointmentDto => ({
  id: a.id,
  startsAt: a.startsAt.toISOString(),
  endsAt: a.endsAt.toISOString(),
  status: a.status,
  isBlock: a.isBlock,
  patient: a.patient ? { id: a.patient.id, fullName: a.patient.fullName, phone: a.patient.phoneE164 } : null,
  service: a.service ? { id: a.service.id, name: a.service.name, durationMin: a.service.durationMin } : null,
});

const MAX_RANGE_DAYS = 31;

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: ClinicSettingsService,
    private readonly services: ServicesService,
    private readonly patients: PatientsService,
  ) {}

  async list(clinicId: string, from: string, to: string): Promise<AppointmentDto[]> {
    const span = daysBetween(from, to);
    if (span < 0) throw new BadRequestException('La fecha "hasta" debe ser igual o posterior a "desde"');
    if (span > MAX_RANGE_DAYS) throw new BadRequestException(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
    const tz = await this.settings.getTimezone(clinicId);
    const start = zonedToUtc(from, '00:00', tz);
    const end = zonedToUtc(addDays(to, 1), '00:00', tz);
    const rows = await this.ds.getRepository(Appointment).find({
      where: { clinicId, startsAt: Between(start, new Date(end.getTime() - 1)) },
      relations: { patient: true, service: true },
      order: { startsAt: 'ASC' },
    });
    return rows.map(toDto);
  }

  async forPatient(clinicId: string, patientId: string): Promise<AppointmentDto[]> {
    await this.patients.findInClinic(clinicId, patientId);
    const rows = await this.ds.getRepository(Appointment).find({
      where: { clinicId, patientId },
      relations: { patient: true, service: true },
      order: { startsAt: 'DESC' },
      take: 100,
    });
    return rows.map(toDto);
  }

  async create(user: AuthUser, dto: CreateAppointmentDto): Promise<AppointmentDto> {
    const clinicId = user.clinicId!;
    await this.patients.findInClinic(clinicId, dto.patientId);
    const service = await this.services.findInClinic(clinicId, dto.serviceId);
    if (!service.active) throw new BadRequestException('El servicio está desactivado');
    const startsAt = zonedToUtc(dto.date, dto.time, await this.settings.getTimezone(clinicId));
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
    const id = await this.ds.transaction(async (m) => {
      const appt = await m.save(
        m.create(Appointment, {
          clinicId, patientId: dto.patientId, serviceId: service.id, startsAt, endsAt, createdBy: user.id, calendarDirty: true,
        }),
      );
      await this.logEvent(m, appt, user, AppointmentEventType.CREATED);
      return appt.id;
    });
    return this.getDto(clinicId, id);
  }

  async createBlock(user: AuthUser, dto: CreateBlockDto): Promise<AppointmentDto> {
    if (dto.endTime <= dto.time) throw new BadRequestException('La hora de fin debe ser posterior a la de inicio');
    const clinicId = user.clinicId!;
    const tz = await this.settings.getTimezone(clinicId);
    const id = await this.ds.transaction(async (m) => {
      const appt = await m.save(
        m.create(Appointment, {
          clinicId,
          isBlock: true,
          patientId: null,
          serviceId: null,
          startsAt: zonedToUtc(dto.date, dto.time, tz),
          endsAt: zonedToUtc(dto.date, dto.endTime, tz),
          createdBy: user.id,
          calendarDirty: true,
        }),
      );
      await this.logEvent(m, appt, user, AppointmentEventType.CREATED, { block: true });
      return appt.id;
    });
    return this.getDto(clinicId, id);
  }

  async update(user: AuthUser, id: string, dto: UpdateAppointmentDto): Promise<AppointmentDto> {
    const clinicId = user.clinicId!;
    const appt = await this.findInClinic(clinicId, id);
    if (appt.isBlock) throw new BadRequestException('Los bloqueos no se editan; elimínalo y crea otro');
    if (appt.status !== AppointmentStatus.SCHEDULED && appt.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException('Solo se pueden editar citas programadas o confirmadas');
    }
    const service = await this.services.findInClinic(clinicId, dto.serviceId);
    if (!service.active && service.id !== appt.serviceId) throw new BadRequestException('El servicio está desactivado');
    const startsAt = zonedToUtc(dto.date, dto.time, await this.settings.getTimezone(clinicId));
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
    const moved = startsAt.getTime() !== appt.startsAt.getTime();
    const before = { startsAt: appt.startsAt.toISOString(), serviceId: appt.serviceId };

    await this.ds.transaction(async (m) => {
      await m.update(Appointment, { id }, {
        startsAt,
        endsAt,
        serviceId: service.id,
        status: moved ? AppointmentStatus.SCHEDULED : appt.status,
        calendarDirty: true,
      });
      await this.logEvent(m, appt, user, moved ? AppointmentEventType.RESCHEDULED : AppointmentEventType.UPDATED, {
        from: before,
        to: { startsAt: startsAt.toISOString(), serviceId: service.id },
      });
    });
    return this.getDto(clinicId, id);
  }

  async setStatus(user: AuthUser, id: string, dto: SetStatusDto): Promise<AppointmentDto> {
    const clinicId = user.clinicId!;
    const appt = await this.findInClinic(clinicId, id);
    const to = dto.status as AppointmentStatus;
    if (!canTransition(appt.status, to, appt.isBlock)) {
      throw new BadRequestException(`No se puede pasar de ${appt.status} a ${to}`);
    }
    await this.ds.transaction(async (m) => {
      await m.update(Appointment, { id }, { status: to, calendarDirty: true });
      await this.logEvent(m, appt, user, to as unknown as AppointmentEventType, { from: appt.status });
    });
    return this.getDto(clinicId, id);
  }

  private async findInClinic(clinicId: string, id: string): Promise<Appointment> {
    const appt = await this.ds.getRepository(Appointment).findOne({ where: { id, clinicId } });
    if (!appt) throw new NotFoundException('Cita no encontrada');
    return appt;
  }

  private async getDto(clinicId: string, id: string): Promise<AppointmentDto> {
    const appt = await this.ds.getRepository(Appointment).findOneOrFail({
      where: { id, clinicId },
      relations: { patient: true, service: true },
    });
    return toDto(appt);
  }

  private async logEvent(
    m: EntityManager,
    appt: Appointment,
    user: AuthUser,
    type: AppointmentEventType,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await m.save(
      m.create(AppointmentEvent, {
        appointmentId: appt.id, clinicId: appt.clinicId, type, source: EventSource.PANEL, actorUserId: user.id, data,
      }),
    );
  }
}
```

`apps/api/src/appointments/appointments.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { Role } from '../users/role.enum';
import {
  CreateAppointmentDto, CreateBlockDto, ListAppointmentsDto, SetStatusDto, UpdateAppointmentDto,
} from './appointments.dto';
import { AppointmentDto, AppointmentsService } from './appointments.service';

@Roles(Role.OWNER, Role.RECEPTION)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  list(@CurrentUser() me: AuthUser, @Query() q: ListAppointmentsDto): Promise<AppointmentDto[]> {
    return this.appointments.list(me.clinicId!, q.from, q.to);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateAppointmentDto): Promise<AppointmentDto> {
    return this.appointments.create(me, dto);
  }

  @Post('blocks')
  createBlock(@CurrentUser() me: AuthUser, @Body() dto: CreateBlockDto): Promise<AppointmentDto> {
    return this.appointments.createBlock(me, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
  ): Promise<AppointmentDto> {
    return this.appointments.update(me, id, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  setStatus(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStatusDto,
  ): Promise<AppointmentDto> {
    return this.appointments.setStatus(me, id, dto);
  }
}

@Roles(Role.OWNER, Role.RECEPTION)
@Controller('patients')
export class PatientAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get(':id/appointments')
  forPatient(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<AppointmentDto[]> {
    return this.appointments.forPatient(me.clinicId!, id);
  }
}
```

`apps/api/src/appointments/appointments.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ClinicsModule } from '../clinics/clinics.module';
import { PatientsModule } from '../patients/patients.module';
import { ServicesModule } from '../services/services.module';
import { AppointmentsController, PatientAppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [ClinicsModule, ServicesModule, PatientsModule],
  controllers: [AppointmentsController, PatientAppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
```

En `apps/api/src/app.module.ts`: `import { AppointmentsModule } from './appointments/appointments.module';` y agregar `AppointmentsModule` al final de `imports`.

- [ ] **Step 6: Tests pasan y build**

Run: `npm run test:api`
Expected: PASS (unit: invite-token, zoned-time, phone, appointment-status; e2e: todas, `appointments` con 12 tests).

Run: `npm run build -w @recep/api`
Expected: compila.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): add appointments and blocks with overlap protection and history"
```

---

### Task 7: Panel — navegación común y configuración del consultorio

**Files:**
- Modify: `apps/web/src/lib/types.ts` (tipos de agenda), `apps/web/src/lib/use-me.ts` (`useClinicMe`)
- Create: `apps/web/src/lib/format.ts`, `apps/web/src/components/app-header.tsx`, `apps/web/src/app/app/settings/page.tsx`
- Modify: `apps/web/src/app/app/users/page.tsx` (encabezado → `AppHeader`)

**Interfaces:**
- Consumes: `GET/PATCH /api/clinic`, `GET/PUT /api/clinic/hours`, `GET/POST/PATCH /api/services`.
- Produces:
  - Tipos: `ClinicSettings`, `BusinessHour`, `Service`, `Patient`, `AppointmentStatus`, `Appointment`.
  - `useClinicMe(): Me | null` (redirige al superadmin a `/admin`).
  - `<AppHeader me={me} />`.
  - En `lib/format.ts`:
    - `fmtTime(iso, tz)`, `localDate(iso, tz)`, `todayIn(tz)`
    - `addDays(date, n)`, `startOfWeek(date)`, `fmtDayHeader(date)`
    - `WEEKDAYS`, `STATUS_LABEL`, `STATUS_CLASS`

- [ ] **Step 1: Tipos, formato, hook y encabezado**

Agregar al final de `apps/web/src/lib/types.ts`:
```ts
export interface ClinicSettings {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  paymentInstructions: string | null;
  send2hToConfirmed: boolean;
  subscriptionStatus: string;
  paidUntil: string | null;
}

export interface BusinessHour {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  active: boolean;
}

export interface Patient {
  id: string;
  fullName: string;
  phone: string;
  whatsappOptIn: boolean;
  optInAt: string | null;
  notes: string | null;
}

export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED' | 'NO_SHOW';

export interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  isBlock: boolean;
  patient: { id: string; fullName: string; phone: string } | null;
  service: { id: string; name: string; durationMin: number } | null;
}
```

`apps/web/src/lib/format.ts`:
```ts
import type { AppointmentStatus } from './types';

export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Programada',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  ATTENDED: 'Asistió',
  NO_SHOW: 'No asistió',
};

export const STATUS_CLASS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-200 text-slate-500 line-through',
  ATTENDED: 'bg-blue-100 text-blue-800',
  NO_SHOW: 'bg-red-100 text-red-800',
};

export function fmtTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-PE', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/** Fecha local YYYY-MM-DD del instante `iso` en la zona `timeZone`. */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function todayIn(timeZone: string): string {
  return localDate(new Date().toISOString(), timeZone);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Lunes de la semana que contiene `date`. */
export function startOfWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function fmtDayHeader(date: string): string {
  return new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
```

En `apps/web/src/lib/use-me.ts`, agregar al final:
```ts
/** Para páginas del consultorio: redirige al superadmin a /admin. */
export function useClinicMe(): Me | null {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me?.role === 'SUPERADMIN') router.replace('/admin');
  }, [me, router]);
  return me && me.clinic ? me : null;
}
```

`apps/web/src/components/app-header.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoutButton } from '@/components/logout-button';
import type { Me } from '@/lib/types';

export function AppHeader({ me }: { me: Me }) {
  const pathname = usePathname();
  const links = [
    { href: '/app', label: 'Agenda' },
    { href: '/app/patients', label: 'Pacientes' },
    ...(me.role === 'OWNER'
      ? [
          { href: '/app/settings', label: 'Configuración' },
          { href: '/app/users', label: 'Usuarios' },
        ]
      : []),
  ];
  const isActive = (href: string) => (href === '/app' ? pathname === '/app' : pathname.startsWith(href));

  return (
    <header className="space-y-3 border-b pb-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-bold">{me.clinic?.name}</p>
          <p className="text-xs text-slate-500">{me.name}</p>
        </div>
        <LogoutButton />
      </div>
      {me.clinic && me.clinic.subscriptionStatus !== 'ACTIVE' && (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
          Tu suscripción está vencida. Comunícate con soporte para evitar que se detengan los recordatorios.
        </p>
      )}
      <nav className="flex flex-wrap gap-2 text-sm">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded px-3 py-1 ${isActive(l.href) ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700 border'}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
```

En `apps/web/src/app/app/users/page.tsx`:
- Reemplazar el bloque `<header className="flex items-center justify-between"> … </header>` (el que tiene el título "Usuarios" y el enlace "Volver") por:
  ```tsx
  <AppHeader me={me} />
  <h1 className="text-xl font-bold">Usuarios</h1>
  ```
- Agregar `import { AppHeader } from '@/components/app-header';`.
- Quitar `import Link from 'next/link';`, que ya no se usa.

- [ ] **Step 2: Página de configuración**

`apps/web/src/app/app/settings/page.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { WEEKDAYS } from '@/lib/format';
import type { BusinessHour, ClinicSettings, Service } from '@/lib/types';
import { useClinicMe } from '@/lib/use-me';

function ClinicDataCard({ settings, onSaved }: { settings: ClinicSettings; onSaved: (s: ClinicSettings) => void }) {
  const [msg, setMsg] = useState('');
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setMsg('');
    try {
      const saved = await api<ClinicSettings>('/clinic', {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.get('name'),
          address: form.get('address'),
          paymentInstructions: form.get('paymentInstructions'),
          send2hToConfirmed: form.get('send2hToConfirmed') === 'on',
        }),
      });
      onSaved(saved);
      setMsg('Guardado');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Datos del consultorio</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" name="name" defaultValue={settings.name} required minLength={2} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="address">Dirección (se envía en el recordatorio de 2 h)</Label>
            <Input id="address" name="address" defaultValue={settings.address ?? ''} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="paymentInstructions">Instrucciones de pago (número Yape, link…)</Label>
            <textarea
              id="paymentInstructions"
              name="paymentInstructions"
              defaultValue={settings.paymentInstructions ?? ''}
              rows={3}
              maxLength={500}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="send2hToConfirmed" defaultChecked={settings.send2hToConfirmed} />
            Enviar el recordatorio de 2 h también a quienes ya confirmaron
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit">Guardar</Button>
            {msg && <span className="text-sm text-slate-600">{msg}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function HoursCard() {
  const [rows, setRows] = useState<BusinessHour[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<BusinessHour[]>('/clinic/hours').then(setRows);
  }, []);

  const update = (i: number, patch: Partial<BusinessHour>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setMsg('');
    try {
      setRows(await api<BusinessHour[]>('/clinic/hours', { method: 'PUT', body: JSON.stringify({ hours: rows }) }));
      setMsg('Guardado');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Horario de atención</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              value={r.weekday}
              onChange={(e) => update(i, { weekday: Number(e.target.value) })}
              className="rounded-md border px-2 py-1 text-sm"
            >
              {WEEKDAYS.map((d, n) => <option key={n} value={n}>{d}</option>)}
            </select>
            <Input type="time" value={r.opensAt} onChange={(e) => update(i, { opensAt: e.target.value })} className="w-32" />
            <span className="text-sm">a</span>
            <Input type="time" value={r.closesAt} onChange={(e) => update(i, { closesAt: e.target.value })} className="w-32" />
            <Button type="button" size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Quitar</Button>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-500">Sin horario configurado.</p>}
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => setRows([...rows, { weekday: 1, opensAt: '09:00', closesAt: '13:00' }])}>
            Agregar franja
          </Button>
          <Button type="button" onClick={save}>Guardar horario</Button>
          {msg && <span className="text-sm text-slate-600">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function ServicesCard() {
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<Service[]>('/services').then(setServices);
  }, []);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    await run(async () => {
      await api('/services', {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), durationMin: Number(form.get('durationMin')) }),
      });
      formEl.reset();
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Servicios</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded border">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
              <span className={s.active ? '' : 'text-slate-400 line-through'}>{s.name} · {s.durationMin} min</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => run(() => api(`/services/${s.id}`, { method: 'PATCH', body: JSON.stringify({ active: !s.active }) }))}
              >
                {s.active ? 'Desactivar' : 'Activar'}
              </Button>
            </li>
          ))}
          {!services.length && <li className="p-2 text-sm text-slate-500">Todavía no hay servicios.</li>}
        </ul>
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="svc-name">Nombre</Label>
            <Input id="svc-name" name="name" required minLength={2} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="svc-duration">Duración (min)</Label>
            <Input id="svc-duration" name="durationMin" type="number" min={5} max={480} step={5} defaultValue={30} className="w-28" required />
          </div>
          <Button type="submit">Agregar servicio</Button>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const me = useClinicMe();
  const router = useRouter();
  const [settings, setSettings] = useState<ClinicSettings | null>(null);

  useEffect(() => {
    if (!me) return;
    if (me.role !== 'OWNER') router.replace('/app');
    else api<ClinicSettings>('/clinic').then(setSettings);
  }, [me, router]);

  if (!me || me.role !== 'OWNER' || !settings) return <p className="p-8 text-slate-500">Cargando…</p>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <AppHeader me={me} />
      <h1 className="text-xl font-bold">Configuración</h1>
      <ClinicDataCard settings={settings} onSaved={setSettings} />
      <HoursCard />
      <ServicesCard />
    </main>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build -w @recep/web`
Expected: build exitoso con la ruta `/app/settings`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add shared clinic header and settings page (data, hours, services)"
```

---

### Task 8: Panel — pacientes (lista, búsqueda, alta y ficha)

**Files:**
- Create: `apps/web/src/app/app/patients/page.tsx`, `apps/web/src/app/app/patients/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/patients`, `GET/PATCH /api/patients/:id`, `GET /api/patients/:id/appointments`, `GET /api/clinic`, `useClinicMe`, `AppHeader`, `fmtTime`, `localDate`, `fmtDayHeader`, `STATUS_LABEL`, `STATUS_CLASS`.

- [ ] **Step 1: Lista y alta**

`apps/web/src/app/app/patients/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { Patient } from '@/lib/types';
import { useClinicMe } from '@/lib/use-me';

export default function PatientsPage() {
  const me = useClinicMe();
  const [q, setQ] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [error, setError] = useState('');

  const load = useCallback((query: string) => {
    api<Patient[]>(`/patients${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      .then(setPatients)
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (me) load('');
  }, [me, load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setError('');
    try {
      await api('/patients', {
        method: 'POST',
        body: JSON.stringify({
          fullName: form.get('fullName'),
          phone: form.get('phone'),
          whatsappOptIn: form.get('whatsappOptIn') === 'on',
          notes: form.get('notes') || undefined,
        }),
      });
      formEl.reset();
      load(q);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!me) return <p className="p-8 text-slate-500">Cargando…</p>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <AppHeader me={me} />
      <h1 className="text-xl font-bold">Pacientes</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(q);
        }}
        className="flex gap-2"
      >
        <Input placeholder="Buscar por nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="outline">Buscar</Button>
      </form>

      <ul className="divide-y rounded-lg border bg-white">
        {patients.map((p) => (
          <li key={p.id}>
            <Link href={`/app/patients/${p.id}`} className="flex items-center justify-between p-3 hover:bg-slate-50">
              <span className="font-medium">{p.fullName}</span>
              <span className="text-sm text-slate-500">
                {p.phone} {p.whatsappOptIn ? '· WhatsApp ✓' : '· sin consentimiento'}
              </span>
            </Link>
          </li>
        ))}
        {!patients.length && <li className="p-3 text-sm text-slate-500">No hay pacientes.</li>}
      </ul>

      <Card>
        <CardHeader><CardTitle className="text-base">Nuevo paciente</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fullName">Nombre completo</Label>
              <Input id="fullName" name="fullName" required minLength={2} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="phone">Celular</Label>
              <Input id="phone" name="phone" placeholder="987 654 321" required />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="notes">Notas</Label>
              <Input id="notes" name="notes" />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="whatsappOptIn" />
              El paciente acepta recibir recordatorios por WhatsApp
            </label>
            <div className="sm:col-span-2">
              <Button type="submit">Guardar paciente</Button>
            </div>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Ficha del paciente**

`apps/web/src/app/app/patients/[id]/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { fmtDayHeader, fmtTime, localDate, STATUS_CLASS, STATUS_LABEL } from '@/lib/format';
import type { Appointment, ClinicSettings, Patient } from '@/lib/types';
import { useClinicMe } from '@/lib/use-me';

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useClinicMe();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [history, setHistory] = useState<Appointment[]>([]);
  const [tz, setTz] = useState('America/Lima');
  const [msg, setMsg] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!me) return;
    api<Patient>(`/patients/${id}`).then(setPatient).catch(() => setNotFound(true));
    api<Appointment[]>(`/patients/${id}/appointments`).then(setHistory).catch(() => setHistory([]));
    api<ClinicSettings>('/clinic').then((s) => setTz(s.timezone));
  }, [me, id]);

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setMsg('');
    try {
      setPatient(
        await api<Patient>(`/patients/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: form.get('fullName'),
            phone: form.get('phone'),
            notes: form.get('notes'),
            whatsappOptIn: form.get('whatsappOptIn') === 'on',
          }),
        }),
      );
      setMsg('Guardado');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  if (!me) return <p className="p-8 text-slate-500">Cargando…</p>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <AppHeader me={me} />
      <Link href="/app/patients" className="text-sm underline">← Pacientes</Link>
      {notFound && <p className="text-sm text-red-600">Paciente no encontrado.</p>}
      {patient && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">{patient.fullName}</CardTitle></CardHeader>
            <CardContent>
              <form key={patient.id + patient.phone} onSubmit={onSave} className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="fullName">Nombre completo</Label>
                  <Input id="fullName" name="fullName" defaultValue={patient.fullName} required minLength={2} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="phone">Celular</Label>
                  <Input id="phone" name="phone" defaultValue={patient.phone} required />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="notes">Notas</Label>
                  <Input id="notes" name="notes" defaultValue={patient.notes ?? ''} />
                </div>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="whatsappOptIn" defaultChecked={patient.whatsappOptIn} />
                  Acepta recibir recordatorios por WhatsApp
                  {patient.optInAt && (
                    <span className="text-xs text-slate-500">(desde {localDate(patient.optInAt, tz)})</span>
                  )}
                </label>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <Button type="submit">Guardar</Button>
                  {msg && <span className="text-sm text-slate-600">{msg}</span>}
                </div>
              </form>
            </CardContent>
          </Card>

          <section className="space-y-2">
            <h2 className="font-semibold">Historial de citas</h2>
            <ul className="divide-y rounded-lg border bg-white">
              {history.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>
                    {fmtDayHeader(localDate(a.startsAt, tz))} · {fmtTime(a.startsAt, tz)} · {a.service?.name}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                </li>
              ))}
              {!history.length && <li className="p-3 text-sm text-slate-500">Sin citas todavía.</li>}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build -w @recep/web`
Expected: build exitoso con `/app/patients` y `/app/patients/[id]`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add patients list, creation and patient detail with history"
```

---

### Task 9: Panel — agenda de día y semana

**Files:**
- Modify (reemplazo completo): `apps/web/src/app/app/page.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/clinic`, `GET /api/services`, `GET /api/patients?q=`
  - `GET /api/appointments?from&to`, `POST /api/appointments`, `POST /api/appointments/blocks`, `PATCH /api/appointments/:id`, `POST /api/appointments/:id/status`
  - Del panel: `useClinicMe`, `AppHeader` y las utilidades de `lib/format.ts`

- [ ] **Step 1: Página de agenda**

`apps/web/src/app/app/page.tsx` (reemplaza todo el archivo):
```tsx
'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { addDays, fmtDayHeader, fmtTime, localDate, startOfWeek, STATUS_CLASS, STATUS_LABEL, todayIn } from '@/lib/format';
import type { Appointment, AppointmentStatus, ClinicSettings, Patient, Service } from '@/lib/types';
import { useClinicMe } from '@/lib/use-me';

type View = 'day' | 'week';

const NEXT_ACTIONS: Record<AppointmentStatus, { status: AppointmentStatus; label: string }[]> = {
  SCHEDULED: [
    { status: 'CONFIRMED', label: 'Confirmar' },
    { status: 'ATTENDED', label: 'Asistió' },
    { status: 'NO_SHOW', label: 'No asistió' },
  ],
  CONFIRMED: [
    { status: 'ATTENDED', label: 'Asistió' },
    { status: 'NO_SHOW', label: 'No asistió' },
  ],
  ATTENDED: [{ status: 'NO_SHOW', label: 'Marcar no asistió' }],
  NO_SHOW: [{ status: 'ATTENDED', label: 'Marcar asistió' }],
  CANCELLED: [],
};

function PatientPicker({ value, onChange }: { value: Patient | null; onChange: (p: Patient | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  if (value) {
    return (
      <div className="flex items-center justify-between rounded border p-2 text-sm">
        <span>{value.fullName} · {value.phone}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>Cambiar</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input placeholder="Nombre o teléfono del paciente" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button
          type="button"
          variant="outline"
          onClick={async () => setResults(await api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`))}
        >
          Buscar
        </Button>
      </div>
      {results.map((p) => (
        <button
          type="button"
          key={p.id}
          className="block w-full rounded border p-2 text-left text-sm hover:bg-slate-50"
          onClick={() => {
            onChange(p);
            setResults([]);
          }}
        >
          {p.fullName} · {p.phone}
        </button>
      ))}
    </div>
  );
}

function NewAppointmentCard({ services, defaultDate, onCreated }: { services: Service[]; defaultDate: string; onCreated: () => void }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState('');
  const active = services.filter((s) => s.active);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!patient) {
      setError('Elige un paciente');
      return;
    }
    const form = new FormData(e.currentTarget);
    setError('');
    try {
      await api('/appointments', {
        method: 'POST',
        body: JSON.stringify({ patientId: patient.id, serviceId: form.get('serviceId'), date: form.get('date'), time: form.get('time') }),
      });
      setPatient(null);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Nueva cita</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <PatientPicker value={patient} onChange={setPatient} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="serviceId">Servicio</Label>
              <select id="serviceId" name="serviceId" required className="w-full rounded-md border px-2 py-2 text-sm">
                {active.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="date">Fecha</Label>
              <Input id="date" name="date" type="date" defaultValue={defaultDate} key={defaultDate} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="time">Hora</Label>
              <Input id="time" name="time" type="time" step={300} required />
            </div>
          </div>
          {!active.length && <p className="text-sm text-amber-700">Primero crea un servicio en Configuración.</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={!active.length}>Agendar</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BlockCard({ defaultDate, onCreated }: { defaultDate: string; onCreated: () => void }) {
  const [error, setError] = useState('');
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError('');
    try {
      await api('/appointments/blocks', {
        method: 'POST',
        body: JSON.stringify({ date: form.get('date'), time: form.get('time'), endTime: form.get('endTime') }),
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Bloquear horario</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="b-date">Fecha</Label>
            <Input id="b-date" name="date" type="date" defaultValue={defaultDate} key={defaultDate} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="b-time">Desde</Label>
            <Input id="b-time" name="time" type="time" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="b-end">Hasta</Label>
            <Input id="b-end" name="endTime" type="time" required />
          </div>
          <Button type="submit" variant="outline">Bloquear</Button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

function AppointmentRow({ appt, tz, services, onChanged }: { appt: Appointment; tz: string; services: Service[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      setEditing(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const setStatus = (status: AppointmentStatus) =>
    run(() => api(`/appointments/${appt.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }));

  async function onEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run(() =>
      api(`/appointments/${appt.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ date: form.get('date'), time: form.get('time'), serviceId: form.get('serviceId') }),
      }),
    );
  }

  const editable = !appt.isBlock && (appt.status === 'SCHEDULED' || appt.status === 'CONFIRMED');

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-mono">{fmtTime(appt.startsAt, tz)}–{fmtTime(appt.endsAt, tz)}</span>{' '}
          {appt.isBlock ? (
            <span className="font-medium text-slate-500">Bloqueado</span>
          ) : (
            <>
              <span className="font-medium">{appt.patient?.fullName}</span>
              <span className="text-slate-500"> · {appt.service?.name}</span>
            </>
          )}
        </div>
        {!appt.isBlock && (
          <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[appt.status]}`}>{STATUS_LABEL[appt.status]}</span>
        )}
      </div>
      {appt.status !== 'CANCELLED' && (
        <div className="flex flex-wrap gap-2">
          {!appt.isBlock && NEXT_ACTIONS[appt.status].map((a) => (
            <Button key={a.status} size="sm" variant="outline" onClick={() => setStatus(a.status)}>{a.label}</Button>
          ))}
          {editable && <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>Editar</Button>}
          {(editable || appt.isBlock) && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (window.confirm(appt.isBlock ? '¿Quitar este bloqueo?' : '¿Cancelar esta cita?')) setStatus('CANCELLED');
              }}
            >
              {appt.isBlock ? 'Quitar bloqueo' : 'Cancelar'}
            </Button>
          )}
        </div>
      )}
      {editing && (
        <form onSubmit={onEdit} className="flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2">
          <Input name="date" type="date" defaultValue={localDate(appt.startsAt, tz)} className="w-40" required />
          <Input name="time" type="time" step={300} defaultValue={fmtTime(appt.startsAt, tz)} className="w-32" required />
          <select name="serviceId" defaultValue={appt.service?.id} className="rounded-md border px-2 py-2 text-sm">
            {services.filter((s) => s.active || s.id === appt.service?.id).map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>
            ))}
          </select>
          <Button type="submit" size="sm">Guardar</Button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </li>
  );
}

export default function AgendaPage() {
  const me = useClinicMe();
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [view, setView] = useState<View>('day');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) return;
    api<ClinicSettings>('/clinic').then((s) => {
      setSettings(s);
      setAnchor(todayIn(s.timezone));
    });
    api<Service[]>('/services').then(setServices);
  }, [me]);

  const range = useMemo(() => {
    if (!anchor) return null;
    const from = view === 'day' ? anchor : startOfWeek(anchor);
    return { from, to: view === 'day' ? from : addDays(from, 6) };
  }, [anchor, view]);

  const load = useCallback(() => {
    if (!range) return;
    api<Appointment[]>(`/appointments?from=${range.from}&to=${range.to}`)
      .then(setAppointments)
      .catch((e) => setError((e as Error).message));
  }, [range]);

  useEffect(load, [load]);

  if (!me || !settings || !anchor || !range) return <p className="p-8 text-slate-500">Cargando…</p>;

  const tz = settings.timezone;
  const days = view === 'day' ? [range.from] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i));
  const step = view === 'day' ? 1 : 7;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <AppHeader me={me} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button size="sm" variant={view === 'day' ? 'default' : 'outline'} onClick={() => setView('day')}>Día</Button>
          <Button size="sm" variant={view === 'week' ? 'default' : 'outline'} onClick={() => setView('week')}>Semana</Button>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAnchor(addDays(anchor, -step))}>←</Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(todayIn(tz))}>Hoy</Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(addDays(anchor, step))}>→</Button>
          <Input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} className="w-40" />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {days.map((day) => {
        const items = appointments.filter((a) => localDate(a.startsAt, tz) === day);
        return (
          <section key={day} className="space-y-2">
            <h2 className="font-semibold capitalize">{fmtDayHeader(day)}</h2>
            <ul className="divide-y rounded-lg border bg-white">
              {items.map((a) => (
                <AppointmentRow key={a.id} appt={a} tz={tz} services={services} onChanged={load} />
              ))}
              {!items.length && <li className="p-3 text-sm text-slate-500">Sin citas.</li>}
            </ul>
          </section>
        );
      })}

      <NewAppointmentCard services={services} defaultDate={anchor} onCreated={load} />
      <BlockCard defaultDate={anchor} onCreated={load} />
    </main>
  );
}
```

- [ ] **Step 2: Verificación completa**

Run: `npm run test:api && npm run build -w @recep/api && npm run build -w @recep/web`
Expected: todo en verde.

Prueba manual (`npm run dev`, entrar como el dueño de un consultorio):
1. **Configuración:**
   - Poner la dirección y "Yape 987654321".
   - Agregar el horario lunes 09:00–13:00 y crear los servicios "Limpieza 30" y "Ortodoncia 45".
   - Recargar: todo persiste.
2. **Pacientes:** crear "Juan Pérez" con `987 654 321` y la casilla de consentimiento marcada. Crear otro con `+51 987-654-321`: debe mostrar "Ya existe un paciente con ese teléfono".
3. **Agenda:**
   - Agendar a Juan hoy a las 09:30 (Limpieza): aparece como "Programada" de 09:30 a 10:00.
   - Agendar a otro paciente a las 09:45: aparece "Horario ocupado".
4. **Acciones sobre la cita:**
   - "Confirmar" la pone en verde.
   - "Editar" a mañana 11:00 la mueve; en la vista "Semana" aparece en el día correcto y en estado "Programada".
5. **Bloqueos:** bloquear 13:00–14:00 y luego intentar agendar a las 13:30: "Horario ocupado". "Quitar bloqueo" lo libera.
6. **Cancelar:** cancelar la cita la muestra tachada y el horario se puede volver a reservar.
7. **Ficha del paciente:** la de Juan muestra el historial de citas.
8. **Recepción:** como recepcionista, el menú no muestra "Configuración" ni "Usuarios" y la agenda funciona igual.

Expected: los 8 pasos se comportan como se describe.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(web): add day/week agenda with appointments, blocks and status actions"
```

---

## Siguientes planes

Plan 3 (Etapa 3): scheduler (`scheduled_messages` + cron cada minuto), cliente de 360dialog en sandbox, webhook y conversación (confirmar, cancelar y reprogramar con el cálculo de horarios libres sobre `business_hours`). Al crear o editar una cita, el `AppointmentsService` de este plan pasará a programar o cancelar los recordatorios.
