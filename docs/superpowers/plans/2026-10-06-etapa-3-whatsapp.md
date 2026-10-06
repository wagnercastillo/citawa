# Etapa 3 — Recordatorios por WhatsApp: scheduler, 360dialog, webhook y conversación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada cita programe sola sus recordatorios de 24 h y 2 h, que un despachador los envíe por 360dialog y que las respuestas del paciente (Confirmo / Cancelar / Reprogramar → lista → horario) actualicen la agenda sin intervención humana.

**Architecture:**
- **Cola sin Redis:** cada cita escribe filas en `scheduled_messages` mediante `ReminderScheduler`, dentro de la misma transacción que la cita. Un cron cada minuto (`ReminderDispatcher`) las toma con `FOR UPDATE SKIP LOCKED` y las envía con `D360Client`.
- **Webhook:** `/api/webhooks/wa/:token` identifica al consultorio por el token, guarda cada mensaje una sola vez (`wa_message_id` único) y delega en `ConversationService`, que reutiliza `AppointmentsService` con actor `WHATSAPP`.
- **Hora inyectable:** el reloj es un provider (`Clock`) para poder probar el tiempo de forma determinista.
- **Conexión temporal:** el superadmin conecta el WhatsApp de cada consultorio a mano. La Etapa 4 lo reemplaza por el onboarding.

**Tech Stack:** Lo de las Etapas 1–2 + `@nestjs/schedule`, `fetch` nativo de Node 24 y `crypto` (AES-256-GCM).

**Spec:** `docs/superpowers/specs/2026-10-05-recepcionista-wa-design.md` (§3 secretos cifrados, §4 `whatsapp_accounts`, `scheduled_messages` y `messages`, §5.1 pasos 2–4, §5.2, §5.3, §7). Notas verificadas de la API: `docs/360dialog-notes.md`.

## Global Constraints

- **Proyecto:**
  - Prefijo `api`.
  - Postgres en el puerto **5434**.
  - Comandos con `-w @recep/api` / `-w @recep/web`.
  - JSON se escribe con la herramienta de archivos.
  - Rama `etapa-3-whatsapp`, creada desde `main`.
- **Datos:**
  - `clinic_id` siempre de `AuthUser` (o del token del webhook).
  - Recursos de otro consultorio → 404.
  - API keys guardadas solo cifradas (AES-256-GCM, clave `ENCRYPTION_KEY` de 32 bytes en base64). **Nunca** se devuelven por la API.
- **Recordatorios:**
  - `REMINDER_24H` = `starts_at − 24h`, `REMINDER_2H` = `starts_at − 2h`. Solo se programan si la hora de envío es futura.
  - Una fila por (`appointment_id`, `kind`).
  - Reintentos: tras el 1.er fallo +5 min, tras el 2.º +15 min, **al 3.er fallo → FAILED**. Un 401 → FAILED de inmediato y la cuenta pasa a `ERROR`.
  - `REMINDER_2H` se cancela si la cita está CONFIRMED y `clinics.send_2h_to_confirmed = false`.
- **Plantillas (producción):**
  - `recordatorio_cita_24h` (es): parámetros [nombre, consultorio, fecha, hora]; botones CONFIRM, RESCHEDULE, CANCEL.
  - `recordatorio_cita_2h` (es): parámetros [nombre, hora, lugar]; botón CANCEL.
  - **Sandbox:** `interactive_template_sandbox` (en) con botones CONFIRM / CANCEL.
- **Payloads de botones:** `CONFIRM:<uuid>`, `CANCEL:<uuid>`, `RESCHEDULE:<uuid>`, `PICK:<uuid>:<isoUTC>`.
- **Reprogramación:** hasta 10 horarios libres, en los próximos 7 días desde mañana (hora del consultorio), en bloques del largo del servicio dentro de `business_hours`.
- **Seguridad de la conversación:** antes de actuar, la cita debe ser del consultorio del webhook **y** el teléfono del paciente debe ser igual a `+<from>`. Si no, se ignora sin responder.
- **Eventos:** las acciones que llegan por WhatsApp se registran con `source = WHATSAPP` y `actor_user_id = NULL`.
- **Tests:**
  - El cron no corre en los tests (`SCHEDULER_ENABLED=false`); se usa `runOnce()`.
  - Los tests de tiempo usan `FakeClock`.
  - 360dialog se reemplaza por `FakeD360`.

## Review Focus

1. **Webhook repetido o doble toque del mismo mensaje** (mismo `wa_message_id`) → se procesa una sola vez (un evento, una respuesta). Test en Task 8.
2. **Payload de un botón con una cita de otro consultorio, o enviado desde otro teléfono** → se ignora sin cambios ni respuesta. Test en Task 8.
3. **`PICK` manipulado** (horario ocupado o fuera del horario de atención) → no mueve la cita y reenvía la lista. Test en Task 8.
4. **Mover una cita cuyo recordatorio ya se envió** → se programa uno nuevo; confirmar sin mover no reenvía nada. Test en Task 6.
5. **Dos despachadores al mismo tiempo** → cada recordatorio se envía una sola vez. Test en Task 7.

---

## File Structure

```
apps/api/src/
├─ common/crypto.ts (+spec), clock.ts, common.module.ts, format-es.ts (+spec)
├─ common/zoned-time.ts (+ localParts)
├─ database/migrations/1759900000000-Messaging.ts
├─ appointments/free-slots.ts (+spec)
├─ appointments/appointments.service.ts   (refactor: Actor, reschedule, changeStatus, sync de recordatorios)
├─ appointments/appointments.module.ts    (importa SchedulerModule, exporta AppointmentsService)
├─ whatsapp/
│  ├─ whatsapp-account.entity.ts, message.entity.ts
│  ├─ d360-client.ts (+spec), message-builders.ts (+spec), parse-webhook.ts (+spec)
│  ├─ whatsapp-accounts.service.ts, messages.service.ts
│  ├─ whatsapp.dto.ts, admin-whatsapp.controller.ts, whatsapp.module.ts
├─ scheduler/
│  ├─ scheduled-message.entity.ts, reminder-scheduler.ts, reminder-dispatcher.ts, scheduler.module.ts
└─ conversation/conversation.service.ts, webhook.controller.ts, conversation.module.ts
apps/api/test/  fakes.ts, utils.ts (+createAppWithFakes, seedWhatsapp), messaging-schema, whatsapp-accounts,
                reminders, dispatcher, webhook (.e2e-spec.ts)
apps/web/src/  lib/types.ts (+WaAccount), app/admin/page.tsx (panel WhatsApp por consultorio)
README.md, docs/HANDOFF.md  (cómo probar con sandbox / producción)
```

---

### Task 1: Cifrado, reloj inyectable y variables de entorno

**Files:**
- Create: `apps/api/src/common/crypto.ts`, `apps/api/src/common/clock.ts`, `apps/api/src/common/common.module.ts`
- Modify: `apps/api/src/app.module.ts` (importar `CommonModule`), `apps/api/test/env.ts`, `.env.example`, `.env`
- Test: `apps/api/src/common/crypto.spec.ts`

**Interfaces:**
- Produces:
  - Cifrado: `encryptionKey(): Buffer`, `encrypt(plain: string, key?: Buffer): string` (formato `iv.tag.data` en base64), `decrypt(token: string, key?: Buffer): string`.
  - Reloj: `abstract class Clock { now(): Date }`, `class SystemClock`, `CommonModule` (global; provee `Clock`).
  - Variables de entorno: `ENCRYPTION_KEY`, `PUBLIC_API_URL`, `SCHEDULER_ENABLED`.

- [ ] **Step 0: Rama**

Run: `git checkout -b etapa-3-whatsapp`
Expected: rama creada.

- [ ] **Step 1: Test de cifrado (falla)**

`apps/api/src/common/crypto.spec.ts`:
```ts
import { randomBytes } from 'crypto';
import { decrypt, encrypt, encryptionKey } from './crypto';

describe('crypto', () => {
  const key = randomBytes(32);

  it('cifra y descifra', () => {
    expect(decrypt(encrypt('mi-api-key', key), key)).toBe('mi-api-key');
  });

  it('dos cifrados del mismo texto son distintos (IV aleatorio)', () => {
    expect(encrypt('x', key)).not.toBe(encrypt('x', key));
  });

  it('detecta manipulación y clave incorrecta', () => {
    const [iv, tag, data] = encrypt('secreto', key).split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => decrypt([iv, tag, flipped.toString('base64')].join('.'), key)).toThrow();
    expect(() => decrypt(encrypt('secreto', key), randomBytes(32))).toThrow();
  });

  it('exige una ENCRYPTION_KEY de 32 bytes', () => {
    const prev = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encryptionKey()).toThrow('ENCRYPTION_KEY');
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    expect(encryptionKey()).toHaveLength(32);
    process.env.ENCRYPTION_KEY = prev;
  });
});
```

Run: `npm test -w @recep/api -- crypto`
Expected: FAIL, "Cannot find module './crypto'".

- [ ] **Step 2: Implementación**

`apps/api/src/common/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY debe ser una clave de 32 bytes en base64');
  return key;
}

/** AES-256-GCM. Devuelve "iv.tag.data" en base64. */
export function encrypt(plain: string, key: Buffer = encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(token: string, key: Buffer = encryptionKey()): string {
  const [iv, tag, data] = token.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
```

`apps/api/src/common/clock.ts`:
```ts
/** Reloj inyectable: en producción la hora real, en tests un FakeClock. */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
```

`apps/api/src/common/common.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class CommonModule {}
```

En `apps/api/src/app.module.ts`: `import { CommonModule } from './common/common.module';` y agregar `CommonModule` al **inicio** del array `imports`.

`apps/api/test/env.ts`, agregar al final:
```ts
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PUBLIC_API_URL = 'https://api.test';
process.env.SCHEDULER_ENABLED = 'false';
```

`.env.example`, agregar debajo de `WEB_URL`:
```
# Clave para cifrar API keys de WhatsApp (32 bytes base64):
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_KEY=
# URL pública de la API (360dialog envía el webhook aquí). En local: la del túnel (cloudflared/ngrok)
PUBLIC_API_URL=http://localhost:4000
# "false" desactiva el cron de recordatorios
SCHEDULER_ENABLED=true
```

Agregar las mismas tres variables a `.env`, con una clave generada:
```bash
echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" >> .env
echo "PUBLIC_API_URL=http://localhost:4000" >> .env
echo "SCHEDULER_ENABLED=true" >> .env
```

- [ ] **Step 3: Tests pasan**

Run: `npm test -w @recep/api`
Expected: PASS (incluye `crypto` con 4 tests).

Run: `npm run test:e2e -w @recep/api`
Expected: PASS (nada se rompe con `CommonModule`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add AES-256-GCM secret encryption and injectable clock"
```

---

### Task 2: Esquema de mensajería (cuentas, cola y mensajes)

**Files:**
- Create: `apps/api/src/database/migrations/1759900000000-Messaging.ts`
- Create: `apps/api/src/whatsapp/whatsapp-account.entity.ts`, `apps/api/src/whatsapp/message.entity.ts`, `apps/api/src/scheduler/scheduled-message.entity.ts`
- Modify: `apps/api/src/database/data-source.ts` (entidades + migración)
- Test: `apps/api/test/messaging-schema.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `enum WaAccountStatus { PENDING, CONNECTED, ERROR }`
  - `WhatsappAccount { id; clinicId; phoneNumber; displayName: string|null; channelId: string|null; sandbox: boolean; apiKeyEnc; webhookToken; status; lastError: string|null }`
  - `enum ScheduledKind { REMINDER_24H, REMINDER_2H, PAYMENT_REMINDER }`, `enum ScheduledStatus { PENDING, SENDING, SENT, FAILED, CANCELLED }`
  - `ScheduledMessage { id; clinicId; kind; appointmentId: string|null; chargeId: string|null; sendAt: Date; status; attempts: number; lastError: string|null; cancelReason: string|null; updatedAt: Date }`
  - `enum MessageDirection { IN, OUT }`, `enum MessageStatus { SENT, DELIVERED, READ, FAILED }`
  - `Message { id; clinicId; patientId: string|null; direction; waMessageId: string|null; type: string; payload: Record<string, unknown>; status: MessageStatus|null; scheduledMessageId: string|null }`

- [ ] **Step 1: Test (falla)**

`apps/api/test/messaging-schema.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb, seedClinic, seedPatient, seedService } from './utils';

describe('messaging schema', () => {
  let app: INestApplication;
  let ds: DataSource;
  let clinicId: string;
  let apptId: string;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDb(app);
    clinicId = (await seedClinic(app)).id;
    const patient = await seedPatient(app, clinicId);
    const service = await seedService(app, clinicId);
    [{ id: apptId }] = await ds.query(
      `INSERT INTO appointments (clinic_id, patient_id, service_id, starts_at, ends_at)
       VALUES ($1, $2, $3, '2026-10-06T14:30:00Z', '2026-10-06T15:00:00Z') RETURNING id`,
      [clinicId, patient.id, service.id],
    );
  });
  afterAll(async () => { await app.close(); });

  const schedule = (kind: string) =>
    ds.query(
      `INSERT INTO scheduled_messages (clinic_id, kind, appointment_id, send_at) VALUES ($1, $2, $3, now())`,
      [clinicId, kind, apptId],
    );

  it('una sola fila por cita y tipo de recordatorio', async () => {
    await schedule('REMINDER_24H');
    await schedule('REMINDER_2H');
    await expect(schedule('REMINDER_24H')).rejects.toMatchObject({ code: '23505' });
  });

  it('borrar la cita borra sus recordatorios', async () => {
    await schedule('REMINDER_24H');
    await ds.query('DELETE FROM appointments WHERE id = $1', [apptId]);
    const [{ count }] = await ds.query('SELECT count(*)::int AS count FROM scheduled_messages');
    expect(count).toBe(0);
  });

  it('wa_message_id es único (permite varios NULL)', async () => {
    const insert = (wa: string | null) =>
      ds.query(`INSERT INTO messages (clinic_id, direction, wa_message_id, type) VALUES ($1, 'OUT', $2, 'text')`, [clinicId, wa]);
    await insert('wamid.1');
    await insert(null);
    await insert(null);
    await expect(insert('wamid.1')).rejects.toMatchObject({ code: '23505' });
  });

  it('una cuenta de WhatsApp por consultorio', async () => {
    const insert = (token: string) =>
      ds.query(
        `INSERT INTO whatsapp_accounts (clinic_id, phone_number, api_key_enc, webhook_token) VALUES ($1, '+51987654321', 'x', $2)`,
        [clinicId, token],
      );
    await insert('tok-1');
    await expect(insert('tok-2')).rejects.toMatchObject({ code: '23505' });
  });
});
```

Run: `npm run test:e2e -w @recep/api -- messaging-schema`
Expected: FAIL (`relation "scheduled_messages" does not exist`).

- [ ] **Step 2: Migración**

`apps/api/src/database/migrations/1759900000000-Messaging.ts`:
```ts
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
```

- [ ] **Step 3: Entidades**

`apps/api/src/whatsapp/whatsapp-account.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum WaAccountStatus {
  PENDING = 'PENDING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

@Entity('whatsapp_accounts')
export class WhatsappAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ name: 'phone_number', type: 'varchar', length: 20 }) phoneNumber: string;
  @Column({ name: 'display_name', type: 'varchar', length: 120, nullable: true }) displayName: string | null;
  @Column({ name: 'channel_id', type: 'varchar', length: 64, nullable: true }) channelId: string | null;
  @Column({ type: 'boolean', default: false }) sandbox: boolean;
  @Column({ name: 'api_key_enc', type: 'text' }) apiKeyEnc: string;
  @Column({ name: 'webhook_token', type: 'varchar', length: 64 }) webhookToken: string;
  @Column({ type: 'enum', enum: WaAccountStatus, enumName: 'wa_account_status', default: WaAccountStatus.PENDING })
  status: WaAccountStatus;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

`apps/api/src/whatsapp/message.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum MessageDirection {
  IN = 'IN',
  OUT = 'OUT',
}

export enum MessageStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  FAILED = 'FAILED',
}

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ name: 'patient_id', type: 'uuid', nullable: true }) patientId: string | null;
  @Column({ type: 'enum', enum: MessageDirection, enumName: 'message_direction' }) direction: MessageDirection;
  @Column({ name: 'wa_message_id', type: 'varchar', length: 128, nullable: true }) waMessageId: string | null;
  @Column({ type: 'varchar', length: 32 }) type: string;
  @Column({ type: 'jsonb', default: {} }) payload: Record<string, unknown>;
  @Column({ type: 'enum', enum: MessageStatus, enumName: 'message_status', nullable: true }) status: MessageStatus | null;
  @Column({ name: 'scheduled_message_id', type: 'uuid', nullable: true }) scheduledMessageId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

`apps/api/src/scheduler/scheduled-message.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum ScheduledKind {
  REMINDER_24H = 'REMINDER_24H',
  REMINDER_2H = 'REMINDER_2H',
  PAYMENT_REMINDER = 'PAYMENT_REMINDER',
}

export enum ScheduledStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('scheduled_messages')
export class ScheduledMessage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ type: 'enum', enum: ScheduledKind, enumName: 'scheduled_kind' }) kind: ScheduledKind;
  @Column({ name: 'appointment_id', type: 'uuid', nullable: true }) appointmentId: string | null;
  @Column({ name: 'charge_id', type: 'uuid', nullable: true }) chargeId: string | null;
  @Column({ name: 'send_at', type: 'timestamptz' }) sendAt: Date;
  @Column({ type: 'enum', enum: ScheduledStatus, enumName: 'scheduled_status', default: ScheduledStatus.PENDING })
  status: ScheduledStatus;
  @Column({ type: 'integer', default: 0 }) attempts: number;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError: string | null;
  @Column({ name: 'cancel_reason', type: 'varchar', length: 120, nullable: true }) cancelReason: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

En `apps/api/src/database/data-source.ts`:
- Agregar los imports:
  ```ts
  import { ScheduledMessage } from '../scheduler/scheduled-message.entity';
  import { Message } from '../whatsapp/message.entity';
  import { WhatsappAccount } from '../whatsapp/whatsapp-account.entity';
  import { Messaging1759900000000 } from './migrations/1759900000000-Messaging';
  ```
- Dejar los arrays así:
  ```ts
    entities: [Clinic, User, BusinessHour, Service, Patient, Appointment, AppointmentEvent, WhatsappAccount, ScheduledMessage, Message],
    migrations: [Init1759700000000, Agenda1759800000000, Messaging1759900000000],
  ```

- [ ] **Step 4: Tests pasan y migración en desarrollo**

Run: `npm run test:e2e -w @recep/api`
Expected: PASS (`messaging schema`: 4 tests).

Run: `npm run migration:run -w @recep/api`
Expected: "Migration Messaging1759900000000 has been executed successfully."

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add messaging schema (whatsapp accounts, scheduled messages, messages)"
```

---

### Task 3: Hora local, textos en español y cálculo de horarios libres

**Files:**
- Modify: `apps/api/src/common/zoned-time.ts` (agregar `localParts`), `apps/api/src/common/zoned-time.spec.ts`
- Create: `apps/api/src/common/format-es.ts` (+ `format-es.spec.ts`), `apps/api/src/appointments/free-slots.ts` (+ `free-slots.spec.ts`)

**Interfaces:**
- Produces:
  - `localParts(instant: Date, timeZone: string): { date: string; time: string; weekday: number }`
  - `fmtDateEs(instant, tz)` → `"martes 6 de octubre"`; `fmtTimeEs(instant, tz)` → `"09:30"`; `fmtSlotLabel(instant, tz)` → `"jue 08/10 10:00"`; `firstName(fullName)`.
  - `freeSlots(o: { hours: HourRange[]; busy: Busy[]; durationMin: number; timeZone: string; fromDate: string; days: number; limit: number }): Date[]`
  - `HourRange { weekday; opensAt; closesAt }`, `Busy { start: Date; end: Date }`.

- [ ] **Step 1: Tests (fallan)**

Agregar al final de `apps/api/src/common/zoned-time.spec.ts` (y `localParts` al import de la primera línea):
```ts
describe('localParts', () => {
  it('04:30Z del 7 de octubre es el 6 a las 23:30 en Lima (martes)', () => {
    expect(localParts(new Date('2026-10-07T04:30:00Z'), 'America/Lima')).toEqual({ date: '2026-10-06', time: '23:30', weekday: 2 });
  });
  it('medianoche local', () => {
    expect(localParts(new Date('2026-10-06T05:00:00Z'), 'America/Lima')).toEqual({ date: '2026-10-06', time: '00:00', weekday: 2 });
  });
});
```

`apps/api/src/common/format-es.spec.ts`:
```ts
import { firstName, fmtDateEs, fmtSlotLabel, fmtTimeEs } from './format-es';

describe('format-es', () => {
  const tz = 'America/Lima';
  it('fecha larga y hora', () => {
    expect(fmtDateEs(new Date('2026-10-06T14:30:00Z'), tz)).toBe('martes 6 de octubre');
    expect(fmtTimeEs(new Date('2026-10-06T14:30:00Z'), tz)).toBe('09:30');
  });
  it('etiqueta corta de horario (≤ 24 caracteres)', () => {
    const label = fmtSlotLabel(new Date('2026-10-08T15:00:00Z'), tz);
    expect(label).toBe('jue 08/10 10:00');
    expect(label.length).toBeLessThanOrEqual(24);
  });
  it('primer nombre', () => {
    expect(firstName('  Juan Carlos Pérez ')).toBe('Juan');
  });
});
```

`apps/api/src/appointments/free-slots.spec.ts`:
```ts
import { freeSlots } from './free-slots';

const tz = 'America/Lima';
const lima = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);
const iso = (d: Date[]) => d.map((x) => x.toISOString());

describe('freeSlots', () => {
  const monday = { weekday: 1, opensAt: '09:00', closesAt: '11:00' };

  it('bloques del largo del servicio, saltando lo ocupado', () => {
    const slots = freeSlots({
      hours: [monday],
      busy: [{ start: lima('2026-10-12', '09:30'), end: lima('2026-10-12', '10:00') }],
      durationMin: 30, timeZone: tz, fromDate: '2026-10-12', days: 1, limit: 10,
    });
    expect(iso(slots)).toEqual([
      lima('2026-10-12', '09:00').toISOString(),
      lima('2026-10-12', '10:00').toISOString(),
      lima('2026-10-12', '10:30').toISOString(),
    ]);
  });

  it('un ocupado parcial descarta todos los bloques que toca', () => {
    const slots = freeSlots({
      hours: [monday],
      busy: [{ start: lima('2026-10-12', '10:15'), end: lima('2026-10-12', '10:45') }],
      durationMin: 30, timeZone: tz, fromDate: '2026-10-12', days: 1, limit: 10,
    });
    expect(iso(slots)).toEqual([lima('2026-10-12', '09:00').toISOString(), lima('2026-10-12', '09:30').toISOString()]);
  });

  it('salta días sin horario y respeta el límite', () => {
    const slots = freeSlots({ hours: [monday], busy: [], durationMin: 30, timeZone: tz, fromDate: '2026-10-11', days: 2, limit: 3 });
    expect(iso(slots)).toEqual([
      lima('2026-10-12', '09:00').toISOString(),
      lima('2026-10-12', '09:30').toISOString(),
      lima('2026-10-12', '10:00').toISOString(),
    ]);
  });

  it('varias franjas el mismo día y servicio que no entra completo', () => {
    const slots = freeSlots({
      hours: [{ weekday: 1, opensAt: '15:00', closesAt: '16:00' }, { weekday: 1, opensAt: '09:00', closesAt: '10:00' }],
      busy: [], durationMin: 45, timeZone: tz, fromDate: '2026-10-12', days: 1, limit: 10,
    });
    expect(iso(slots)).toEqual([lima('2026-10-12', '09:00').toISOString(), lima('2026-10-12', '15:00').toISOString()]);
  });
});
```

Run: `npm test -w @recep/api`
Expected: FAIL (no existen `localParts`, `./format-es` ni `./free-slots`).

- [ ] **Step 2: Implementación**

Agregar a `apps/api/src/common/zoned-time.ts`:
```ts
/** Fecha (YYYY-MM-DD), hora (HH:MM) y día de la semana (0 = domingo) del instante en la zona dada. */
export function localParts(instant: Date, timeZone: string): { date: string; time: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)!.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const [y, m, d] = date.split('-').map(Number);
  return { date, time: `${get('hour')}:${get('minute')}`, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
```

`apps/api/src/common/format-es.ts`:
```ts
import { localParts } from './zoned-time';

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const SHORT_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "martes 6 de octubre" */
export function fmtDateEs(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  const [, m, d] = p.date.split('-').map(Number);
  return `${DAYS[p.weekday]} ${d} de ${MONTHS[m - 1]}`;
}

/** "09:30" */
export function fmtTimeEs(instant: Date, timeZone: string): string {
  return localParts(instant, timeZone).time;
}

/** "jue 08/10 10:00" (cabe en el título de una fila de lista de WhatsApp, máx. 24). */
export function fmtSlotLabel(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  const [, m, d] = p.date.split('-');
  return `${SHORT_DAYS[p.weekday]} ${d}/${m} ${p.time}`;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
```

`apps/api/src/appointments/free-slots.ts`:
```ts
import { addDays, zonedToUtc } from '../common/zoned-time';

export interface HourRange {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface Busy {
  start: Date;
  end: Date;
}

/** Horarios libres (inicio de cada bloque) dentro del horario de atención, sin cruzarse con `busy`. */
export function freeSlots(o: {
  hours: HourRange[];
  busy: Busy[];
  durationMin: number;
  timeZone: string;
  fromDate: string;
  days: number;
  limit: number;
}): Date[] {
  const dur = o.durationMin * 60_000;
  const out: Date[] = [];
  for (let i = 0; i < o.days && out.length < o.limit; i++) {
    const date = addDays(o.fromDate, i);
    const [y, m, d] = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const ranges = o.hours.filter((h) => h.weekday === weekday).sort((a, b) => a.opensAt.localeCompare(b.opensAt));
    for (const r of ranges) {
      const close = zonedToUtc(date, r.closesAt, o.timeZone).getTime();
      for (let t = zonedToUtc(date, r.opensAt, o.timeZone).getTime(); t + dur <= close && out.length < o.limit; t += dur) {
        const clash = o.busy.some((b) => b.start.getTime() < t + dur && t < b.end.getTime());
        if (!clash) out.push(new Date(t));
      }
    }
  }
  return out;
}
```

- [ ] **Step 3: Tests pasan**

Run: `npm test -w @recep/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add local time parts, Spanish date formatting and free slot calculation"
```

---

### Task 4: Cliente de 360dialog, constructores de mensajes y lector del webhook (puros)

**Files:**
- Create: `apps/api/src/whatsapp/d360-client.ts` (+ `d360-client.spec.ts`), `message-builders.ts` (+ `.spec.ts`), `parse-webhook.ts` (+ `.spec.ts`)

**Interfaces:**
- Produces:
  - **Cliente:**
    - `D360Credentials { apiKey; sandbox }`, `D360Error(status, message)` con `.retryable` (true si 0, 429 o ≥ 500), `d360Urls(sandbox)`.
    - `@Injectable() D360Client`: `send(creds, payload): Promise<{ waMessageId }>` y `setWebhook(creds, url): Promise<void>`.
  - **Constructores** (`object`):
    - `reminder24h({ to, patientName, clinicName, dateText, timeText, appointmentId, sandbox })`
    - `reminder2h({ to, patientName, timeText, place, appointmentId, sandbox })`
    - `textMessage(to, body)`
    - `slotList({ to, appointmentId, slots: { iso, label }[], intro })`
    - `SANDBOX_TEMPLATE`
  - **Webhook:** `parseWebhook(body: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] }`, con:
    - `InboundMessage { waId; from; type; text: string | null; payload: string | null }`
    - `StatusUpdate { waId; status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' }`

- [ ] **Step 1: Tests (fallan)**

`apps/api/src/whatsapp/d360-client.spec.ts`:
```ts
import { D360Client, D360Error } from './d360-client';

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('D360Client', () => {
  const client = new D360Client();
  afterEach(() => jest.restoreAllMocks());

  it('producción: URL, header y cuerpo; devuelve el id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(ok({ messages: [{ id: 'wamid.ABC' }] }));
    const res = await client.send({ apiKey: 'k1', sandbox: false }, { hola: 1 });
    expect(res).toEqual({ waMessageId: 'wamid.ABC' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://waba-v2.360dialog.io/messages');
    expect((init!.headers as Record<string, string>)['D360-API-KEY']).toBe('k1');
    expect(JSON.parse(init!.body as string)).toEqual({ hola: 1 });
  });

  it('sandbox usa su host y /v1; setWebhook llama a /v1/configs/webhook', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(ok({ messages: [{ id: 'm1' }] }, 201));
    await client.send({ apiKey: 'k', sandbox: true }, {});
    await client.setWebhook({ apiKey: 'k', sandbox: true }, 'https://api.test/api/webhooks/wa/t');
    expect(fetchMock.mock.calls[0][0]).toBe('https://waba-sandbox.360dialog.io/v1/messages');
    expect(fetchMock.mock.calls[1][0]).toBe('https://waba-sandbox.360dialog.io/v1/configs/webhook');
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ url: 'https://api.test/api/webhooks/wa/t' });
  });

  it('errores: 401 no reintentable, 503 y red caída sí; respuesta sin id es error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(ok({ error: { message: 'Invalid key' } }, 401));
    await expect(client.send({ apiKey: 'k', sandbox: false }, {})).rejects.toMatchObject({ status: 401, retryable: false, message: 'Invalid key' });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(ok({}, 503));
    await expect(client.send({ apiKey: 'k', sandbox: false }, {})).rejects.toMatchObject({ status: 503, retryable: true });
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client.send({ apiKey: 'k', sandbox: false }, {})).rejects.toBeInstanceOf(D360Error);
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(ok({ messages: [] }));
    await expect(client.send({ apiKey: 'k', sandbox: false }, {})).rejects.toMatchObject({ retryable: true });
  });
});
```

`apps/api/src/whatsapp/message-builders.spec.ts`:
```ts
import { reminder24h, reminder2h, SANDBOX_TEMPLATE, slotList, textMessage } from './message-builders';

const ID = '11111111-1111-1111-1111-111111111111';

describe('message builders', () => {
  it('recordatorio 24 h en producción: plantilla, parámetros y 3 botones', () => {
    const p = reminder24h({ to: '+51987654321', patientName: 'Juan', clinicName: 'Sonrisas', dateText: 'martes 6 de octubre', timeText: '09:30', appointmentId: ID, sandbox: false }) as any;
    expect(p).toMatchObject({ messaging_product: 'whatsapp', to: '51987654321', type: 'template' });
    expect(p.template.name).toBe('recordatorio_cita_24h');
    expect(p.template.language).toEqual({ code: 'es' });
    expect(p.template.components[0]).toEqual({
      type: 'body',
      parameters: ['Juan', 'Sonrisas', 'martes 6 de octubre', '09:30'].map((text) => ({ type: 'text', text })),
    });
    expect(p.template.components.slice(1).map((c: any) => [c.sub_type, c.index, c.parameters[0].payload])).toEqual([
      ['quick_reply', '0', `CONFIRM:${ID}`],
      ['quick_reply', '1', `RESCHEDULE:${ID}`],
      ['quick_reply', '2', `CANCEL:${ID}`],
    ]);
  });

  it('recordatorio 2 h en producción: lugar y botón cancelar', () => {
    const p = reminder2h({ to: '+51987654321', patientName: 'Juan', timeText: '09:30', place: 'Av. Larco 123', appointmentId: ID, sandbox: false }) as any;
    expect(p.template.name).toBe('recordatorio_cita_2h');
    expect(p.template.components[0].parameters.map((x: any) => x.text)).toEqual(['Juan', '09:30', 'Av. Larco 123']);
    expect(p.template.components[1].parameters[0].payload).toBe(`CANCEL:${ID}`);
  });

  it('en sandbox usa la plantilla de prueba con CONFIRM y CANCEL', () => {
    const p = reminder24h({ to: '+51987654321', patientName: 'J', clinicName: 'C', dateText: 'd', timeText: 't', appointmentId: ID, sandbox: true }) as any;
    expect(p.template.name).toBe(SANDBOX_TEMPLATE);
    expect(p.template.components.map((c: any) => c.parameters[0].payload)).toEqual([`CONFIRM:${ID}`, `CANCEL:${ID}`]);
  });

  it('lista de horarios: máx. 10 filas, título ≤ 24, id PICK', () => {
    const slots = Array.from({ length: 12 }, (_, i) => ({ iso: `2026-10-0${(i % 9) + 1}T15:00:00.000Z`, label: `etiqueta muy larga número ${i}` }));
    const p = slotList({ to: '+51987654321', appointmentId: ID, slots, intro: 'Elige:' }) as any;
    const rows = p.interactive.action.sections[0].rows;
    expect(p.interactive.type).toBe('list');
    expect(rows).toHaveLength(10);
    expect(rows.every((r: any) => r.title.length <= 24)).toBe(true);
    expect(rows[0].id).toBe(`PICK:${ID}:${slots[0].iso}`);
    expect(p.interactive.action.button.length).toBeLessThanOrEqual(20);
  });

  it('texto simple', () => {
    expect(textMessage('+51987654321', 'Hola')).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '51987654321', type: 'text', text: { body: 'Hola' },
    });
  });
});
```

`apps/api/src/whatsapp/parse-webhook.spec.ts`:
```ts
import { parseWebhook } from './parse-webhook';

const cloud = (value: unknown) => ({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value }] }] });

describe('parseWebhook', () => {
  it('texto, botón de plantilla, lista y botón interactivo (formato Cloud)', () => {
    const { messages } = parseWebhook(
      cloud({
        messages: [
          { from: '51987654321', id: 'w1', type: 'text', text: { body: 'hola' } },
          { from: '51987654321', id: 'w2', type: 'button', button: { text: 'Confirmo', payload: 'CONFIRM:x' } },
          { from: '51987654321', id: 'w3', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'PICK:x:y', title: 't' } } },
          { from: '51987654321', id: 'w4', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'CANCEL:x', title: 't' } } },
        ],
      }),
    );
    expect(messages.map((m) => [m.waId, m.type, m.text, m.payload])).toEqual([
      ['w1', 'text', 'hola', null],
      ['w2', 'button', null, 'CONFIRM:x'],
      ['w3', 'interactive', null, 'PICK:x:y'],
      ['w4', 'interactive', null, 'CANCEL:x'],
    ]);
  });

  it('estados en mayúsculas e ignora desconocidos', () => {
    const { statuses } = parseWebhook(cloud({ statuses: [{ id: 'a', status: 'delivered' }, { id: 'b', status: 'read' }, { id: 'c', status: 'deleted' }] }));
    expect(statuses).toEqual([{ waId: 'a', status: 'DELIVERED' }, { waId: 'b', status: 'READ' }]);
  });

  it('acepta el formato v1 (sin entry) y basura', () => {
    expect(parseWebhook({ messages: [{ from: '1', id: 'z', type: 'text', text: { body: 'x' } }] }).messages).toHaveLength(1);
    expect(parseWebhook(null)).toEqual({ messages: [], statuses: [] });
    expect(parseWebhook({ entry: 'nope' })).toEqual({ messages: [], statuses: [] });
  });
});
```

Run: `npm test -w @recep/api`
Expected: FAIL (no existen los módulos).

- [ ] **Step 2: Implementación**

`apps/api/src/whatsapp/d360-client.ts`:
```ts
import { Injectable } from '@nestjs/common';

export interface D360Credentials {
  apiKey: string;
  sandbox: boolean;
}

export class D360Error extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }

  /** 0 = sin conexión. 429 y 5xx son transitorios; el resto (400, 401…) no se reintenta. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export function d360Urls(sandbox: boolean): { messages: string; webhook: string } {
  const host = sandbox ? 'https://waba-sandbox.360dialog.io' : 'https://waba-v2.360dialog.io';
  return { messages: sandbox ? `${host}/v1/messages` : `${host}/messages`, webhook: `${host}/v1/configs/webhook` };
}

@Injectable()
export class D360Client {
  async send(creds: D360Credentials, payload: object): Promise<{ waMessageId: string }> {
    const body = (await this.post(creds, d360Urls(creds.sandbox).messages, payload)) as { messages?: { id?: string }[] };
    const id = body.messages?.[0]?.id;
    if (!id) throw new D360Error(502, 'Respuesta de 360dialog sin id de mensaje');
    return { waMessageId: id };
  }

  async setWebhook(creds: D360Credentials, url: string): Promise<void> {
    await this.post(creds, d360Urls(creds.sandbox).webhook, { url });
  }

  private async post(creds: D360Credentials, url: string, payload: object): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'D360-API-KEY': creds.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new D360Error(0, `No se pudo conectar con 360dialog: ${(e as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; meta?: { developer_message?: string } };
    if (!res.ok) throw new D360Error(res.status, body.error?.message ?? body.meta?.developer_message ?? `HTTP ${res.status}`);
    return body;
  }
}
```

`apps/api/src/whatsapp/message-builders.ts`:
```ts
/** Plantilla fija del sandbox de 360dialog (2 botones quick-reply). Idioma sin verificar: "en". */
export const SANDBOX_TEMPLATE = 'interactive_template_sandbox';

const digits = (e164: string): string => e164.replace(/\D/g, '');

const base = (to: string) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(to) });

const quickReply = (index: number, payload: string) => ({
  type: 'button',
  sub_type: 'quick_reply',
  index: String(index),
  parameters: [{ type: 'payload', payload }],
});

const bodyParams = (values: string[]) => ({ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) });

const template = (to: string, name: string, language: string, components: object[]) => ({
  ...base(to),
  type: 'template',
  template: { name, language: { code: language }, components },
});

const sandboxReminder = (to: string, appointmentId: string) =>
  template(to, SANDBOX_TEMPLATE, 'en', [quickReply(0, `CONFIRM:${appointmentId}`), quickReply(1, `CANCEL:${appointmentId}`)]);

export function reminder24h(a: {
  to: string;
  patientName: string;
  clinicName: string;
  dateText: string;
  timeText: string;
  appointmentId: string;
  sandbox: boolean;
}): object {
  if (a.sandbox) return sandboxReminder(a.to, a.appointmentId);
  return template(a.to, 'recordatorio_cita_24h', 'es', [
    bodyParams([a.patientName, a.clinicName, a.dateText, a.timeText]),
    quickReply(0, `CONFIRM:${a.appointmentId}`),
    quickReply(1, `RESCHEDULE:${a.appointmentId}`),
    quickReply(2, `CANCEL:${a.appointmentId}`),
  ]);
}

export function reminder2h(a: {
  to: string;
  patientName: string;
  timeText: string;
  place: string;
  appointmentId: string;
  sandbox: boolean;
}): object {
  if (a.sandbox) return sandboxReminder(a.to, a.appointmentId);
  return template(a.to, 'recordatorio_cita_2h', 'es', [
    bodyParams([a.patientName, a.timeText, a.place]),
    quickReply(0, `CANCEL:${a.appointmentId}`),
  ]);
}

export function textMessage(to: string, body: string): object {
  return { ...base(to), type: 'text', text: { body } };
}

export function slotList(a: { to: string; appointmentId: string; slots: { iso: string; label: string }[]; intro: string }): object {
  return {
    ...base(a.to),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: a.intro },
      action: {
        button: 'Ver horarios',
        sections: [
          {
            title: 'Horarios libres',
            rows: a.slots.slice(0, 10).map((s) => ({ id: `PICK:${a.appointmentId}:${s.iso}`, title: s.label.slice(0, 24) })),
          },
        ],
      },
    },
  };
}
```

`apps/api/src/whatsapp/parse-webhook.ts`:
```ts
export interface InboundMessage {
  waId: string;
  from: string;
  type: string;
  text: string | null;
  payload: string | null;
}

export type DeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface StatusUpdate {
  waId: string;
  status: DeliveryStatus;
}

const STATUSES: Record<string, DeliveryStatus> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Acepta el formato Cloud (entry[].changes[].value) y el v1 (arrays en la raíz). */
export function parseWebhook(body: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Json;
  const values: Json[] = Array.isArray(b.entry)
    ? b.entry.flatMap((e: Json) => (Array.isArray(e?.changes) ? e.changes.map((c: Json) => c?.value ?? {}) : []))
    : [b];

  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  for (const v of values) {
    for (const m of Array.isArray(v.messages) ? v.messages : []) {
      if (typeof m?.id !== 'string' || typeof m?.from !== 'string') continue;
      messages.push({
        waId: m.id,
        from: m.from,
        type: String(m.type ?? 'unknown'),
        text: typeof m.text?.body === 'string' ? m.text.body : null,
        payload: m.button?.payload ?? m.interactive?.list_reply?.id ?? m.interactive?.button_reply?.id ?? null,
      });
    }
    for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
      const status = STATUSES[String(s?.status)];
      if (typeof s?.id === 'string' && status) statuses.push({ waId: s.id, status });
    }
  }
  return { messages, statuses };
}
```

- [ ] **Step 3: Tests pasan**

Run: `npm test -w @recep/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add 360dialog client, WhatsApp message builders and webhook parser"
```

---

### Task 5: Conexión manual del WhatsApp por el superadmin (+ fakes de test)

**Files:**
- Create: `apps/api/src/whatsapp/whatsapp.dto.ts`, `whatsapp-accounts.service.ts`, `admin-whatsapp.controller.ts`, `whatsapp.module.ts`
- Create: `apps/api/test/fakes.ts`
- Modify: `apps/api/test/utils.ts` (`createTestApp(customize?)`, `createAppWithFakes`, `seedWhatsapp`), `apps/api/src/app.module.ts` (importar `WhatsappModule`)
- Test: `apps/api/test/whatsapp-accounts.e2e-spec.ts`

**Interfaces:**
- Consumes: `encrypt`, `decrypt`, `normalizePhone`, `D360Client`, `Clinic`, `WhatsappAccount`, `@Roles`.
- Produces:
  - Rutas (SUPERADMIN):
    - `GET /api/admin/clinics/:id/whatsapp` → `{ account: WhatsappAccountDto | null }`
    - `PUT /api/admin/clinics/:id/whatsapp` `{ apiKey, phoneNumber, sandbox?, displayName? }` → `WhatsappAccountDto`
  - `WhatsappAccountDto { phoneNumber; displayName; sandbox; status; lastError; webhookUrl }` (nunca incluye la key).
  - `WhatsappAccountsService`:
    - `connect(clinicId, dto)`, `get(clinicId)`
    - `findByWebhookToken(token): Promise<WhatsappAccount | null>`
    - `forClinic(clinicId): Promise<WhatsappAccount | null>`
    - `credentials(account): D360Credentials`
    - `markError(clinicId, message): Promise<void>`
  - Para los tests:
    - `FakeClock(iso)` con `.now()` / `.set(iso)`
    - `FakeD360` con `.sent[]`, `.webhooks[]`, `.sendErrors[]`, `.webhookError`
    - `createTestApp(customize?)`, `createAppWithFakes(nowIso?) → { app, clock, d360 }`
    - `seedWhatsapp(app, clinicId, opts?) → WhatsappAccount`

- [ ] **Step 1: Fakes, utilidades y test (falla)**

`apps/api/test/fakes.ts`:
```ts
import { Clock } from '../src/common/clock';
import { D360Credentials, D360Error } from '../src/whatsapp/d360-client';

export class FakeClock extends Clock {
  private t: Date;

  constructor(iso: string) {
    super();
    this.t = new Date(iso);
  }

  now(): Date {
    return new Date(this.t);
  }

  set(iso: string): void {
    this.t = new Date(iso);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPayload = any;

export class FakeD360 {
  sent: { creds: D360Credentials; payload: AnyPayload }[] = [];
  webhooks: { creds: D360Credentials; url: string }[] = [];
  sendErrors: D360Error[] = [];
  webhookError: Error | null = null;
  private seq = 0;

  async send(creds: D360Credentials, payload: AnyPayload): Promise<{ waMessageId: string }> {
    const err = this.sendErrors.shift();
    if (err) throw err;
    this.sent.push({ creds, payload });
    this.seq += 1;
    return { waMessageId: `wamid.fake.${this.seq}.${Math.random().toString(36).slice(2)}` };
  }

  async setWebhook(creds: D360Credentials, url: string): Promise<void> {
    if (this.webhookError) throw this.webhookError;
    this.webhooks.push({ creds, url });
  }

  reset(): void {
    this.sent = [];
    this.webhooks = [];
    this.sendErrors = [];
    this.webhookError = null;
  }
}
```

En `apps/api/test/utils.ts`:
- Cambiar `import { Test } from '@nestjs/testing';` por `import { Test, TestingModuleBuilder } from '@nestjs/testing';`.
- Agregar estos imports:
  ```ts
  import { Clock } from '../src/common/clock';
  import { encrypt } from '../src/common/crypto';
  import { D360Client } from '../src/whatsapp/d360-client';
  import { WaAccountStatus, WhatsappAccount } from '../src/whatsapp/whatsapp-account.entity';
  import { FakeClock, FakeD360 } from './fakes';
  ```
- Reemplazar `createTestApp` por:
  ```ts
  export async function createTestApp(
    customize?: (b: TestingModuleBuilder) => TestingModuleBuilder,
  ): Promise<INestApplication> {
    let builder = Test.createTestingModule({ imports: [AppModule] });
    if (customize) builder = customize(builder);
    const moduleRef = await builder.compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    return app;
  }

  export async function createAppWithFakes(
    nowIso = '2026-10-01T12:00:00Z',
  ): Promise<{ app: INestApplication; clock: FakeClock; d360: FakeD360 }> {
    const clock = new FakeClock(nowIso);
    const d360 = new FakeD360();
    const app = await createTestApp((b) => b.overrideProvider(Clock).useValue(clock).overrideProvider(D360Client).useValue(d360));
    return { app, clock, d360 };
  }

  export async function seedWhatsapp(
    app: INestApplication,
    clinicId: string,
    opts: { apiKey?: string; sandbox?: boolean; status?: WaAccountStatus; token?: string; phone?: string } = {},
  ): Promise<WhatsappAccount> {
    const repo = app.get(DataSource).getRepository(WhatsappAccount);
    return repo.save(
      repo.create({
        clinicId,
        phoneNumber: opts.phone ?? '+51900000000',
        sandbox: opts.sandbox ?? false,
        apiKeyEnc: encrypt(opts.apiKey ?? 'key-123'),
        webhookToken: opts.token ?? `tok-${clinicId}`,
        status: opts.status ?? WaAccountStatus.CONNECTED,
      }),
    );
  }
  ```

`apps/api/test/whatsapp-accounts.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { FakeD360 } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedUser } from './utils';

describe('whatsapp accounts (superadmin)', () => {
  let app: INestApplication;
  let d360: FakeD360;
  let root: ReturnType<typeof request.agent>;
  let clinicId: string;

  beforeAll(async () => {
    ({ app, d360 } = await createAppWithFakes());
  });
  beforeEach(async () => {
    d360.reset();
    await resetDb(app);
    clinicId = (await seedClinic(app, 'Sonrisas')).id;
    await seedUser(app, { email: 'root@x.com', password: 'secreta123', role: Role.SUPERADMIN });
    await seedUser(app, { email: 'owner@a.com', password: 'secreta123', role: Role.OWNER, clinicId });
    root = request.agent(app.getHttpServer());
    await root.post('/api/auth/login').send({ email: 'root@x.com', password: 'secreta123' }).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('conecta: cifra la key, registra el webhook y nunca devuelve la key', async () => {
    const res = await root
      .put(`/api/admin/clinics/${clinicId}/whatsapp`)
      .send({ apiKey: 'super-secreta-123', phoneNumber: '987 654 321', sandbox: true, displayName: 'Sonrisas' })
      .expect(200);
    expect(res.body).toEqual({
      phoneNumber: '+51987654321', displayName: 'Sonrisas', sandbox: true, status: 'CONNECTED', lastError: null,
      webhookUrl: expect.stringMatching(/^https:\/\/api\.test\/api\/webhooks\/wa\/[A-Za-z0-9_-]{20,}$/),
    });
    expect(JSON.stringify(res.body)).not.toContain('super-secreta-123');
    expect(d360.webhooks).toEqual([{ creds: { apiKey: 'super-secreta-123', sandbox: true }, url: res.body.webhookUrl }]);
    const [row] = await app.get(DataSource).query('SELECT api_key_enc FROM whatsapp_accounts WHERE clinic_id = $1', [clinicId]);
    expect(row.api_key_enc).not.toContain('super-secreta-123');
    const get = await root.get(`/api/admin/clinics/${clinicId}/whatsapp`).expect(200);
    expect(get.body.account).toEqual(res.body);
  });

  it('reconectar conserva el token del webhook', async () => {
    const a = await root.put(`/api/admin/clinics/${clinicId}/whatsapp`).send({ apiKey: 'clave-uno-123', phoneNumber: '987654321' }).expect(200);
    const b = await root.put(`/api/admin/clinics/${clinicId}/whatsapp`).send({ apiKey: 'clave-dos-456', phoneNumber: '987654321' }).expect(200);
    expect(b.body.webhookUrl).toBe(a.body.webhookUrl);
  });

  it('si 360dialog rechaza el webhook, queda en ERROR con el motivo', async () => {
    d360.webhookError = new Error('Invalid API key');
    const res = await root.put(`/api/admin/clinics/${clinicId}/whatsapp`).send({ apiKey: 'mala-clave-123', phoneNumber: '987654321' }).expect(200);
    expect(res.body).toEqual(expect.objectContaining({ status: 'ERROR', lastError: 'Invalid API key' }));
  });

  it('valida teléfono y consultorio; sin cuenta devuelve null; solo superadmin', async () => {
    await root.put(`/api/admin/clinics/${clinicId}/whatsapp`).send({ apiKey: 'clave-uno-123', phoneNumber: '123' }).expect(400);
    await root.put('/api/admin/clinics/00000000-0000-0000-0000-000000000000/whatsapp').send({ apiKey: 'clave-uno-123', phoneNumber: '987654321' }).expect(404);
    expect((await root.get(`/api/admin/clinics/${clinicId}/whatsapp`).expect(200)).body).toEqual({ account: null });
    const owner = request.agent(app.getHttpServer());
    await owner.post('/api/auth/login').send({ email: 'owner@a.com', password: 'secreta123' }).expect(200);
    await owner.get(`/api/admin/clinics/${clinicId}/whatsapp`).expect(403);
  });
});
```

Run: `npm run test:e2e -w @recep/api -- whatsapp-accounts`
Expected: FAIL (no compila: falta `../src/whatsapp/whatsapp-account.entity` exports usados o la ruta da 404).

- [ ] **Step 2: Implementación**

`apps/api/src/whatsapp/whatsapp.dto.ts`:
```ts
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class ConnectWhatsappDto {
  @IsString() @Length(10, 500) apiKey: string;
  @IsString() @MaxLength(30) phoneNumber: string;
  @IsOptional() @IsBoolean() sandbox?: boolean;
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
}
```

`apps/api/src/whatsapp/whatsapp-accounts.service.ts`:
```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { Clinic } from '../clinics/clinic.entity';
import { decrypt, encrypt } from '../common/crypto';
import { normalizePhone } from '../common/phone';
import { D360Client, D360Credentials } from './d360-client';
import { WaAccountStatus, WhatsappAccount } from './whatsapp-account.entity';
import { ConnectWhatsappDto } from './whatsapp.dto';

export interface WhatsappAccountDto {
  phoneNumber: string;
  displayName: string | null;
  sandbox: boolean;
  status: WaAccountStatus;
  lastError: string | null;
  webhookUrl: string;
}

@Injectable()
export class WhatsappAccountsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly d360: D360Client,
    private readonly config: ConfigService,
  ) {}

  async connect(clinicId: string, dto: ConnectWhatsappDto): Promise<WhatsappAccountDto> {
    if (!(await this.ds.getRepository(Clinic).findOneBy({ id: clinicId }))) throw new NotFoundException('Consultorio no encontrado');
    const phone = normalizePhone(dto.phoneNumber);
    if (!phone) throw new BadRequestException('Teléfono inválido');

    const repo = this.ds.getRepository(WhatsappAccount);
    const account = (await repo.findOneBy({ clinicId })) ?? repo.create({ clinicId, webhookToken: randomBytes(24).toString('base64url') });
    account.phoneNumber = phone;
    account.displayName = dto.displayName?.trim() || null;
    account.sandbox = dto.sandbox ?? false;
    account.apiKeyEnc = encrypt(dto.apiKey);
    account.status = WaAccountStatus.PENDING;
    account.lastError = null;
    await repo.save(account);

    try {
      await this.d360.setWebhook({ apiKey: dto.apiKey, sandbox: account.sandbox }, this.webhookUrl(account));
      account.status = WaAccountStatus.CONNECTED;
    } catch (e) {
      account.status = WaAccountStatus.ERROR;
      account.lastError = (e as Error).message;
    }
    return this.toDto(await repo.save(account));
  }

  async get(clinicId: string): Promise<{ account: WhatsappAccountDto | null }> {
    const account = await this.forClinic(clinicId);
    return { account: account ? this.toDto(account) : null };
  }

  forClinic(clinicId: string): Promise<WhatsappAccount | null> {
    return this.ds.getRepository(WhatsappAccount).findOneBy({ clinicId });
  }

  findByWebhookToken(token: string): Promise<WhatsappAccount | null> {
    return this.ds.getRepository(WhatsappAccount).findOneBy({ webhookToken: token });
  }

  credentials(account: WhatsappAccount): D360Credentials {
    return { apiKey: decrypt(account.apiKeyEnc), sandbox: account.sandbox };
  }

  async markError(clinicId: string, message: string): Promise<void> {
    await this.ds.getRepository(WhatsappAccount).update({ clinicId }, { status: WaAccountStatus.ERROR, lastError: message });
  }

  private webhookUrl(account: WhatsappAccount): string {
    return `${this.config.getOrThrow<string>('PUBLIC_API_URL')}/api/webhooks/wa/${account.webhookToken}`;
  }

  private toDto(a: WhatsappAccount): WhatsappAccountDto {
    return {
      phoneNumber: a.phoneNumber,
      displayName: a.displayName,
      sandbox: a.sandbox,
      status: a.status,
      lastError: a.lastError,
      webhookUrl: this.webhookUrl(a),
    };
  }
}
```

`apps/api/src/whatsapp/admin-whatsapp.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { Role } from '../users/role.enum';
import { WhatsappAccountDto, WhatsappAccountsService } from './whatsapp-accounts.service';
import { ConnectWhatsappDto } from './whatsapp.dto';

@Roles(Role.SUPERADMIN)
@Controller('admin/clinics')
export class AdminWhatsappController {
  constructor(private readonly accounts: WhatsappAccountsService) {}

  @Get(':id/whatsapp')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<{ account: WhatsappAccountDto | null }> {
    return this.accounts.get(id);
  }

  @Put(':id/whatsapp')
  connect(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConnectWhatsappDto): Promise<WhatsappAccountDto> {
    return this.accounts.connect(id, dto);
  }
}
```

`apps/api/src/whatsapp/whatsapp.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AdminWhatsappController } from './admin-whatsapp.controller';
import { D360Client } from './d360-client';
import { WhatsappAccountsService } from './whatsapp-accounts.service';

@Module({
  controllers: [AdminWhatsappController],
  providers: [D360Client, WhatsappAccountsService],
  exports: [D360Client, WhatsappAccountsService],
})
export class WhatsappModule {}
```

En `apps/api/src/app.module.ts`: `import { WhatsappModule } from './whatsapp/whatsapp.module';` y agregar `WhatsappModule` al final de `imports`.

- [ ] **Step 3: Tests pasan**

Run: `npm run test:api`
Expected: PASS (`whatsapp accounts (superadmin)`: 4 tests; el resto sigue verde).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): let superadmin connect a clinic's 360dialog account (encrypted key, webhook registration)"
```

---

### Task 6: Programar y cancelar recordatorios con cada cambio de cita

**Files:**
- Create: `apps/api/src/scheduler/reminder-scheduler.ts`, `apps/api/src/scheduler/scheduler.module.ts`
- Modify (reemplazo completo): `apps/api/src/appointments/appointments.service.ts`, `apps/api/src/appointments/appointments.module.ts`
- Test: `apps/api/test/reminders.e2e-spec.ts`

**Interfaces:**
- Consumes: `Clock`, `Appointment`, `ScheduledKind`, `ScheduledStatus`.
- Produces:
  - `ReminderScheduler.sync(m: EntityManager, appointmentId: string): Promise<void>`
  - En `appointments.service.ts`:
    - `Actor { userId: string | null; source: EventSource }`, `panelActor(user)`, `WHATSAPP_ACTOR`
    - `AppointmentsService.reschedule(clinicId, actor, id, startsAt: Date): Promise<AppointmentDto>`
    - `AppointmentsService.changeStatus(clinicId, actor, id, to: AppointmentStatus): Promise<AppointmentDto>`
    - `AppointmentsService.findWithRelations(clinicId, id): Promise<Appointment | null>`
  - Las rutas existentes no cambian. `AppointmentsModule` exporta `AppointmentsService`.

- [ ] **Step 1: Test (falla)**

`apps/api/test/reminders.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { FakeClock } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedPatient, seedService, seedUser } from './utils';

describe('programación de recordatorios', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let ds: DataSource;
  let recep: ReturnType<typeof request.agent>;
  let patientId: string;
  let serviceId: string;

  const rows = async (apptId: string) =>
    ds.query(
      `SELECT kind, status, send_at, cancel_reason FROM scheduled_messages WHERE appointment_id = $1 ORDER BY kind`,
      [apptId],
    );
  const book = (date: string, time: string) =>
    recep.post('/api/appointments').send({ patientId, serviceId, date, time }).expect(201);

  beforeAll(async () => {
    ({ app, clock } = await createAppWithFakes('2026-10-01T12:00:00Z'));
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    clock.set('2026-10-01T12:00:00Z');
    await resetDb(app);
    const clinic = await seedClinic(app);
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId: clinic.id });
    patientId = (await seedPatient(app, clinic.id)).id;
    serviceId = (await seedService(app, clinic.id)).id;
    recep = request.agent(app.getHttpServer());
    await recep.post('/api/auth/login').send({ email: 'recep@a.com', password: 'secreta123' }).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('crear una cita programa 24 h y 2 h antes', async () => {
    const appt = await book('2026-10-06', '09:30');
    expect(await rows(appt.body.id)).toEqual([
      { kind: 'REMINDER_24H', status: 'PENDING', send_at: new Date('2026-10-05T14:30:00Z'), cancel_reason: null },
      { kind: 'REMINDER_2H', status: 'PENDING', send_at: new Date('2026-10-06T12:30:00Z'), cancel_reason: null },
    ]);
  });

  it('si faltan menos de 24 h solo programa el de 2 h', async () => {
    const appt = await book('2026-10-01', '14:00');
    expect((await rows(appt.body.id)).map((r: { kind: string }) => r.kind)).toEqual(['REMINDER_2H']);
  });

  it('mover la cita reprograma, aunque el recordatorio ya se haya enviado; confirmar no reenvía', async () => {
    const appt = await book('2026-10-06', '09:30');
    await ds.query(`UPDATE scheduled_messages SET status = 'SENT' WHERE appointment_id = $1 AND kind = 'REMINDER_24H'`, [appt.body.id]);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CONFIRMED' }).expect(200);
    expect((await rows(appt.body.id))[0].status).toBe('SENT');
    await recep.patch(`/api/appointments/${appt.body.id}`).send({ date: '2026-10-08', time: '11:00', serviceId }).expect(200);
    expect(await rows(appt.body.id)).toEqual([
      { kind: 'REMINDER_24H', status: 'PENDING', send_at: new Date('2026-10-07T16:00:00Z'), cancel_reason: null },
      { kind: 'REMINDER_2H', status: 'PENDING', send_at: new Date('2026-10-08T14:00:00Z'), cancel_reason: null },
    ]);
  });

  it('cancelar la cita cancela los recordatorios pendientes', async () => {
    const appt = await book('2026-10-06', '09:30');
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CANCELLED' }).expect(200);
    expect((await rows(appt.body.id)).map((r: { status: string; cancel_reason: string }) => [r.status, r.cancel_reason])).toEqual([
      ['CANCELLED', 'Cita CANCELLED'],
      ['CANCELLED', 'Cita CANCELLED'],
    ]);
  });

  it('los bloqueos no programan recordatorios', async () => {
    const block = await recep.post('/api/appointments/blocks').send({ date: '2026-10-06', time: '13:00', endTime: '14:00' }).expect(201);
    expect(await rows(block.body.id)).toEqual([]);
  });
});
```

Run: `npm run test:e2e -w @recep/api -- reminders`
Expected: FAIL (no hay filas en `scheduled_messages`).

- [ ] **Step 2: ReminderScheduler y módulo**

`apps/api/src/scheduler/reminder-scheduler.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Appointment, AppointmentStatus } from '../appointments/appointment.entity';
import { Clock } from '../common/clock';
import { ScheduledKind } from './scheduled-message.entity';

const REMINDERS: [ScheduledKind, number][] = [
  [ScheduledKind.REMINDER_24H, 24 * 60 * 60_000],
  [ScheduledKind.REMINDER_2H, 2 * 60 * 60_000],
];

/**
 * Mantiene `scheduled_messages` al día con el estado de la cita. Se llama dentro de la transacción
 * que modifica la cita. Un recordatorio ya enviado solo se re-programa si cambia su hora de envío.
 */
@Injectable()
export class ReminderScheduler {
  constructor(private readonly clock: Clock) {}

  async sync(m: EntityManager, appointmentId: string): Promise<void> {
    const appt = await m.findOneByOrFail(Appointment, { id: appointmentId });
    const active = !appt.isBlock && (appt.status === AppointmentStatus.SCHEDULED || appt.status === AppointmentStatus.CONFIRMED);
    if (!active) {
      await m.query(
        `UPDATE scheduled_messages SET status = 'CANCELLED', cancel_reason = $2, updated_at = now()
         WHERE appointment_id = $1 AND status = 'PENDING'`,
        [appt.id, `Cita ${appt.status}`],
      );
      return;
    }
    const now = this.clock.now().getTime();
    for (const [kind, offsetMs] of REMINDERS) {
      const sendAt = new Date(appt.startsAt.getTime() - offsetMs);
      if (sendAt.getTime() <= now) {
        await m.query(
          `UPDATE scheduled_messages SET status = 'CANCELLED', cancel_reason = 'La hora de envío ya pasó', updated_at = now()
           WHERE appointment_id = $1 AND kind = $2 AND status = 'PENDING'`,
          [appt.id, kind],
        );
        continue;
      }
      await m.query(
        `INSERT INTO scheduled_messages (clinic_id, kind, appointment_id, send_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (appointment_id, kind) WHERE appointment_id IS NOT NULL DO UPDATE
           SET send_at = EXCLUDED.send_at, status = 'PENDING', attempts = 0, last_error = NULL, cancel_reason = NULL, updated_at = now()
           WHERE scheduled_messages.send_at IS DISTINCT FROM EXCLUDED.send_at AND scheduled_messages.status <> 'SENDING'`,
        [appt.clinicId, kind, appt.id, sendAt],
      );
    }
  }
}
```

`apps/api/src/scheduler/scheduler.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ReminderScheduler } from './reminder-scheduler';

@Module({
  providers: [ReminderScheduler],
  exports: [ReminderScheduler],
})
export class SchedulerModule {}
```

- [ ] **Step 3: AppointmentsService con actor y sincronización (reemplazo completo)**

`apps/api/src/appointments/appointments.service.ts`:
```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/session';
import { ClinicSettingsService } from '../clinics/clinic-settings.service';
import { addDays, daysBetween, zonedToUtc } from '../common/zoned-time';
import { PatientsService } from '../patients/patients.service';
import { ReminderScheduler } from '../scheduler/reminder-scheduler';
import { Service } from '../services/service.entity';
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

/** Quién hace el cambio: un usuario del panel o el paciente por WhatsApp. */
export interface Actor {
  userId: string | null;
  source: EventSource;
}

export const panelActor = (user: AuthUser): Actor => ({ userId: user.id, source: EventSource.PANEL });
export const WHATSAPP_ACTOR: Actor = { userId: null, source: EventSource.WHATSAPP };

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
const STALE_MSG = 'La cita cambió mientras la editabas; recarga la agenda e inténtalo de nuevo';
const ACTIVE = [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED];

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: ClinicSettingsService,
    private readonly services: ServicesService,
    private readonly patients: PatientsService,
    private readonly reminders: ReminderScheduler,
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
    // Un bloqueo quitado no aporta nada en la agenda; las citas canceladas sí se muestran (tachadas).
    return rows.filter((a) => !(a.isBlock && a.status === AppointmentStatus.CANCELLED)).map(toDto);
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

  findWithRelations(clinicId: string, id: string): Promise<Appointment | null> {
    return this.ds.getRepository(Appointment).findOne({ where: { id, clinicId }, relations: { patient: true, service: true } });
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
      await this.logEvent(m, appt, panelActor(user), AppointmentEventType.CREATED);
      await this.reminders.sync(m, appt.id);
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
      await this.logEvent(m, appt, panelActor(user), AppointmentEventType.CREATED, { block: true });
      return appt.id;
    });
    return this.getDto(clinicId, id);
  }

  async update(user: AuthUser, id: string, dto: UpdateAppointmentDto): Promise<AppointmentDto> {
    const clinicId = user.clinicId!;
    const appt = await this.findEditable(clinicId, id);
    const service = await this.services.findInClinic(clinicId, dto.serviceId);
    if (!service.active && service.id !== appt.serviceId) throw new BadRequestException('El servicio está desactivado');
    const startsAt = zonedToUtc(dto.date, dto.time, await this.settings.getTimezone(clinicId));
    return this.applyMove(clinicId, panelActor(user), appt, startsAt, service);
  }

  /** Mueve la cita a `startsAt` manteniendo su servicio (usado por la reprogramación por WhatsApp). */
  async reschedule(clinicId: string, actor: Actor, id: string, startsAt: Date): Promise<AppointmentDto> {
    const appt = await this.findEditable(clinicId, id);
    const service = await this.services.findInClinic(clinicId, appt.serviceId!);
    return this.applyMove(clinicId, actor, appt, startsAt, service);
  }

  setStatus(user: AuthUser, id: string, dto: SetStatusDto): Promise<AppointmentDto> {
    return this.changeStatus(user.clinicId!, panelActor(user), id, dto.status as AppointmentStatus);
  }

  async changeStatus(clinicId: string, actor: Actor, id: string, to: AppointmentStatus): Promise<AppointmentDto> {
    const appt = await this.findInClinic(clinicId, id);
    if (!canTransition(appt.status, to, appt.isBlock)) {
      throw new BadRequestException(`No se puede pasar de ${appt.status} a ${to}`);
    }
    await this.ds.transaction(async (m) => {
      // Condicionado al estado leído: si otro usuario (o el webhook) lo cambió entretanto, no se pisa.
      const result = await m.update(Appointment, { id, clinicId, status: appt.status }, { status: to, calendarDirty: true });
      if (!result.affected) throw new ConflictException(STALE_MSG);
      await this.logEvent(m, appt, actor, to as unknown as AppointmentEventType, { from: appt.status });
      await this.reminders.sync(m, id);
    });
    return this.getDto(clinicId, id);
  }

  private async applyMove(clinicId: string, actor: Actor, appt: Appointment, startsAt: Date, service: Service): Promise<AppointmentDto> {
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
    const moved = startsAt.getTime() !== appt.startsAt.getTime();
    const before = { startsAt: appt.startsAt.toISOString(), serviceId: appt.serviceId };
    await this.ds.transaction(async (m) => {
      const result = await m.update(Appointment, { id: appt.id, clinicId, status: appt.status }, {
        startsAt,
        endsAt,
        serviceId: service.id,
        status: moved ? AppointmentStatus.SCHEDULED : appt.status,
        calendarDirty: true,
      });
      if (!result.affected) throw new ConflictException(STALE_MSG);
      await this.logEvent(m, appt, actor, moved ? AppointmentEventType.RESCHEDULED : AppointmentEventType.UPDATED, {
        from: before,
        to: { startsAt: startsAt.toISOString(), serviceId: service.id },
      });
      await this.reminders.sync(m, appt.id);
    });
    return this.getDto(clinicId, appt.id);
  }

  private async findEditable(clinicId: string, id: string): Promise<Appointment> {
    const appt = await this.findInClinic(clinicId, id);
    if (appt.isBlock) throw new BadRequestException('Los bloqueos no se editan; elimínalo y crea otro');
    if (!ACTIVE.includes(appt.status)) throw new BadRequestException('Solo se pueden editar citas programadas o confirmadas');
    return appt;
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
    actor: Actor,
    type: AppointmentEventType,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await m.save(
      m.create(AppointmentEvent, {
        appointmentId: appt.id, clinicId: appt.clinicId, type, source: actor.source, actorUserId: actor.userId, data,
      }),
    );
  }
}
```

`apps/api/src/appointments/appointments.module.ts` (reemplazo completo):
```ts
import { Module } from '@nestjs/common';
import { ClinicsModule } from '../clinics/clinics.module';
import { PatientsModule } from '../patients/patients.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { ServicesModule } from '../services/services.module';
import { AppointmentsController, PatientAppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [ClinicsModule, ServicesModule, PatientsModule, SchedulerModule],
  controllers: [AppointmentsController, PatientAppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
```

- [ ] **Step 4: Tests pasan**

Run: `npm run test:api`
Expected: PASS (`programación de recordatorios`: 5 tests; `appointments` y `appointments-race` siguen verdes).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): schedule and cancel 24h/2h reminders with every appointment change"
```

---

### Task 7: Despachador de recordatorios (cron cada minuto)

**Files:**
- Create: `apps/api/src/whatsapp/messages.service.ts`, `apps/api/src/scheduler/reminder-dispatcher.ts`
- Modify: `apps/api/src/whatsapp/whatsapp.module.ts` (provee/exporta `MessagesService`), `apps/api/src/scheduler/scheduler.module.ts` (importa `WhatsappModule`, provee `ReminderDispatcher`), `apps/api/src/app.module.ts` (`ScheduleModule.forRoot()`, `SchedulerModule`)
- Test: `apps/api/test/dispatcher.e2e-spec.ts`

**Interfaces:**
- Consumes: `Clock`, `D360Client`, `D360Error`, `WhatsappAccountsService`, `reminder24h`, `reminder2h`, `fmtDateEs`, `fmtTimeEs`, `firstName`.
- Produces:
  - `MessagesService.recordOutbound(data: { clinicId; patientId: string|null; waMessageId; type; payload; scheduledMessageId?: string|null }, m?: EntityManager): Promise<void>`
  - `ReminderDispatcher.runOnce(): Promise<number>`, `recoverStale(): Promise<number>`
  - Cron `@Cron(EVERY_MINUTE)`, que no hace nada si `SCHEDULER_ENABLED=false`.

- [ ] **Step 1: Instalar `@nestjs/schedule`**

Run: `npm i -w @recep/api @nestjs/schedule@^6`
Expected: se instala sin errores de peer. Si npm reporta un conflicto de peer con Nest 11, usar `@nestjs/schedule@^5` y registrar un `Ruling` en el ledger.

- [ ] **Step 2: Test (falla)**

`apps/api/test/dispatcher.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ReminderDispatcher } from '../src/scheduler/reminder-dispatcher';
import { Role } from '../src/users/role.enum';
import { D360Error } from '../src/whatsapp/d360-client';
import { FakeClock, FakeD360 } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedPatient, seedService, seedUser, seedWhatsapp } from './utils';

describe('despachador de recordatorios', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let d360: FakeD360;
  let ds: DataSource;
  let dispatcher: ReminderDispatcher;
  let clinicId: string;
  let patientId: string;
  let apptId: string;

  const statusOf = async (kind: string) =>
    (await ds.query(`SELECT status, attempts, send_at, last_error, cancel_reason FROM scheduled_messages WHERE appointment_id = $1 AND kind = $2`, [apptId, kind]))[0];

  beforeAll(async () => {
    ({ app, clock, d360 } = await createAppWithFakes());
    ds = app.get(DataSource);
    dispatcher = app.get(ReminderDispatcher);
  });
  beforeEach(async () => {
    clock.set('2026-10-01T12:00:00Z');
    d360.reset();
    await resetDb(app);
    const clinic = await seedClinic(app, 'Sonrisas');
    clinicId = clinic.id;
    await ds.query(`UPDATE clinics SET address = 'Av. Larco 123' WHERE id = $1`, [clinicId]);
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId });
    patientId = (await seedPatient(app, clinicId, { fullName: 'Juan Pérez', phone: '+51987654321' })).id;
    const serviceId = (await seedService(app, clinicId)).id;
    await seedWhatsapp(app, clinicId, { apiKey: 'key-123' });
    const recep = request.agent(app.getHttpServer());
    await recep.post('/api/auth/login').send({ email: 'recep@a.com', password: 'secreta123' }).expect(200);
    // viernes 2 de octubre 09:30 Lima = 14:30Z → 24h: 2026-10-01T14:30Z, 2h: 2026-10-02T12:30Z
    apptId = (await recep.post('/api/appointments').send({ patientId, serviceId, date: '2026-10-02', time: '09:30' }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('no envía antes de tiempo; a su hora envía la plantilla y registra el mensaje', async () => {
    expect(await dispatcher.runOnce()).toBe(0);
    clock.set('2026-10-01T14:31:00Z');
    expect(await dispatcher.runOnce()).toBe(1);
    expect(d360.sent).toHaveLength(1);
    const { creds, payload } = d360.sent[0];
    expect(creds).toEqual({ apiKey: 'key-123', sandbox: false });
    expect(payload.to).toBe('51987654321');
    expect(payload.template.name).toBe('recordatorio_cita_24h');
    expect(payload.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      'Juan', 'Sonrisas', 'viernes 2 de octubre', '09:30',
    ]);
    expect((await statusOf('REMINDER_24H')).status).toBe('SENT');
    const [msg] = await ds.query(`SELECT direction, status, type, wa_message_id, patient_id FROM messages`);
    expect(msg).toEqual(expect.objectContaining({ direction: 'OUT', status: 'SENT', type: 'template', patient_id: patientId }));
    expect(msg.wa_message_id).toMatch(/^wamid\.fake\./);
  });

  it('el de 2 h usa la dirección; se omite si ya confirmó (salvo que el consultorio lo pida)', async () => {
    await ds.query(`UPDATE appointments SET status = 'CONFIRMED' WHERE id = $1`, [apptId]);
    clock.set('2026-10-02T12:31:00Z');
    await dispatcher.runOnce();
    expect((await statusOf('REMINDER_2H')).cancel_reason).toBe('Ya confirmó');
    expect(d360.sent.filter((s) => s.payload.template.name === 'recordatorio_cita_2h')).toHaveLength(0);

    await ds.query(`UPDATE scheduled_messages SET status = 'PENDING', cancel_reason = NULL WHERE appointment_id = $1 AND kind = 'REMINDER_2H'`, [apptId]);
    await ds.query(`UPDATE clinics SET send_2h_to_confirmed = true WHERE id = $1`, [clinicId]);
    await dispatcher.runOnce();
    const sent2h = d360.sent.find((s) => s.payload.template.name === 'recordatorio_cita_2h');
    expect(sent2h!.payload.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(['Juan', '09:30', 'Av. Larco 123']);
  });

  it('cancela con motivo: sin consentimiento, suscripción suspendida, WhatsApp desconectado', async () => {
    clock.set('2026-10-01T14:31:00Z');
    await ds.query(`UPDATE patients SET whatsapp_opt_in = false WHERE id = $1`, [patientId]);
    await dispatcher.runOnce();
    expect(await statusOf('REMINDER_24H')).toEqual(expect.objectContaining({ status: 'CANCELLED', cancel_reason: 'Paciente sin consentimiento' }));

    await ds.query(`UPDATE patients SET whatsapp_opt_in = true WHERE id = $1`, [patientId]);
    await ds.query(`UPDATE clinics SET subscription_status = 'SUSPENDED' WHERE id = $1`, [clinicId]);
    await ds.query(`UPDATE scheduled_messages SET status = 'PENDING' WHERE appointment_id = $1 AND kind = 'REMINDER_24H'`, [apptId]);
    await dispatcher.runOnce();
    expect((await statusOf('REMINDER_24H')).cancel_reason).toBe('Suscripción suspendida');

    await ds.query(`UPDATE clinics SET subscription_status = 'ACTIVE' WHERE id = $1`, [clinicId]);
    await ds.query(`UPDATE whatsapp_accounts SET status = 'ERROR' WHERE clinic_id = $1`, [clinicId]);
    await ds.query(`UPDATE scheduled_messages SET status = 'PENDING' WHERE appointment_id = $1 AND kind = 'REMINDER_24H'`, [apptId]);
    await dispatcher.runOnce();
    expect((await statusOf('REMINDER_24H')).cancel_reason).toBe('WhatsApp no conectado');
    expect(d360.sent).toHaveLength(0);
  });

  it('reintenta a los 5 y 15 min y falla al tercer error', async () => {
    clock.set('2026-10-01T14:31:00Z');
    d360.sendErrors.push(new D360Error(503, 'caído'), new D360Error(503, 'caído'), new D360Error(503, 'caído'));
    await dispatcher.runOnce();
    expect(await statusOf('REMINDER_24H')).toEqual(expect.objectContaining({
      status: 'PENDING', attempts: 1, last_error: 'caído', send_at: new Date('2026-10-01T14:36:00Z'),
    }));
    clock.set('2026-10-01T14:36:00Z');
    await dispatcher.runOnce();
    expect(await statusOf('REMINDER_24H')).toEqual(expect.objectContaining({ attempts: 2, send_at: new Date('2026-10-01T14:51:00Z') }));
    clock.set('2026-10-01T14:51:00Z');
    await dispatcher.runOnce();
    expect(await statusOf('REMINDER_24H')).toEqual(expect.objectContaining({ status: 'FAILED', attempts: 3 }));
  });

  it('un 401 falla de inmediato y marca la cuenta en ERROR', async () => {
    clock.set('2026-10-01T14:31:00Z');
    d360.sendErrors.push(new D360Error(401, 'Invalid API key'));
    await dispatcher.runOnce();
    expect((await statusOf('REMINDER_24H')).status).toBe('FAILED');
    const [acc] = await ds.query(`SELECT status, last_error FROM whatsapp_accounts WHERE clinic_id = $1`, [clinicId]);
    expect(acc).toEqual({ status: 'ERROR', last_error: 'Invalid API key' });
  });

  it('dos despachadores a la vez envían una sola vez', async () => {
    clock.set('2026-10-01T14:31:00Z');
    const [a, b] = await Promise.all([dispatcher.runOnce(), dispatcher.runOnce()]);
    expect(a + b).toBe(1);
    expect(d360.sent).toHaveLength(1);
  });

  it('recupera envíos que quedaron en SENDING hace más de 10 min', async () => {
    await ds.query(`UPDATE scheduled_messages SET status = 'SENDING', updated_at = '2026-10-01T11:00:00Z' WHERE appointment_id = $1 AND kind = 'REMINDER_24H'`, [apptId]);
    expect(await dispatcher.recoverStale()).toBe(1);
    expect((await statusOf('REMINDER_24H')).status).toBe('PENDING');
  });
});
```

Run: `npm run test:e2e -w @recep/api -- dispatcher`
Expected: FAIL ("Cannot find module '../src/scheduler/reminder-dispatcher'").

- [ ] **Step 3: MessagesService y ReminderDispatcher**

`apps/api/src/whatsapp/messages.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Message, MessageDirection, MessageStatus } from './message.entity';

@Injectable()
export class MessagesService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async recordOutbound(
    data: {
      clinicId: string;
      patientId: string | null;
      waMessageId: string;
      type: string;
      payload: object;
      scheduledMessageId?: string | null;
    },
    m: EntityManager = this.ds.manager,
  ): Promise<void> {
    await m.insert(Message, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      direction: MessageDirection.OUT,
      waMessageId: data.waMessageId,
      type: data.type,
      payload: data.payload as Record<string, unknown>,
      status: MessageStatus.SENT,
      scheduledMessageId: data.scheduledMessageId ?? null,
    });
  }
}
```

`apps/api/src/scheduler/reminder-dispatcher.ts`:
```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Appointment, AppointmentStatus } from '../appointments/appointment.entity';
import { Clinic, SubscriptionStatus } from '../clinics/clinic.entity';
import { Clock } from '../common/clock';
import { firstName, fmtDateEs, fmtTimeEs } from '../common/format-es';
import { D360Client, D360Credentials, D360Error } from '../whatsapp/d360-client';
import { reminder24h, reminder2h } from '../whatsapp/message-builders';
import { MessagesService } from '../whatsapp/messages.service';
import { WaAccountStatus, WhatsappAccount } from '../whatsapp/whatsapp-account.entity';
import { WhatsappAccountsService } from '../whatsapp/whatsapp-accounts.service';
import { ScheduledKind, ScheduledMessage, ScheduledStatus } from './scheduled-message.entity';

const MAX_ATTEMPTS = 3;
const BACKOFF_MIN = [5, 15];
const BATCH = 50;
const STALE_MS = 10 * 60_000;

interface Context {
  clinic: Clinic;
  appt: Appointment | null;
  account: WhatsappAccount | null;
}

/** TypeORM devuelve [filas, n] para UPDATE … RETURNING en Postgres. */
const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) && Array.isArray(res[0]) ? (res[0] as T[]) : (res as T[]));

@Injectable()
export class ReminderDispatcher implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReminderDispatcher.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: Clock,
    private readonly d360: D360Client,
    private readonly accounts: WhatsappAccountsService,
    private readonly messages: MessagesService,
  ) {}

  private get enabled(): boolean {
    return process.env.SCHEDULER_ENABLED !== 'false';
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.enabled) await this.recoverStale();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.runOnce();
    } catch (e) {
      this.logger.error(e);
    }
  }

  async recoverStale(): Promise<number> {
    const res = await this.ds.query(
      `UPDATE scheduled_messages SET status = 'PENDING', updated_at = now()
       WHERE status = 'SENDING' AND updated_at < $1 RETURNING id`,
      [new Date(this.clock.now().getTime() - STALE_MS)],
    );
    return rowsOf(res).length;
  }

  async runOnce(): Promise<number> {
    const res = await this.ds.query(
      `UPDATE scheduled_messages SET status = 'SENDING', updated_at = now()
       WHERE id IN (
         SELECT id FROM scheduled_messages WHERE status = 'PENDING' AND send_at <= $1
         ORDER BY send_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
       ) RETURNING id`,
      [this.clock.now()],
    );
    const ids = rowsOf<{ id: string }>(res).map((r) => r.id);
    for (const id of ids) await this.process(id);
    return ids.length;
  }

  private async process(id: string): Promise<void> {
    const sm = await this.ds.getRepository(ScheduledMessage).findOneByOrFail({ id });
    const ctx = await this.loadContext(sm);
    const reason = this.skipReason(sm, ctx);
    if (reason) {
      await this.ds.getRepository(ScheduledMessage).update({ id }, { status: ScheduledStatus.CANCELLED, cancelReason: reason });
      return;
    }
    let creds: D360Credentials;
    try {
      creds = this.accounts.credentials(ctx.account!);
      const payload = this.buildPayload(sm, ctx, creds.sandbox);
      const { waMessageId } = await this.d360.send(creds, payload);
      await this.ds.transaction(async (m) => {
        await m.update(ScheduledMessage, { id }, { status: ScheduledStatus.SENT, lastError: null });
        await this.messages.recordOutbound(
          { clinicId: sm.clinicId, patientId: ctx.appt?.patientId ?? null, waMessageId, type: 'template', payload, scheduledMessageId: id },
          m,
        );
      });
    } catch (e) {
      await this.fail(sm, e);
    }
  }

  private async loadContext(sm: ScheduledMessage): Promise<Context> {
    const clinic = await this.ds.getRepository(Clinic).findOneByOrFail({ id: sm.clinicId });
    const appt = sm.appointmentId
      ? await this.ds.getRepository(Appointment).findOne({ where: { id: sm.appointmentId }, relations: { patient: true, service: true } })
      : null;
    return { clinic, appt, account: await this.accounts.forClinic(sm.clinicId) };
  }

  private skipReason(sm: ScheduledMessage, { clinic, appt, account }: Context): string | null {
    if (clinic.subscriptionStatus === SubscriptionStatus.SUSPENDED) return 'Suscripción suspendida';
    if (!account || account.status !== WaAccountStatus.CONNECTED) return 'WhatsApp no conectado';
    if (sm.kind === ScheduledKind.PAYMENT_REMINDER) return 'Recordatorio de pago no disponible todavía';
    if (!appt || appt.isBlock || !appt.patient || ![AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED].includes(appt.status)) {
      return 'Cita no vigente';
    }
    if (!appt.patient.whatsappOptIn) return 'Paciente sin consentimiento';
    if (sm.kind === ScheduledKind.REMINDER_2H && appt.status === AppointmentStatus.CONFIRMED && !clinic.send2hToConfirmed) {
      return 'Ya confirmó';
    }
    return null;
  }

  private buildPayload(sm: ScheduledMessage, { clinic, appt }: Context, sandbox: boolean): object {
    const a = appt!;
    const common = { to: a.patient!.phoneE164, patientName: firstName(a.patient!.fullName), appointmentId: a.id, sandbox };
    const timeText = fmtTimeEs(a.startsAt, clinic.timezone);
    if (sm.kind === ScheduledKind.REMINDER_24H) {
      return reminder24h({ ...common, clinicName: clinic.name, dateText: fmtDateEs(a.startsAt, clinic.timezone), timeText });
    }
    return reminder2h({ ...common, timeText, place: clinic.address ?? clinic.name });
  }

  private async fail(sm: ScheduledMessage, e: unknown): Promise<void> {
    const attempts = sm.attempts + 1;
    const message = (e as Error).message ?? String(e);
    const unauthorized = e instanceof D360Error && e.status === 401;
    if (unauthorized) await this.accounts.markError(sm.clinicId, message);
    const retryable = !(e instanceof D360Error) || e.retryable;
    const repo = this.ds.getRepository(ScheduledMessage);
    if (retryable && !unauthorized && attempts < MAX_ATTEMPTS) {
      const sendAt = new Date(this.clock.now().getTime() + BACKOFF_MIN[attempts - 1] * 60_000);
      await repo.update({ id: sm.id }, { status: ScheduledStatus.PENDING, attempts, lastError: message, sendAt });
    } else {
      await repo.update({ id: sm.id }, { status: ScheduledStatus.FAILED, attempts, lastError: message });
    }
  }
}
```

`apps/api/src/whatsapp/whatsapp.module.ts`: agregar `MessagesService` (con su import) a `providers` y a `exports`.

`apps/api/src/scheduler/scheduler.module.ts` (reemplazo completo):
```ts
import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ReminderDispatcher } from './reminder-dispatcher';
import { ReminderScheduler } from './reminder-scheduler';

@Module({
  imports: [WhatsappModule],
  providers: [ReminderScheduler, ReminderDispatcher],
  exports: [ReminderScheduler],
})
export class SchedulerModule {}
```

En `apps/api/src/app.module.ts`:
- Agregar `import { ScheduleModule } from '@nestjs/schedule';` y `import { SchedulerModule } from './scheduler/scheduler.module';`.
- Agregar `ScheduleModule.forRoot()` justo después de `CommonModule` en `imports`, y `SchedulerModule` al final.

- [ ] **Step 4: Tests pasan**

Run: `npm run test:api`
Expected: PASS (`despachador de recordatorios`: 7 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add minute cron dispatcher that sends due reminders via 360dialog with retries"
```

---

### Task 8: Webhook y conversación (Confirmar, Cancelar, Reprogramar y Elegir horario)

**Files:**
- Modify: `apps/api/src/whatsapp/messages.service.ts` (agregar `recordInbound`, `updateStatus`)
- Create: `apps/api/src/conversation/conversation.service.ts`, `webhook.controller.ts`, `conversation.module.ts`
- Modify: `apps/api/src/app.module.ts` (importar `ConversationModule`)
- Test: `apps/api/test/webhook.e2e-spec.ts`

**Interfaces:**
- Consumes:
  - `parseWebhook`, `InboundMessage`, `WhatsappAccountsService.findByWebhookToken` / `credentials`
  - `AppointmentsService.findWithRelations` / `changeStatus` / `reschedule`, `WHATSAPP_ACTOR`, `canTransition`
  - `ClinicSettingsService.get` / `hours`, `freeSlots`, `localParts`, `addDays`
  - `fmtDateEs`, `fmtTimeEs`, `fmtSlotLabel`, `textMessage`, `slotList`, `D360Client`
- Produces:
  - `POST /api/webhooks/wa/:token` (público) → 200 `{ ok: true }`, o 404 si el token es desconocido.
  - `MessagesService.recordInbound(data): Promise<boolean>` (false si el `wa_message_id` ya existía).
  - `MessagesService.updateStatus(waId, status): Promise<void>` (solo avanza; FAILED siempre se aplica).

- [ ] **Step 1: Test (falla)**

`apps/api/test/webhook.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { FakeClock, FakeD360 } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedHours, seedPatient, seedService, seedWhatsapp } from './utils';

describe('webhook y conversación', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let d360: FakeD360;
  let ds: DataSource;
  let clinicId: string;
  let apptId: string;
  let otherApptId: string;
  let foreignApptId: string;
  const TOKEN = 'tok-webhook-test';
  const FROM = '51987654321';

  let seq = 0;
  const post = (body: unknown, token = TOKEN) => request(app.getHttpServer()).post(`/api/webhooks/wa/${token}`).send(body);
  const tap = (payload: string, from = FROM, id = `wamid.in.${++seq}`) =>
    post({ entry: [{ changes: [{ value: { messages: [{ from, id, type: 'button', button: { text: 'x', payload } }] } }] }] });
  const pick = (payload: string) =>
    post({ entry: [{ changes: [{ value: { messages: [{ from: FROM, id: `wamid.in.${++seq}`, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: payload, title: 't' } } }] } }] }] });
  const apptRow = async (id: string) => (await ds.query('SELECT status, starts_at FROM appointments WHERE id = $1', [id]))[0];
  const events = async (id: string) => ds.query('SELECT type, source, actor_user_id FROM appointment_events WHERE appointment_id = $1 ORDER BY created_at', [id]);
  const insertAppt = async (clinic: string, patient: string, service: string, starts: string, ends: string) =>
    (await ds.query(
      `INSERT INTO appointments (clinic_id, patient_id, service_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [clinic, patient, service, starts, ends],
    ))[0].id;

  beforeAll(async () => {
    ({ app, clock, d360 } = await createAppWithFakes());
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    clock.set('2026-10-05T12:00:00Z'); // lunes 07:00 Lima → "mañana" = martes 6
    d360.reset();
    await resetDb(app);
    clinicId = (await seedClinic(app, 'Sonrisas')).id;
    await seedWhatsapp(app, clinicId, { token: TOKEN });
    await seedHours(app, clinicId, [{ weekday: 2, opensAt: '09:00', closesAt: '11:00' }]);
    const service = await seedService(app, clinicId, 'Limpieza', 30);
    const juan = await seedPatient(app, clinicId, { fullName: 'Juan Pérez', phone: `+${FROM}` });
    const ana = await seedPatient(app, clinicId, { fullName: 'Ana', phone: '+51911111111' });
    apptId = await insertAppt(clinicId, juan.id, service.id, '2026-10-06T14:30:00Z', '2026-10-06T15:00:00Z'); // 09:30
    otherApptId = await insertAppt(clinicId, ana.id, service.id, '2026-10-06T15:00:00Z', '2026-10-06T15:30:00Z'); // 10:00
    const other = await seedClinic(app, 'Otra');
    const otherPatient = await seedPatient(app, other.id, { phone: `+${FROM}` });
    const otherService = await seedService(app, other.id);
    foreignApptId = await insertAppt(other.id, otherPatient.id, otherService.id, '2026-10-06T14:30:00Z', '2026-10-06T15:00:00Z');
  });
  afterAll(async () => { await app.close(); });

  it('token desconocido → 404; válido → 200 { ok: true }', async () => {
    await post({}, 'no-existe').expect(404);
    await post({}).expect(200).expect({ ok: true });
  });

  it('CONFIRM confirma, registra evento WHATSAPP y responde; repetido se procesa una vez', async () => {
    const body = { entry: [{ changes: [{ value: { messages: [{ from: FROM, id: 'wamid.dup', type: 'button', button: { payload: `CONFIRM:${apptId}` } }] } }] }] };
    await post(body).expect(200);
    await post(body).expect(200);
    expect((await apptRow(apptId)).status).toBe('CONFIRMED');
    expect(await events(apptId)).toEqual([{ type: 'CONFIRMED', source: 'WHATSAPP', actor_user_id: null }]);
    expect(d360.sent).toHaveLength(1);
    expect(d360.sent[0].payload.text.body).toBe('✅ ¡Confirmado! Te esperamos el martes 6 de octubre a las 09:30.');
    const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM messages WHERE direction = 'IN'`);
    expect(count).toBe(1);
  });

  it('CANCEL cancela y cancela los recordatorios', async () => {
    await ds.query(`INSERT INTO scheduled_messages (clinic_id, kind, appointment_id, send_at) VALUES ($1, 'REMINDER_2H', $2, '2026-10-06T12:30:00Z')`, [clinicId, apptId]);
    await tap(`CANCEL:${apptId}`).expect(200);
    expect((await apptRow(apptId)).status).toBe('CANCELLED');
    const [sm] = await ds.query(`SELECT status FROM scheduled_messages WHERE appointment_id = $1`, [apptId]);
    expect(sm.status).toBe('CANCELLED');
    expect(d360.sent[0].payload.text.body).toBe('Tu cita fue cancelada. Si quieres agendar otra, escríbenos.');
  });

  it('ignora botones desde otro teléfono o de citas de otro consultorio', async () => {
    await tap(`CONFIRM:${apptId}`, '51900000001').expect(200);
    await tap(`CONFIRM:${foreignApptId}`).expect(200);
    expect((await apptRow(apptId)).status).toBe('SCHEDULED');
    expect((await apptRow(foreignApptId)).status).toBe('SCHEDULED');
    expect(d360.sent).toHaveLength(0);
  });

  it('RESCHEDULE envía la lista de horarios libres (sin el ocupado por otra cita)', async () => {
    await tap(`RESCHEDULE:${apptId}`).expect(200);
    const rows = d360.sent[0].payload.interactive.action.sections[0].rows;
    expect(rows.map((r: { id: string }) => r.id)).toEqual([
      `PICK:${apptId}:2026-10-06T14:00:00.000Z`,
      `PICK:${apptId}:2026-10-06T14:30:00.000Z`,
      `PICK:${apptId}:2026-10-06T15:30:00.000Z`,
    ]);
    expect(rows[0].title).toBe('mar 06/10 09:00');
  });

  it('PICK válido mueve la cita, la deja programada y responde', async () => {
    await pick(`PICK:${apptId}:2026-10-06T15:30:00.000Z`).expect(200);
    const row = await apptRow(apptId);
    expect(row).toEqual({ status: 'SCHEDULED', starts_at: new Date('2026-10-06T15:30:00Z') });
    expect((await events(apptId)).map((e: { type: string; source: string }) => [e.type, e.source])).toEqual([['RESCHEDULED', 'WHATSAPP']]);
    expect(d360.sent[0].payload.text.body).toBe('📅 Listo, tu cita quedó para el martes 6 de octubre a las 10:30.');
  });

  it('PICK manipulado (ocupado o fuera de horario) no mueve la cita y reenvía la lista', async () => {
    await pick(`PICK:${apptId}:2026-10-06T15:00:00.000Z`).expect(200);
    await pick(`PICK:${apptId}:2026-10-06T20:00:00.000Z`).expect(200);
    expect((await apptRow(apptId)).starts_at).toEqual(new Date('2026-10-06T14:30:00Z'));
    expect(d360.sent).toHaveLength(2);
    expect(d360.sent.every((s) => s.payload.type === 'interactive')).toBe(true);
    expect(d360.sent[0].payload.interactive.body.text).toBe('Ese horario ya no está disponible. Elige otro:');
  });

  it('cita ya cancelada: responde que no está activa', async () => {
    await ds.query(`UPDATE appointments SET status = 'CANCELLED' WHERE id = $1`, [apptId]);
    await tap(`CONFIRM:${apptId}`).expect(200);
    expect(d360.sent[0].payload.text.body).toBe('Esta cita ya no está activa. Si necesitas una nueva, escríbenos.');
  });

  it('texto libre se guarda sin responder; formato v1 también se acepta', async () => {
    await post({ messages: [{ from: FROM, id: 'wamid.v1', type: 'text', text: { body: 'Hola, ¿atienden el sábado?' } }] }).expect(200);
    const [msg] = await ds.query(`SELECT direction, type, payload FROM messages WHERE wa_message_id = 'wamid.v1'`);
    expect(msg).toEqual(expect.objectContaining({ direction: 'IN', type: 'text' }));
    expect(d360.sent).toHaveLength(0);
  });

  it('estados de entrega solo avanzan; FAILED siempre se registra', async () => {
    await ds.query(`INSERT INTO messages (clinic_id, direction, wa_message_id, type, status) VALUES ($1, 'OUT', 'wamid.out', 'template', 'SENT')`, [clinicId]);
    const status = (s: string) => post({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.out', status: s }] } }] }] }).expect(200);
    const current = async () => (await ds.query(`SELECT status FROM messages WHERE wa_message_id = 'wamid.out'`))[0].status;
    await status('read');
    expect(await current()).toBe('READ');
    await status('delivered');
    expect(await current()).toBe('READ');
    await status('failed');
    expect(await current()).toBe('FAILED');
  });
});
```

Run: `npm run test:e2e -w @recep/api -- webhook`
Expected: FAIL (404 en `/api/webhooks/wa/...`).

- [ ] **Step 2: MessagesService (entrantes y estados)**

Agregar a la clase `MessagesService` en `apps/api/src/whatsapp/messages.service.ts`:
```ts
  /** Guarda un mensaje entrante. Devuelve false si ese wa_message_id ya se había procesado. */
  async recordInbound(data: { clinicId: string; patientId: string | null; waMessageId: string; type: string; payload: object }): Promise<boolean> {
    const res = await this.ds.query(
      `INSERT INTO messages (clinic_id, patient_id, direction, wa_message_id, type, payload)
       VALUES ($1, $2, 'IN', $3, $4, $5) ON CONFLICT (wa_message_id) DO NOTHING RETURNING id`,
      [data.clinicId, data.patientId, data.waMessageId, data.type, JSON.stringify(data.payload)],
    );
    return res.length > 0;
  }

  /** SENT → DELIVERED → READ solo avanzan; FAILED se aplica siempre. */
  async updateStatus(waMessageId: string, status: MessageStatus): Promise<void> {
    await this.ds.query(
      `UPDATE messages SET status = $2::message_status, updated_at = now()
       WHERE wa_message_id = $1 AND direction = 'OUT' AND (
         $2::message_status = 'FAILED' OR status IS NULL OR
         array_position(ARRAY['SENT','DELIVERED','READ']::message_status[], status) <
         array_position(ARRAY['SENT','DELIVERED','READ']::message_status[], $2::message_status)
       )`,
      [waMessageId, status],
    );
  }
```

- [ ] **Step 3: ConversationService, WebhookController y módulo**

`apps/api/src/conversation/conversation.service.ts`:
```ts
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThan, MoreThan, Not } from 'typeorm';
import { canTransition } from '../appointments/appointment-status';
import { Appointment, AppointmentStatus } from '../appointments/appointment.entity';
import { AppointmentsService, WHATSAPP_ACTOR } from '../appointments/appointments.service';
import { freeSlots } from '../appointments/free-slots';
import { ClinicSettings, ClinicSettingsService } from '../clinics/clinic-settings.service';
import { Clock } from '../common/clock';
import { fmtDateEs, fmtSlotLabel, fmtTimeEs } from '../common/format-es';
import { addDays, localParts } from '../common/zoned-time';
import { Patient } from '../patients/patient.entity';
import { D360Client } from '../whatsapp/d360-client';
import { slotList, textMessage } from '../whatsapp/message-builders';
import { MessagesService } from '../whatsapp/messages.service';
import { InboundMessage } from '../whatsapp/parse-webhook';
import { WhatsappAccount } from '../whatsapp/whatsapp-account.entity';
import { WhatsappAccountsService } from '../whatsapp/whatsapp-accounts.service';

const PAYLOAD_RE = /^(CONFIRM|CANCEL|RESCHEDULE|PICK):([0-9a-f-]{36})(?::(.+))?$/;
const SLOT_DAYS = 7;
const SLOT_LIMIT = 10;
const INACTIVE_MSG = 'Esta cita ya no está activa. Si necesitas una nueva, escríbenos.';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly appointments: AppointmentsService,
    private readonly settings: ClinicSettingsService,
    private readonly accounts: WhatsappAccountsService,
    private readonly messages: MessagesService,
    private readonly d360: D360Client,
    private readonly clock: Clock,
  ) {}

  async handle(account: WhatsappAccount, msg: InboundMessage): Promise<void> {
    const patient = await this.ds.getRepository(Patient).findOneBy({ clinicId: account.clinicId, phoneE164: `+${msg.from}` });
    const isNew = await this.messages.recordInbound({
      clinicId: account.clinicId,
      patientId: patient?.id ?? null,
      waMessageId: msg.waId,
      type: msg.type,
      payload: { text: msg.text, payload: msg.payload },
    });
    if (!isNew || !msg.payload || !patient) return;

    const match = PAYLOAD_RE.exec(msg.payload);
    if (!match) return;
    const [, action, apptId, iso] = match;
    const appt = await this.appointments.findWithRelations(account.clinicId, apptId);
    if (!appt || appt.isBlock || appt.patientId !== patient.id) return; // otro consultorio u otro paciente: se ignora

    const clinic = await this.settings.get(account.clinicId);
    const send = (payload: object) => this.reply(account, patient.id, payload);
    const active = appt.status === AppointmentStatus.SCHEDULED || appt.status === AppointmentStatus.CONFIRMED;
    if (!active) return send(textMessage(patient.phoneE164, INACTIVE_MSG));

    if (action === 'CONFIRM') {
      if (canTransition(appt.status, AppointmentStatus.CONFIRMED, false)) {
        await this.appointments.changeStatus(account.clinicId, WHATSAPP_ACTOR, appt.id, AppointmentStatus.CONFIRMED);
      }
      return send(textMessage(patient.phoneE164, `✅ ¡Confirmado! Te esperamos el ${this.when(appt.startsAt, clinic)}.`));
    }
    if (action === 'CANCEL') {
      await this.appointments.changeStatus(account.clinicId, WHATSAPP_ACTOR, appt.id, AppointmentStatus.CANCELLED);
      return send(textMessage(patient.phoneE164, 'Tu cita fue cancelada. Si quieres agendar otra, escríbenos.'));
    }
    if (action === 'RESCHEDULE') return this.offerSlots(account, patient, appt, clinic, 'Elige un nuevo horario:');

    // PICK: solo se acepta un horario que siga libre y dentro del horario de atención.
    const slots = await this.slotsFor(appt, clinic);
    if (!iso || !slots.some((s) => s.toISOString() === iso)) {
      return this.offerSlots(account, patient, appt, clinic, 'Ese horario ya no está disponible. Elige otro:', slots);
    }
    try {
      const moved = await this.appointments.reschedule(account.clinicId, WHATSAPP_ACTOR, appt.id, new Date(iso));
      return send(textMessage(patient.phoneE164, `📅 Listo, tu cita quedó para el ${this.when(new Date(moved.startsAt), clinic)}.`));
    } catch (e) {
      if (e instanceof ConflictException) {
        return this.offerSlots(account, patient, appt, clinic, 'Ese horario se acaba de ocupar. Elige otro:');
      }
      throw e;
    }
  }

  private when(instant: Date, clinic: ClinicSettings): string {
    return `${fmtDateEs(instant, clinic.timezone)} a las ${fmtTimeEs(instant, clinic.timezone)}`;
  }

  private async slotsFor(appt: Appointment, clinic: ClinicSettings): Promise<Date[]> {
    const fromDate = addDays(localParts(this.clock.now(), clinic.timezone).date, 1);
    const windowStart = new Date(`${fromDate}T00:00:00Z`).getTime() - 24 * 3_600_000;
    const windowEnd = new Date(`${addDays(fromDate, SLOT_DAYS)}T00:00:00Z`).getTime() + 24 * 3_600_000;
    const busy = await this.ds.getRepository(Appointment).find({
      where: {
        clinicId: appt.clinicId,
        id: Not(appt.id),
        status: Not(AppointmentStatus.CANCELLED),
        startsAt: LessThan(new Date(windowEnd)),
        endsAt: MoreThan(new Date(windowStart)),
      },
    });
    return freeSlots({
      hours: await this.settings.hours(appt.clinicId),
      busy: busy.map((b) => ({ start: b.startsAt, end: b.endsAt })),
      durationMin: appt.service!.durationMin,
      timeZone: clinic.timezone,
      fromDate,
      days: SLOT_DAYS,
      limit: SLOT_LIMIT,
    });
  }

  private async offerSlots(
    account: WhatsappAccount,
    patient: Patient,
    appt: Appointment,
    clinic: ClinicSettings,
    intro: string,
    precomputed?: Date[],
  ): Promise<void> {
    const slots = precomputed ?? (await this.slotsFor(appt, clinic));
    if (!slots.length) {
      return this.reply(account, patient.id, textMessage(patient.phoneE164, 'No encontramos horarios libres en los próximos 7 días; escríbenos para coordinar.'));
    }
    const list = slotList({
      to: patient.phoneE164,
      appointmentId: appt.id,
      intro,
      slots: slots.map((s) => ({ iso: s.toISOString(), label: fmtSlotLabel(s, clinic.timezone) })),
    });
    return this.reply(account, patient.id, list);
  }

  private async reply(account: WhatsappAccount, patientId: string, payload: object): Promise<void> {
    try {
      const { waMessageId } = await this.d360.send(this.accounts.credentials(account), payload);
      await this.messages.recordOutbound({
        clinicId: account.clinicId,
        patientId,
        waMessageId,
        type: (payload as { type: string }).type,
        payload,
      });
    } catch (e) {
      this.logger.warn(`No se pudo responder por WhatsApp: ${(e as Error).message}`);
    }
  }
}
```

`apps/api/src/conversation/webhook.controller.ts`:
```ts
import { Body, Controller, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { MessageStatus } from '../whatsapp/message.entity';
import { MessagesService } from '../whatsapp/messages.service';
import { parseWebhook } from '../whatsapp/parse-webhook';
import { WhatsappAccountsService } from '../whatsapp/whatsapp-accounts.service';
import { ConversationService } from './conversation.service';

@Public()
@Controller('webhooks/wa')
export class WebhookController {
  constructor(
    private readonly accounts: WhatsappAccountsService,
    private readonly messages: MessagesService,
    private readonly conversation: ConversationService,
  ) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post(':token')
  @HttpCode(200)
  async receive(@Param('token') token: string, @Body() body: unknown): Promise<{ ok: true }> {
    const account = await this.accounts.findByWebhookToken(token);
    if (!account) throw new NotFoundException();
    const { messages, statuses } = parseWebhook(body);
    for (const s of statuses) await this.messages.updateStatus(s.waId, s.status as MessageStatus);
    for (const m of messages) await this.conversation.handle(account, m);
    return { ok: true };
  }
}
```

`apps/api/src/conversation/conversation.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ClinicsModule } from '../clinics/clinics.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConversationService } from './conversation.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [AppointmentsModule, ClinicsModule, WhatsappModule],
  controllers: [WebhookController],
  providers: [ConversationService],
})
export class ConversationModule {}
```

En `apps/api/src/app.module.ts`: `import { ConversationModule } from './conversation/conversation.module';` y agregar `ConversationModule` al final de `imports`.

- [ ] **Step 4: Tests pasan y build**

Run: `npm run test:api`
Expected: PASS (`webhook y conversación`: 9 tests; todas las suites verdes).

Run: `npm run build -w @recep/api`
Expected: compila.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add WhatsApp webhook with idempotent inbound handling and confirm/cancel/reschedule conversation"
```

---

### Task 9: Panel del superadmin para conectar WhatsApp y guía de prueba

**Files:**
- Modify: `apps/web/src/lib/types.ts` (+ `WaAccount`), `apps/web/src/app/admin/page.tsx` (panel WhatsApp dentro de `ClinicItem`)
- Modify: `README.md`, `docs/HANDOFF.md`

**Interfaces:**
- Consumes: `GET/PUT /api/admin/clinics/:id/whatsapp`.

- [ ] **Step 1: Tipo y panel**

Agregar al final de `apps/web/src/lib/types.ts`:
```ts
export interface WaAccount {
  phoneNumber: string;
  displayName: string | null;
  sandbox: boolean;
  status: 'PENDING' | 'CONNECTED' | 'ERROR';
  lastError: string | null;
  webhookUrl: string;
}
```

En `apps/web/src/app/admin/page.tsx`:
- Agregar `WaAccount` al import de tipos: `import type { ClinicRow, WaAccount } from '@/lib/types';`.
- Agregar este componente encima de `ClinicItem`:
```tsx
function WhatsappPanel({ clinicId }: { clinicId: string }) {
  const [account, setAccount] = useState<WaAccount | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ account: WaAccount | null }>(`/admin/clinics/${clinicId}/whatsapp`)
      .then((r) => setAccount(r.account))
      .catch((e) => setError((e as Error).message));
  }, [clinicId]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setError('');
    try {
      setAccount(
        await api<WaAccount>(`/admin/clinics/${clinicId}/whatsapp`, {
          method: 'PUT',
          body: JSON.stringify({
            apiKey: form.get('apiKey'),
            phoneNumber: form.get('phoneNumber'),
            displayName: form.get('displayName') || undefined,
            sandbox: form.get('sandbox') === 'on',
          }),
        }),
      );
      formEl.reset();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const color = account?.status === 'CONNECTED' ? 'text-emerald-700' : account?.status === 'ERROR' ? 'text-red-600' : 'text-amber-700';

  return (
    <div className="mt-3 space-y-2 rounded border bg-slate-50 p-3 text-sm">
      {account ? (
        <div className="space-y-1">
          <p>
            WhatsApp {account.phoneNumber} {account.sandbox && '(sandbox)'} · <span className={`font-medium ${color}`}>{account.status}</span>
          </p>
          {account.lastError && <p className="text-red-600">{account.lastError}</p>}
          <p className="break-all text-xs text-slate-500">Webhook: {account.webhookUrl}</p>
        </div>
      ) : (
        <p className="text-slate-500">WhatsApp no conectado.</p>
      )}
      <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-2">
        <Input name="apiKey" type="password" placeholder="API key de 360dialog" required minLength={10} autoComplete="off" />
        <Input name="phoneNumber" placeholder="Número del consultorio" required />
        <Input name="displayName" placeholder="Nombre visible (opcional)" />
        <label className="flex items-center gap-2">
          <input type="checkbox" name="sandbox" /> Sandbox de 360dialog
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm">{account ? 'Reconectar' : 'Conectar'}</Button>
        </div>
      </form>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
```
- Dentro de `ClinicItem`:
  - Agregar el estado `const [showWa, setShowWa] = useState(false);` junto a los otros `useState`.
  - Agregar este botón junto a "Guardar" / "Nuevo enlace":
    ```tsx
    <Button size="sm" variant="outline" onClick={() => setShowWa(!showWa)}>WhatsApp</Button>
    ```
  - Agregar `{showWa && <WhatsappPanel clinicId={clinic.id} />}` justo antes de `{inviteUrl && <InviteLink url={inviteUrl} />}`.

- [ ] **Step 2: Guía de prueba**

Agregar al final de `README.md`:
````markdown
## Probar WhatsApp (Etapa 3)

1. **Exponer la API con HTTPS** (360dialog exige HTTPS sin puerto):
   ```bash
   npx cloudflared tunnel --url http://localhost:4000
   ```
   Poner la URL que imprime en `PUBLIC_API_URL` de `.env` y reiniciar la API.
2. **Sandbox (solo tu número, máximo 200 mensajes):**
   - Desde tu WhatsApp, enviar `START` a +55 11 4673-3492; la respuesta trae la API key.
   - En `/admin` → WhatsApp del consultorio: pegar la key, tu número y marcar "Sandbox".
   - Crear un paciente con **tu** número y con consentimiento, y una cita para dentro de algo más de 24 h.
   - Para no esperar, adelantar el envío en la base de datos:
     ```sql
     UPDATE scheduled_messages SET send_at = now() WHERE kind = 'REMINDER_24H';
     ```
     En menos de un minuto llega la plantilla de prueba con los botones Confirm/Cancel; al tocarlos, la agenda cambia.
3. **Producción:** antes de conectar el número real, crear en el panel de 360dialog (categoría UTILITY, idioma es) estas plantillas:
   - `recordatorio_cita_24h`: "Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}}." con 3 botones de respuesta rápida: Confirmo, Reprogramar, Cancelar.
   - `recordatorio_cita_2h`: "{{1}}, te esperamos hoy a las {{2}} en {{3}}." con 1 botón: Cancelar.
````

En `docs/HANDOFF.md`, actualizar la sección "Dónde estamos":
- Marcar la Etapa 3 como completada.
- Agregar como siguiente paso: "Plan 4 (onboarding de WhatsApp por consultorio y creación automática de plantillas)".

- [ ] **Step 3: Verificación completa**

Run: `npm run test:api && npm run build -w @recep/api && npm run build -w @recep/web`
Expected: todo en verde.

Prueba manual (HTTP, con API y panel levantados):
1. Como superadmin, `PUT /api/admin/clinics/:id/whatsapp` con una key falsa. Se espera `status: ERROR` y `lastError` con el mensaje de 360dialog.
2. Hacer `POST /api/webhooks/wa/<token>` con un `CONFIRM` simulado para una cita propia. La cita queda confirmada y en el historial aparece WHATSAPP.

La prueba real con el sandbox la hace el usuario, siguiendo el README.

Expected: los dos pasos se comportan como se describe.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add WhatsApp connection panel for superadmin; document sandbox and production testing"
```

---

## Siguientes planes

**Plan 4 (Etapa 4):**
- Onboarding de 360dialog (Integrated Onboarding / Partner API) para que cada dueño conecte su número.
- Creación automática de las 3 plantillas y su seguimiento de estado (`whatsapp_templates`).
- Coexistence y la respuesta automática del plan B.

La conexión manual del superadmin queda como alternativa de soporte.
