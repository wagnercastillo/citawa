# Etapa 4 — Onboarding de WhatsApp por consultorio y plantillas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño conecte su propio número desde el panel con el popup de 360dialog (Integrated Onboarding), que el sistema cree solas las 3 plantillas y siga su aprobación, y que el despachador solo envíe con plantillas aprobadas.

**Architecture:**
- **Inicio:** `POST /api/whatsapp/onboarding/start` crea un `state` de un solo uso (en la base solo se guarda su hash) y devuelve la URL del popup.
- **Callback:** la página de callback del panel envía `state` y `channels` a `POST /api/whatsapp/onboarding/complete`. Este endpoint genera la API key del canal con la Partner API (`x-api-key`) y reutiliza la conexión de la Etapa 3 (cifrar la key y registrar el webhook).
- **Plantillas:** `WhatsappTemplatesService` las crea al conectar y actualiza su estado. Un poller cada 15 min sincroniza las pendientes.
- **Despachador:** pospone (en vez de enviar o cancelar) mientras la plantilla no esté aprobada, salvo en sandbox.

**Tech Stack:** Igual que las etapas anteriores. No agrega dependencias.

**Spec:** `docs/superpowers/specs/2026-10-05-recepcionista-wa-design.md` (§4 `whatsapp_templates`, §5.5 pasos 3–4, §6 `/app/settings`, §8.1). Notas verificadas de la API: `docs/360dialog-notes.md` (sección Partner API).

## Global Constraints

- **Proyecto:**
  - Prefijo `api`; Postgres en el puerto 5434.
  - Comandos con `-w @recep/api` / `-w @recep/web`.
  - JSON con la herramienta de archivos.
  - Rama `etapa-4-onboarding`, creada desde `main`.
- **Partner API:**
  - Base `https://hub.360dialog.io/api/v2`, header `x-api-key: <D360_PARTNER_API_KEY>`.
  - Key de canal: `POST /partners/{D360_PARTNER_ID}/channels/{channelId}/api_keys`, que responde `{ api_key, address }`.
- **Popup:** `https://app.360dialog.com/dashboard/app/{partnerId}/permissions?redirect_url=<enc>&state=<state>`.
  - Al volver: `?channels=[id,...]&state=...` (puede traer también `client`).
  - `redirect_url` = `${WEB_URL}/app/settings/whatsapp/callback`.
- **Plantillas:**
  - Se crean con la key del canal: `POST https://waba-v2.360dialog.io/v1/configs/templates`. Se listan con `GET /v1/configs/templates`.
  - **No se crean en sandbox.**
  - Categoría `UTILITY`, idioma `es`. Textos exactos del spec §5.5.
  - Los botones deben coincidir con los índices que usa `message-builders.ts`: 24 h = [Confirmo, Reprogramar, Cancelar]; 2 h = [Cancelar].
- **Estados de plantilla:** `PENDING | APPROVED | REJECTED | PAUSED | DISABLED`. Lo que llega de 360dialog se normaliza: approved → APPROVED, rejected → REJECTED, paused → PAUSED, disabled → DISABLED, cualquier otro valor (submitted, pending, in_appeal…) → PENDING.
- **State del onboarding:**
  - Aleatorio de 32 bytes en base64url; en la base solo se guarda el SHA-256.
  - Válido 30 min, un solo uso.
  - Ligado a `clinic_id` y `user_id`. Solo OWNER.
- **Configuración faltante:** si faltan `D360_PARTNER_ID` o `D360_PARTNER_API_KEY`, `start` y `complete` responden **503** "Onboarding de WhatsApp no configurado".
- **Despachador:** con cuenta no sandbox y plantilla del recordatorio no APPROVED → pospone 15 min con `last_error = 'Plantilla no aprobada todavía'` mientras la cita siga lejos; si no, cancela con ese motivo.
- **Tests:** la Partner API y la API de mensajes se reemplazan por `FakeD360`.

## Review Focus

1. **`state` reutilizado, vencido o de otro consultorio** → 400 sin conectar nada. Test en Task 5.
2. **El callback llega sin `channels` o con un formato raro** (`[a,b]`, `["a"]`, `a`) → se toma el primer canal válido; si no hay ninguno, 400. Tests en Tasks 2 y 5.
3. **Plantilla rechazada por Meta** → el panel muestra el motivo y el despachador nunca la usa (pospone hasta que la cita esté cerca y luego cancela). Tests en Tasks 4 y 6.
4. **Reconectar un consultorio que ya tenía plantillas** → no se duplican filas; un error "ya existe" de 360dialog no rompe la conexión. Test en Task 4.
5. **La API key del canal nunca sale en una respuesta ni se guarda en claro.** Test en Task 5.

---

## File Structure

```
apps/api/src/
├─ database/migrations/1760000000000-Onboarding.ts
├─ whatsapp/
│  ├─ whatsapp-template.entity.ts, onboarding-state.entity.ts
│  ├─ templates.ts (+spec)          definiciones, payload de creación, normalización de estado
│  ├─ onboarding.ts (+spec)         onboardingUrl, parseChannels
│  ├─ d360-client.ts (+spec)        + createTemplate, listTemplates, createChannelApiKey
│  ├─ whatsapp-templates.service.ts provision, refresh, approvedNames, list
│  ├─ template-status.poller.ts     cron 15 min
│  ├─ whatsapp-accounts.service.ts  refactor: attach() común + aprovisiona plantillas
│  ├─ onboarding.service.ts, onboarding.controller.ts   /api/whatsapp/*
│  └─ whatsapp.module.ts
├─ scheduler/reminder-dispatcher.ts (requiere plantilla aprobada)
apps/api/test/ fakes.ts (+partner/plantillas), utils.ts (seedWhatsapp siembra plantillas aprobadas),
               onboarding-schema, templates, onboarding, dispatcher-templates (.e2e-spec.ts)
apps/web/src/  lib/types.ts, app/app/settings/page.tsx (tarjeta WhatsApp),
               app/app/settings/whatsapp/callback/page.tsx
```

---

### Task 1: Esquema (plantillas y estados de onboarding)

**Files:**
- Create: `apps/api/src/database/migrations/1760000000000-Onboarding.ts`, `apps/api/src/whatsapp/whatsapp-template.entity.ts`, `apps/api/src/whatsapp/onboarding-state.entity.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Test: `apps/api/test/onboarding-schema.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `enum WaTemplateStatus { PENDING, APPROVED, REJECTED, PAUSED, DISABLED }`
  - `WhatsappTemplate { id; clinicId; name; language; status; rejectionReason: string | null }`
  - `OnboardingState { id; clinicId; userId; stateHash; expiresAt: Date; usedAt: Date | null }`

- [ ] **Step 0: Rama**

Run: `git checkout -b etapa-4-onboarding`
Expected: rama creada.

- [ ] **Step 1: Test (falla)**

`apps/api/test/onboarding-schema.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedUser } from './utils';

describe('onboarding schema', () => {
  let app: INestApplication;
  let ds: DataSource;
  let clinicId: string;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDb(app);
    clinicId = (await seedClinic(app)).id;
    userId = (await seedUser(app, { email: 'o@a.com', role: Role.OWNER, clinicId })).id;
  });
  afterAll(async () => { await app.close(); });

  it('una plantilla por nombre y consultorio', async () => {
    const insert = () => ds.query(`INSERT INTO whatsapp_templates (clinic_id, name) VALUES ($1, 'recordatorio_cita_24h')`, [clinicId]);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505' });
    const [row] = await ds.query(`SELECT status, language FROM whatsapp_templates`);
    expect(row).toEqual({ status: 'PENDING', language: 'es' });
  });

  it('el hash del state es único y se borra con el consultorio', async () => {
    const insert = () =>
      ds.query(`INSERT INTO whatsapp_onboarding_states (clinic_id, user_id, state_hash, expires_at) VALUES ($1, $2, $3, now())`, [clinicId, userId, 'a'.repeat(64)]);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505' });
    await ds.query('DELETE FROM clinics WHERE id = $1', [clinicId]);
    const [{ count }] = await ds.query('SELECT count(*)::int AS count FROM whatsapp_onboarding_states');
    expect(count).toBe(0);
  });
});
```

Run: `npm run test:e2e -w @recep/api -- onboarding-schema`
Expected: FAIL (`relation "whatsapp_templates" does not exist`).

- [ ] **Step 2: Migración, entidades y registro**

`apps/api/src/database/migrations/1760000000000-Onboarding.ts`:
```ts
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
```

`apps/api/src/whatsapp/whatsapp-template.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum WaTemplateStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PAUSED = 'PAUSED',
  DISABLED = 'DISABLED',
}

@Entity('whatsapp_templates')
export class WhatsappTemplate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ type: 'varchar', length: 64 }) name: string;
  @Column({ type: 'varchar', length: 10, default: 'es' }) language: string;
  @Column({ type: 'enum', enum: WaTemplateStatus, enumName: 'wa_template_status', default: WaTemplateStatus.PENDING })
  status: WaTemplateStatus;
  @Column({ name: 'rejection_reason', type: 'text', nullable: true }) rejectionReason: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

`apps/api/src/whatsapp/onboarding-state.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('whatsapp_onboarding_states')
export class OnboardingState {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'state_hash', type: 'char', length: 64 }) stateHash: string;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true }) usedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
```

En `apps/api/src/database/data-source.ts`:
- Importar `WhatsappTemplate`, `OnboardingState` y `Onboarding1760000000000`.
- Agregar `WhatsappTemplate, OnboardingState` al final de `entities`.
- Agregar `Onboarding1760000000000` al final de `migrations`.

- [ ] **Step 3: Tests pasan y migración**

Run: `npm run test:e2e -w @recep/api`
Expected: PASS (`onboarding schema`: 2 tests).

Run: `npm run migration:run -w @recep/api`
Expected: "Migration Onboarding1760000000000 has been executed successfully."

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add whatsapp templates and onboarding state schema"
```

---

### Task 2: Definiciones de plantillas y utilidades del onboarding (puras)

**Files:**
- Create: `apps/api/src/whatsapp/templates.ts` (+ `templates.spec.ts`), `apps/api/src/whatsapp/onboarding.ts` (+ `onboarding.spec.ts`)

**Interfaces:**
- Produces:
  - `TEMPLATE_DEFS: TemplateDef[]`, con `TemplateDef { name; text; example: string[]; buttons: string[] }`, y `TEMPLATE_FOR_KIND: Record<'REMINDER_24H' | 'REMINDER_2H', string>`.
  - `templateCreatePayload(def: TemplateDef): object`
  - `normalizeTemplateStatus(raw: unknown): WaTemplateStatus`
  - `onboardingUrl(partnerId, redirectUrl, state): string`
  - `parseChannels(raw: unknown): string[]`

- [ ] **Step 1: Tests (fallan)**

`apps/api/src/whatsapp/templates.spec.ts`:
```ts
import { normalizeTemplateStatus, TEMPLATE_DEFS, TEMPLATE_FOR_KIND, templateCreatePayload } from './templates';

describe('templates', () => {
  it('define las 3 plantillas del spec', () => {
    expect(TEMPLATE_DEFS.map((t) => t.name)).toEqual(['recordatorio_cita_24h', 'recordatorio_cita_2h', 'recordatorio_pago']);
    expect(TEMPLATE_FOR_KIND).toEqual({ REMINDER_24H: 'recordatorio_cita_24h', REMINDER_2H: 'recordatorio_cita_2h' });
  });

  it('payload de 24 h: UTILITY/es, ejemplo de 4 valores y 3 quick replies en el orden de los builders', () => {
    const p = templateCreatePayload(TEMPLATE_DEFS[0]) as any;
    expect(p).toMatchObject({ name: 'recordatorio_cita_24h', category: 'UTILITY', language: 'es' });
    expect(p.components[0]).toEqual({
      type: 'BODY',
      text: 'Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}}.',
      example: { body_text: [['Juan', 'Sonrisas', 'martes 6 de octubre', '09:30']] },
    });
    expect(p.components[1]).toEqual({
      type: 'BUTTONS',
      buttons: ['Confirmo', 'Reprogramar', 'Cancelar'].map((text) => ({ type: 'QUICK_REPLY', text })),
    });
  });

  it('la de pago no tiene botones', () => {
    const p = templateCreatePayload(TEMPLATE_DEFS[2]) as any;
    expect(p.components).toHaveLength(1);
  });

  it('normaliza estados de 360dialog', () => {
    expect(normalizeTemplateStatus('approved')).toBe('APPROVED');
    expect(normalizeTemplateStatus('APPROVED')).toBe('APPROVED');
    expect(normalizeTemplateStatus('rejected')).toBe('REJECTED');
    expect(normalizeTemplateStatus('paused')).toBe('PAUSED');
    expect(normalizeTemplateStatus('disabled')).toBe('DISABLED');
    expect(normalizeTemplateStatus('submitted')).toBe('PENDING');
    expect(normalizeTemplateStatus('in_appeal')).toBe('PENDING');
    expect(normalizeTemplateStatus(undefined)).toBe('PENDING');
  });
});
```

`apps/api/src/whatsapp/onboarding.spec.ts`:
```ts
import { onboardingUrl, parseChannels } from './onboarding';

describe('onboarding utils', () => {
  it('arma la URL del popup con redirect y state codificados', () => {
    const url = new URL(onboardingUrl('P123', 'http://localhost:3000/app/settings/whatsapp/callback', 'abc_-1'));
    expect(url.origin + url.pathname).toBe('https://app.360dialog.com/dashboard/app/P123/permissions');
    expect(url.searchParams.get('redirect_url')).toBe('http://localhost:3000/app/settings/whatsapp/callback');
    expect(url.searchParams.get('state')).toBe('abc_-1');
  });

  it('acepta los formatos de channels que devuelve 360dialog', () => {
    expect(parseChannels('[abc,def]')).toEqual(['abc', 'def']);
    expect(parseChannels('["abc"]')).toEqual(['abc']);
    expect(parseChannels('abc')).toEqual(['abc']);
    expect(parseChannels(' [ abc ] ')).toEqual(['abc']);
    expect(parseChannels('')).toEqual([]);
    expect(parseChannels('[]')).toEqual([]);
    expect(parseChannels(undefined)).toEqual([]);
    expect(parseChannels('[a b]')).toEqual([]);
  });
});
```

Run: `npm test -w @recep/api`
Expected: FAIL (no existen los módulos).

- [ ] **Step 2: Implementación**

`apps/api/src/whatsapp/templates.ts`:
```ts
import { WaTemplateStatus } from './whatsapp-template.entity';

export interface TemplateDef {
  name: string;
  text: string;
  example: string[];
  buttons: string[];
}

/** Textos del spec §5.5. Los botones siguen el orden de índices que usa message-builders.ts. */
export const TEMPLATE_DEFS: TemplateDef[] = [
  {
    name: 'recordatorio_cita_24h',
    text: 'Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}}.',
    example: ['Juan', 'Sonrisas', 'martes 6 de octubre', '09:30'],
    buttons: ['Confirmo', 'Reprogramar', 'Cancelar'],
  },
  {
    name: 'recordatorio_cita_2h',
    text: '{{1}}, te esperamos hoy a las {{2}} en {{3}}.',
    example: ['Juan', '09:30', 'Av. Larco 123'],
    buttons: ['Cancelar'],
  },
  {
    name: 'recordatorio_pago',
    text: 'Hola {{1}}, tienes un saldo de S/ {{2}} por {{3}}. Puedes pagar así: {{4}}.',
    example: ['Juan', '150.00', 'tratamiento de ortodoncia', 'Yape 987654321'],
    buttons: [],
  },
];

export const TEMPLATE_FOR_KIND: Record<'REMINDER_24H' | 'REMINDER_2H', string> = {
  REMINDER_24H: 'recordatorio_cita_24h',
  REMINDER_2H: 'recordatorio_cita_2h',
};

export function templateCreatePayload(def: TemplateDef): object {
  const components: object[] = [{ type: 'BODY', text: def.text, example: { body_text: [def.example] } }];
  if (def.buttons.length) components.push({ type: 'BUTTONS', buttons: def.buttons.map((text) => ({ type: 'QUICK_REPLY', text })) });
  return { name: def.name, category: 'UTILITY', language: 'es', components };
}

const KNOWN: Record<string, WaTemplateStatus> = {
  approved: WaTemplateStatus.APPROVED,
  rejected: WaTemplateStatus.REJECTED,
  paused: WaTemplateStatus.PAUSED,
  disabled: WaTemplateStatus.DISABLED,
};

/** submitted, pending, in_appeal y cualquier valor desconocido → PENDING. */
export function normalizeTemplateStatus(raw: unknown): WaTemplateStatus {
  return KNOWN[String(raw ?? '').toLowerCase()] ?? WaTemplateStatus.PENDING;
}
```

`apps/api/src/whatsapp/onboarding.ts`:
```ts
export function onboardingUrl(partnerId: string, redirectUrl: string, state: string): string {
  const url = new URL(`https://app.360dialog.com/dashboard/app/${encodeURIComponent(partnerId)}/permissions`);
  url.searchParams.set('redirect_url', redirectUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

const CHANNEL_RE = /^[A-Za-z0-9_-]+$/;

/** 360dialog devuelve channels como "[a,b]", '["a"]' o "a". Devuelve solo ids con formato válido. */
export function parseChannels(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  const ids = inner
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  return ids.every((id) => CHANNEL_RE.test(id)) ? ids : [];
}
```

- [ ] **Step 3: Tests pasan**

Run: `npm test -w @recep/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add WhatsApp template definitions and onboarding URL/channel helpers"
```

---

### Task 3: Cliente de 360dialog — plantillas y Partner API

**Files:**
- Modify: `apps/api/src/whatsapp/d360-client.ts`, `apps/api/src/whatsapp/d360-client.spec.ts`

**Interfaces:**
- Produces (en `D360Client`):
  - `createTemplate(creds, payload): Promise<void>`
  - `listTemplates(creds): Promise<{ name: string; status: string; rejected_reason?: string | null }[]>`
  - `createChannelApiKey(partner: { partnerId; apiKey }, channelId): Promise<{ apiKey: string; address: string }>`
  - `d360Urls(sandbox)` ahora incluye `templates`.

- [ ] **Step 1: Tests (fallan)**

Agregar dentro del `describe('D360Client', …)` de `apps/api/src/whatsapp/d360-client.spec.ts`:
```ts
  it('crea y lista plantillas con la key del canal (producción)', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(async () => ok({ id: 't1', status: 'submitted' }, 201))
      .mockImplementationOnce(async () => ok({ waba_templates: [{ name: 'a', status: 'approved' }] }));
    await client.createTemplate({ apiKey: 'k', sandbox: false }, { name: 'a' });
    const list = await client.listTemplates({ apiKey: 'k', sandbox: false });
    expect(fetchMock.mock.calls[0][0]).toBe('https://waba-v2.360dialog.io/v1/configs/templates');
    expect(fetchMock.mock.calls[0][1]!.method).toBe('POST');
    expect(fetchMock.mock.calls[1][0]).toBe('https://waba-v2.360dialog.io/v1/configs/templates');
    expect(fetchMock.mock.calls[1][1]!.method).toBe('GET');
    expect(list).toEqual([{ name: 'a', status: 'approved' }]);
  });

  it('genera la key de un canal con la Partner API (x-api-key)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ok({ id: 'x', api_key: 'chan-key', address: '+51987654321' }, 201));
    const res = await client.createChannelApiKey({ partnerId: 'P1', apiKey: 'pk' }, 'ch_9');
    expect(res).toEqual({ apiKey: 'chan-key', address: '+51987654321' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hub.360dialog.io/api/v2/partners/P1/channels/ch_9/api_keys');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('pk');
    expect((init!.headers as Record<string, string>)['D360-API-KEY']).toBeUndefined();
  });

  it('Partner API sin api_key en la respuesta es error', async () => {
    jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ok({}, 201));
    await expect(client.createChannelApiKey({ partnerId: 'P1', apiKey: 'pk' }, 'c')).rejects.toBeInstanceOf(D360Error);
  });
```

Run: `npm test -w @recep/api -- d360-client`
Expected: FAIL (`client.createTemplate is not a function`).

- [ ] **Step 2: Implementación**

Reemplazar en `apps/api/src/whatsapp/d360-client.ts` la función `d360Urls` y la clase `D360Client` completa por:
```ts
const PARTNER_API = 'https://hub.360dialog.io/api/v2';

export function d360Urls(sandbox: boolean): { messages: string; webhook: string; templates: string } {
  const host = sandbox ? 'https://waba-sandbox.360dialog.io' : 'https://waba-v2.360dialog.io';
  return {
    messages: sandbox ? `${host}/v1/messages` : `${host}/messages`,
    webhook: `${host}/v1/configs/webhook`,
    templates: `${host}/v1/configs/templates`,
  };
}

export interface PartnerCredentials {
  partnerId: string;
  apiKey: string;
}

@Injectable()
export class D360Client {
  async send(creds: D360Credentials, payload: object): Promise<{ waMessageId: string }> {
    const body = (await this.request('POST', d360Urls(creds.sandbox).messages, { 'D360-API-KEY': creds.apiKey }, payload)) as {
      messages?: { id?: string }[];
    };
    const id = body.messages?.[0]?.id;
    if (!id) throw new D360Error(502, 'Respuesta de 360dialog sin id de mensaje');
    return { waMessageId: id };
  }

  async setWebhook(creds: D360Credentials, url: string): Promise<void> {
    await this.request('POST', d360Urls(creds.sandbox).webhook, { 'D360-API-KEY': creds.apiKey }, { url });
  }

  async createTemplate(creds: D360Credentials, payload: object): Promise<void> {
    await this.request('POST', d360Urls(creds.sandbox).templates, { 'D360-API-KEY': creds.apiKey }, payload);
  }

  async listTemplates(creds: D360Credentials): Promise<{ name: string; status: string; rejected_reason?: string | null }[]> {
    const body = (await this.request('GET', d360Urls(creds.sandbox).templates, { 'D360-API-KEY': creds.apiKey })) as {
      waba_templates?: unknown[];
      templates?: unknown[];
    };
    return (body.waba_templates ?? body.templates ?? []) as { name: string; status: string; rejected_reason?: string | null }[];
  }

  async createChannelApiKey(partner: PartnerCredentials, channelId: string): Promise<{ apiKey: string; address: string }> {
    const url = `${PARTNER_API}/partners/${encodeURIComponent(partner.partnerId)}/channels/${encodeURIComponent(channelId)}/api_keys`;
    const body = (await this.request('POST', url, { 'x-api-key': partner.apiKey }, {})) as { api_key?: string; address?: string };
    if (!body.api_key) throw new D360Error(502, 'La Partner API no devolvió una API key');
    return { apiKey: body.api_key, address: body.address ?? '' };
  }

  private async request(method: 'GET' | 'POST', url: string, auth: Record<string, string>, payload?: object): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
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

- [ ] **Step 3: Tests pasan**

Run: `npm test -w @recep/api`
Expected: PASS (`D360Client`: 6 tests).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add 360dialog template endpoints and Partner API channel key generation"
```

---

### Task 4: Creación y seguimiento de plantillas

**Files:**
- Create: `apps/api/src/whatsapp/whatsapp-templates.service.ts`, `apps/api/src/whatsapp/template-status.poller.ts`
- Modify (reemplazo completo): `apps/api/src/whatsapp/whatsapp-accounts.service.ts`, `apps/api/src/whatsapp/whatsapp.module.ts`
- Modify: `apps/api/test/fakes.ts` (plantillas y Partner API en `FakeD360`), `apps/api/test/utils.ts` (`seedWhatsapp` siembra plantillas aprobadas si no es sandbox)
- Test: `apps/api/test/templates.e2e-spec.ts`

**Interfaces:**
- Consumes: `TEMPLATE_DEFS`, `templateCreatePayload`, `normalizeTemplateStatus`, `D360Client`, `WhatsappTemplate`.
- Produces:
  - `WhatsappTemplatesService`:
    - `provision(clinicId, creds): Promise<void>`
    - `refresh(clinicId, creds): Promise<void>`
    - `list(clinicId): Promise<TemplateDto[]>`
    - `approvedNames(clinicId): Promise<Set<string>>`
  - `TemplateDto { name; status; rejectionReason }`
  - `TemplateStatusPoller.runOnce(): Promise<number>` (cron cada 15 min, desactivado con `SCHEDULER_ENABLED=false`)
  - `WhatsappAccountsService.attach(clinicId, a: { apiKey; phoneNumber; sandbox; displayName?; channelId? }): Promise<WhatsappAccountDto>` (usada por la conexión manual y por el onboarding)
  - `FakeD360`: `templatesCreated[]`, `templateList[]`, `channelKeys[]`, `partnerError`, `templateCreateError`

- [ ] **Step 1: Fakes, seed y test (falla)**

En `apps/api/test/fakes.ts`, agregar a la clase `FakeD360` (y vaciar los nuevos campos en `reset()`):
```ts
  templatesCreated: { creds: D360Credentials; payload: AnyPayload }[] = [];
  templateList: { name: string; status: string; rejected_reason?: string | null }[] = [];
  channelKeys: { partner: { partnerId: string; apiKey: string }; channelId: string }[] = [];
  partnerError: Error | null = null;
  templateCreateError: Error | null = null;

  async createTemplate(creds: D360Credentials, payload: AnyPayload): Promise<void> {
    if (this.templateCreateError) throw this.templateCreateError;
    this.templatesCreated.push({ creds, payload });
    if (!this.templateList.some((t) => t.name === payload.name)) this.templateList.push({ name: payload.name, status: 'submitted' });
  }

  async listTemplates(): Promise<{ name: string; status: string; rejected_reason?: string | null }[]> {
    return this.templateList;
  }

  async createChannelApiKey(partner: { partnerId: string; apiKey: string }, channelId: string): Promise<{ apiKey: string; address: string }> {
    if (this.partnerError) throw this.partnerError;
    this.channelKeys.push({ partner, channelId });
    return { apiKey: `key-${channelId}`, address: '51987654321' };
  }
```
Dentro de `reset()` agregar:
```ts
    this.templatesCreated = [];
    this.templateList = [];
    this.channelKeys = [];
    this.partnerError = null;
    this.templateCreateError = null;
```

En `apps/api/test/utils.ts`, `seedWhatsapp`:
- Agregar `templates?: boolean` a `opts`.
- Reemplazar el `return repo.save(...)` por:
```ts
  const account = await repo.save(
    repo.create({
      clinicId,
      phoneNumber: opts.phone ?? '+51900000000',
      sandbox: opts.sandbox ?? false,
      apiKeyEnc: encrypt(opts.apiKey ?? 'key-123'),
      webhookToken: opts.token ?? `tok-${clinicId}`,
      status: opts.status ?? WaAccountStatus.CONNECTED,
    }),
  );
  if (opts.templates ?? !account.sandbox) {
    await app.get(DataSource).query(
      `INSERT INTO whatsapp_templates (clinic_id, name, status) VALUES ($1,'recordatorio_cita_24h','APPROVED'),($1,'recordatorio_cita_2h','APPROVED'),($1,'recordatorio_pago','APPROVED')`,
      [clinicId],
    );
  }
  return account;
```

`apps/api/test/templates.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { TemplateStatusPoller } from '../src/whatsapp/template-status.poller';
import { FakeD360 } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedUser } from './utils';

describe('plantillas de WhatsApp', () => {
  let app: INestApplication;
  let d360: FakeD360;
  let ds: DataSource;
  let root: ReturnType<typeof request.agent>;
  let clinicId: string;

  const rows = async () =>
    ds.query(`SELECT name, status, rejection_reason FROM whatsapp_templates WHERE clinic_id = $1 ORDER BY name`, [clinicId]);
  const connect = (sandbox = false) =>
    root.put(`/api/admin/clinics/${clinicId}/whatsapp`).send({ apiKey: 'clave-real-123', phoneNumber: '987654321', sandbox }).expect(200);

  beforeAll(async () => {
    ({ app, d360 } = await createAppWithFakes());
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    d360.reset();
    await resetDb(app);
    clinicId = (await seedClinic(app)).id;
    await seedUser(app, { email: 'root@x.com', password: 'secreta123', role: Role.SUPERADMIN });
    root = request.agent(app.getHttpServer());
    await root.post('/api/auth/login').send({ email: 'root@x.com', password: 'secreta123' }).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('al conectar (producción) crea las 3 plantillas y las registra como PENDING', async () => {
    await connect();
    expect(d360.templatesCreated.map((t) => t.payload.name)).toEqual(['recordatorio_cita_24h', 'recordatorio_cita_2h', 'recordatorio_pago']);
    expect(d360.templatesCreated[0].creds).toEqual({ apiKey: 'clave-real-123', sandbox: false });
    expect(await rows()).toEqual([
      { name: 'recordatorio_cita_24h', status: 'PENDING', rejection_reason: null },
      { name: 'recordatorio_cita_2h', status: 'PENDING', rejection_reason: null },
      { name: 'recordatorio_pago', status: 'PENDING', rejection_reason: null },
    ]);
  });

  it('en sandbox no crea plantillas', async () => {
    await connect(true);
    expect(d360.templatesCreated).toHaveLength(0);
    expect(await rows()).toEqual([]);
  });

  it('el poller actualiza estados y guarda el motivo de rechazo', async () => {
    await connect();
    d360.templateList = [
      { name: 'recordatorio_cita_24h', status: 'APPROVED' },
      { name: 'recordatorio_cita_2h', status: 'approved' },
      { name: 'recordatorio_pago', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' },
    ];
    expect(await app.get(TemplateStatusPoller).runOnce()).toBe(1);
    expect(await rows()).toEqual([
      { name: 'recordatorio_cita_24h', status: 'APPROVED', rejection_reason: null },
      { name: 'recordatorio_cita_2h', status: 'APPROVED', rejection_reason: null },
      { name: 'recordatorio_pago', status: 'REJECTED', rejection_reason: 'INVALID_FORMAT' },
    ]);
  });

  it('reconectar no duplica filas y un error "ya existe" no rompe la conexión', async () => {
    await connect();
    d360.templateCreateError = new Error('Template name already exists');
    const res = await connect();
    expect(res.body.status).toBe('CONNECTED');
    expect(await rows()).toHaveLength(3);
  });
});
```

Run: `npm run test:e2e -w @recep/api -- templates`
Expected: FAIL ("Cannot find module '../src/whatsapp/template-status.poller'").

- [ ] **Step 2: Servicio de plantillas y poller**

`apps/api/src/whatsapp/whatsapp-templates.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { D360Client, D360Credentials } from './d360-client';
import { normalizeTemplateStatus, TEMPLATE_DEFS, templateCreatePayload } from './templates';
import { WaTemplateStatus, WhatsappTemplate } from './whatsapp-template.entity';

export interface TemplateDto {
  name: string;
  status: WaTemplateStatus;
  rejectionReason: string | null;
}

@Injectable()
export class WhatsappTemplatesService {
  private readonly logger = new Logger(WhatsappTemplatesService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly d360: D360Client) {}

  /** Crea en 360dialog las plantillas del spec (si ya existen, sigue) y sincroniza su estado. */
  async provision(clinicId: string, creds: D360Credentials): Promise<void> {
    for (const def of TEMPLATE_DEFS) {
      try {
        await this.d360.createTemplate(creds, templateCreatePayload(def));
      } catch (e) {
        this.logger.warn(`Plantilla ${def.name} (${clinicId}): ${(e as Error).message}`);
      }
      await this.ds.query(
        `INSERT INTO whatsapp_templates (clinic_id, name) VALUES ($1, $2) ON CONFLICT (clinic_id, name) DO NOTHING`,
        [clinicId, def.name],
      );
    }
    await this.refresh(clinicId, creds).catch((e) => this.logger.warn(`No se pudo consultar plantillas: ${(e as Error).message}`));
  }

  async refresh(clinicId: string, creds: D360Credentials): Promise<void> {
    const remote = await this.d360.listTemplates(creds);
    for (const def of TEMPLATE_DEFS) {
      const t = remote.find((r) => r.name === def.name);
      if (!t) continue;
      const status = normalizeTemplateStatus(t.status);
      await this.ds.getRepository(WhatsappTemplate).update(
        { clinicId, name: def.name },
        { status, rejectionReason: status === WaTemplateStatus.REJECTED ? (t.rejected_reason ?? 'Rechazada por Meta') : null },
      );
    }
  }

  async list(clinicId: string): Promise<TemplateDto[]> {
    const rows = await this.ds.getRepository(WhatsappTemplate).find({ where: { clinicId }, order: { name: 'ASC' } });
    return rows.map((t) => ({ name: t.name, status: t.status, rejectionReason: t.rejectionReason }));
  }

  async approvedNames(clinicId: string): Promise<Set<string>> {
    const rows = await this.ds.getRepository(WhatsappTemplate).findBy({ clinicId, status: WaTemplateStatus.APPROVED });
    return new Set(rows.map((t) => t.name));
  }
}
```

`apps/api/src/whatsapp/template-status.poller.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WhatsappAccount } from './whatsapp-account.entity';
import { WhatsappAccountsService } from './whatsapp-accounts.service';
import { WhatsappTemplatesService } from './whatsapp-templates.service';

/** Cada 15 min consulta 360dialog para los consultorios con plantillas aún no aprobadas. */
@Injectable()
export class TemplateStatusPoller {
  private readonly logger = new Logger(TemplateStatusPoller.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly accounts: WhatsappAccountsService,
    private readonly templates: WhatsappTemplatesService,
  ) {}

  @Cron('0 */15 * * * *')
  async tick(): Promise<void> {
    if (process.env.SCHEDULER_ENABLED === 'false') return;
    await this.runOnce().catch((e) => this.logger.error(e));
  }

  async runOnce(): Promise<number> {
    const clinicIds: { clinic_id: string }[] = await this.ds.query(
      `SELECT DISTINCT t.clinic_id FROM whatsapp_templates t
       JOIN whatsapp_accounts a ON a.clinic_id = t.clinic_id AND a.status = 'CONNECTED' AND NOT a.sandbox
       WHERE t.status = 'PENDING'`,
    );
    for (const { clinic_id } of clinicIds) {
      const account = await this.ds.getRepository(WhatsappAccount).findOneByOrFail({ clinicId: clinic_id });
      await this.templates
        .refresh(clinic_id, this.accounts.credentials(account))
        .catch((e) => this.logger.warn(`Plantillas de ${clinic_id}: ${(e as Error).message}`));
    }
    return clinicIds.length;
  }
}
```

- [ ] **Step 3: WhatsappAccountsService con `attach` (reemplazo completo)**

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
import { WhatsappTemplatesService } from './whatsapp-templates.service';
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
    private readonly templates: WhatsappTemplatesService,
  ) {}

  /** Conexión manual del superadmin (key pegada a mano). */
  async connect(clinicId: string, dto: ConnectWhatsappDto): Promise<WhatsappAccountDto> {
    if (!(await this.ds.getRepository(Clinic).findOneBy({ id: clinicId }))) throw new NotFoundException('Consultorio no encontrado');
    return this.attach(clinicId, { apiKey: dto.apiKey, phoneNumber: dto.phoneNumber, sandbox: dto.sandbox ?? false, displayName: dto.displayName });
  }

  /** Guarda la key cifrada, registra el webhook y (en producción) crea las plantillas. */
  async attach(
    clinicId: string,
    a: { apiKey: string; phoneNumber: string; sandbox: boolean; displayName?: string; channelId?: string },
  ): Promise<WhatsappAccountDto> {
    const phone = normalizePhone(a.phoneNumber.startsWith('+') ? a.phoneNumber : `+${a.phoneNumber}`) ?? normalizePhone(a.phoneNumber);
    if (!phone) throw new BadRequestException('Teléfono inválido');

    const repo = this.ds.getRepository(WhatsappAccount);
    const account = (await repo.findOneBy({ clinicId })) ?? repo.create({ clinicId, webhookToken: randomBytes(24).toString('base64url') });
    account.phoneNumber = phone;
    account.displayName = a.displayName?.trim() || null;
    account.sandbox = a.sandbox;
    account.channelId = a.channelId ?? account.channelId ?? null;
    account.apiKeyEnc = encrypt(a.apiKey);
    account.status = WaAccountStatus.PENDING;
    account.lastError = null;
    await repo.save(account);

    const creds = { apiKey: a.apiKey, sandbox: a.sandbox };
    try {
      await this.d360.setWebhook(creds, this.webhookUrl(account));
      account.status = WaAccountStatus.CONNECTED;
    } catch (e) {
      account.status = WaAccountStatus.ERROR;
      account.lastError = (e as Error).message;
    }
    await repo.save(account);
    if (account.status === WaAccountStatus.CONNECTED && !a.sandbox) await this.templates.provision(clinicId, creds);
    return this.toDto(account);
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

`apps/api/src/whatsapp/whatsapp.module.ts` (reemplazo completo):
```ts
import { Module } from '@nestjs/common';
import { AdminWhatsappController } from './admin-whatsapp.controller';
import { D360Client } from './d360-client';
import { MessagesService } from './messages.service';
import { TemplateStatusPoller } from './template-status.poller';
import { WhatsappAccountsService } from './whatsapp-accounts.service';
import { WhatsappTemplatesService } from './whatsapp-templates.service';

@Module({
  controllers: [AdminWhatsappController],
  providers: [D360Client, WhatsappAccountsService, MessagesService, WhatsappTemplatesService, TemplateStatusPoller],
  exports: [D360Client, WhatsappAccountsService, MessagesService, WhatsappTemplatesService],
})
export class WhatsappModule {}
```

- [ ] **Step 4: Tests pasan**

Run: `npm run test:api`
Expected: PASS (`plantillas de WhatsApp`: 4 tests; el resto verde, incluido `whatsapp accounts (superadmin)`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): provision WhatsApp templates on connect and poll their approval status"
```

---

### Task 5: Onboarding del dueño (start / complete / estado)

**Files:**
- Create: `apps/api/src/whatsapp/onboarding.service.ts`, `apps/api/src/whatsapp/onboarding.controller.ts`
- Modify: `apps/api/src/whatsapp/whatsapp.module.ts` (controlador y servicio), `apps/api/test/env.ts`, `.env.example`
- Test: `apps/api/test/onboarding.e2e-spec.ts`

**Interfaces:**
- Consumes: `onboardingUrl`, `parseChannels`, `D360Client.createChannelApiKey`, `WhatsappAccountsService.attach` / `get`, `WhatsappTemplatesService.list`, `Clock`.
- Produces (solo OWNER):
  - `POST /api/whatsapp/onboarding/start` → `{ url }` (503 si falta configuración)
  - `POST /api/whatsapp/onboarding/complete` `{ state, channels }` → `{ account: WhatsappAccountDto, templates: TemplateDto[] }`
  - `GET /api/whatsapp` → `{ account: WhatsappAccountDto | null, templates: TemplateDto[] }`
  - Variables de entorno: `D360_PARTNER_ID`, `D360_PARTNER_API_KEY`.

- [ ] **Step 1: Variables y test (falla)**

`apps/api/test/env.ts`, agregar al final:
```ts
process.env.D360_PARTNER_ID = 'partner-test';
process.env.D360_PARTNER_API_KEY = 'pk-test';
```

`.env.example`, agregar debajo de `SCHEDULER_ENABLED`:
```
# 360dialog Partner (Integrated Onboarding). Partner ID y API key del Partner Hub (sección API Keys)
D360_PARTNER_ID=
D360_PARTNER_API_KEY=
```

`apps/api/test/onboarding.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { FakeClock, FakeD360 } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedUser } from './utils';

describe('onboarding de WhatsApp (dueño)', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let d360: FakeD360;
  let ds: DataSource;
  let owner: ReturnType<typeof request.agent>;

  const loginAs = async (email: string) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: 'secreta123' }).expect(200);
    return agent;
  };
  const start = async (agent = owner) => {
    const res = await agent.post('/api/whatsapp/onboarding/start').expect(201);
    return new URL(res.body.url).searchParams.get('state')!;
  };

  beforeAll(async () => {
    ({ app, clock, d360 } = await createAppWithFakes('2026-10-06T12:00:00Z'));
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    clock.set('2026-10-06T12:00:00Z');
    d360.reset();
    await resetDb(app);
    const a = await seedClinic(app, 'A');
    const b = await seedClinic(app, 'B');
    await seedUser(app, { email: 'owner@a.com', password: 'secreta123', role: Role.OWNER, clinicId: a.id });
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId: a.id });
    await seedUser(app, { email: 'owner@b.com', password: 'secreta123', role: Role.OWNER, clinicId: b.id });
    owner = await loginAs('owner@a.com');
  });
  afterAll(async () => { await app.close(); });

  it('start devuelve la URL del popup con partner, redirect y state', async () => {
    const res = await owner.post('/api/whatsapp/onboarding/start').expect(201);
    const url = new URL(res.body.url);
    expect(url.pathname).toBe('/dashboard/app/partner-test/permissions');
    expect(url.searchParams.get('redirect_url')).toBe('http://web.test/app/settings/whatsapp/callback');
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const [row] = await ds.query('SELECT state_hash FROM whatsapp_onboarding_states');
    expect(row.state_hash).not.toBe(url.searchParams.get('state'));
  });

  it('complete genera la key del canal, conecta, crea plantillas y no expone la key', async () => {
    const state = await start();
    const res = await owner.post('/api/whatsapp/onboarding/complete').send({ state, channels: '[ch_1]' }).expect(201);
    expect(d360.channelKeys).toEqual([{ partner: { partnerId: 'partner-test', apiKey: 'pk-test' }, channelId: 'ch_1' }]);
    expect(res.body.account).toEqual(expect.objectContaining({ phoneNumber: '+51987654321', status: 'CONNECTED', sandbox: false }));
    expect(res.body.templates.map((t: { name: string }) => t.name)).toEqual(['recordatorio_cita_24h', 'recordatorio_cita_2h', 'recordatorio_pago']);
    expect(JSON.stringify(res.body)).not.toContain('key-ch_1');
    expect(d360.webhooks[0].creds.apiKey).toBe('key-ch_1');
    const [acc] = await ds.query('SELECT channel_id, api_key_enc FROM whatsapp_accounts');
    expect(acc.channel_id).toBe('ch_1');
    expect(acc.api_key_enc).not.toContain('key-ch_1');
    const status = await owner.get('/api/whatsapp').expect(200);
    expect(status.body.account.status).toBe('CONNECTED');
    expect(status.body.templates).toHaveLength(3);
  });

  it('state reutilizado, vencido o de otro consultorio → 400', async () => {
    const used = await start();
    await owner.post('/api/whatsapp/onboarding/complete').send({ state: used, channels: '[ch_1]' }).expect(201);
    await owner.post('/api/whatsapp/onboarding/complete').send({ state: used, channels: '[ch_1]' }).expect(400);

    const expired = await start();
    clock.set('2026-10-06T12:31:00Z');
    await owner.post('/api/whatsapp/onboarding/complete').send({ state: expired, channels: '[ch_1]' }).expect(400);

    clock.set('2026-10-06T12:00:00Z');
    const ownerB = await loginAs('owner@b.com');
    const stateB = await start(ownerB);
    await owner.post('/api/whatsapp/onboarding/complete').send({ state: stateB, channels: '[ch_1]' }).expect(400);
    expect(d360.channelKeys).toHaveLength(1);
  });

  it('sin canales válidos → 400; error de la Partner API → 502', async () => {
    await owner.post('/api/whatsapp/onboarding/complete').send({ state: await start(), channels: '[]' }).expect(400);
    d360.partnerError = new Error('channel not running');
    const res = await owner.post('/api/whatsapp/onboarding/complete').send({ state: await start(), channels: 'ch_2' }).expect(502);
    expect(res.body.message).toContain('channel not running');
  });

  it('solo el dueño; sin configuración del partner → 503', async () => {
    const recep = await loginAs('recep@a.com');
    await recep.post('/api/whatsapp/onboarding/start').expect(403);
    await recep.get('/api/whatsapp').expect(403);
    const prev = process.env.D360_PARTNER_API_KEY;
    process.env.D360_PARTNER_API_KEY = '';
    await owner.post('/api/whatsapp/onboarding/start').expect(503);
    process.env.D360_PARTNER_API_KEY = prev;
  });
});
```

Run: `npm run test:e2e -w @recep/api -- onboarding.e2e`
Expected: FAIL (404 en `/api/whatsapp/onboarding/start`).

- [ ] **Step 2: Servicio y controlador**

`apps/api/src/whatsapp/onboarding.service.ts`:
```ts
import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { AuthUser } from '../auth/session';
import { Clock } from '../common/clock';
import { D360Client, PartnerCredentials } from './d360-client';
import { onboardingUrl, parseChannels } from './onboarding';
import { OnboardingState } from './onboarding-state.entity';
import { WhatsappAccountDto, WhatsappAccountsService } from './whatsapp-accounts.service';
import { TemplateDto, WhatsappTemplatesService } from './whatsapp-templates.service';

const STATE_TTL_MS = 30 * 60_000;
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');

@Injectable()
export class OnboardingService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly config: ConfigService,
    private readonly clock: Clock,
    private readonly d360: D360Client,
    private readonly accounts: WhatsappAccountsService,
    private readonly templates: WhatsappTemplatesService,
  ) {}

  async start(user: AuthUser): Promise<{ url: string }> {
    const partner = this.partner();
    const state = randomBytes(32).toString('base64url');
    await this.ds.getRepository(OnboardingState).insert({
      clinicId: user.clinicId!,
      userId: user.id,
      stateHash: hash(state),
      expiresAt: new Date(this.clock.now().getTime() + STATE_TTL_MS),
    });
    const redirect = `${this.config.getOrThrow<string>('WEB_URL')}/app/settings/whatsapp/callback`;
    return { url: onboardingUrl(partner.partnerId, redirect, state) };
  }

  async complete(user: AuthUser, state: string, channels: string): Promise<{ account: WhatsappAccountDto; templates: TemplateDto[] }> {
    const partner = this.partner();
    // Consumo atómico del state: un solo uso, vigente y del mismo consultorio.
    const consumed = await this.ds.getRepository(OnboardingState).update(
      { stateHash: hash(state), clinicId: user.clinicId!, usedAt: IsNull(), expiresAt: MoreThan(this.clock.now()) },
      { usedAt: this.clock.now() },
    );
    if (!consumed.affected) throw new BadRequestException('La conexión expiró o no es válida; vuelve a intentarlo');

    const [channelId] = parseChannels(channels);
    if (!channelId) throw new BadRequestException('360dialog no devolvió ningún número conectado');

    let key: { apiKey: string; address: string };
    try {
      key = await this.d360.createChannelApiKey(partner, channelId);
    } catch (e) {
      throw new BadGatewayException(`360dialog no entregó la API key: ${(e as Error).message}`);
    }
    const account = await this.accounts.attach(user.clinicId!, {
      apiKey: key.apiKey,
      phoneNumber: key.address,
      sandbox: false,
      channelId,
    });
    return { account, templates: await this.templates.list(user.clinicId!) };
  }

  async status(clinicId: string): Promise<{ account: WhatsappAccountDto | null; templates: TemplateDto[] }> {
    const { account } = await this.accounts.get(clinicId);
    return { account, templates: await this.templates.list(clinicId) };
  }

  private partner(): PartnerCredentials {
    const partnerId = this.config.get<string>('D360_PARTNER_ID');
    const apiKey = this.config.get<string>('D360_PARTNER_API_KEY');
    if (!partnerId || !apiKey) throw new ServiceUnavailableException('Onboarding de WhatsApp no configurado');
    return { partnerId, apiKey };
  }
}
```

`apps/api/src/whatsapp/onboarding.controller.ts`:
```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { Role } from '../users/role.enum';
import { OnboardingService } from './onboarding.service';

class CompleteOnboardingDto {
  @IsString() @MaxLength(200) state: string;
  @IsString() @MaxLength(500) channels: string;
}

@Roles(Role.OWNER)
@Controller('whatsapp')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  status(@CurrentUser() me: AuthUser) {
    return this.onboarding.status(me.clinicId!);
  }

  @Post('onboarding/start')
  start(@CurrentUser() me: AuthUser) {
    return this.onboarding.start(me);
  }

  @Post('onboarding/complete')
  complete(@CurrentUser() me: AuthUser, @Body() dto: CompleteOnboardingDto) {
    return this.onboarding.complete(me, dto.state, dto.channels);
  }
}
```

En `apps/api/src/whatsapp/whatsapp.module.ts`:
- Agregar `OnboardingController` a `controllers` y `OnboardingService` a `providers`, con sus imports.

- [ ] **Step 3: Tests pasan**

Run: `npm run test:api`
Expected: PASS (`onboarding de WhatsApp (dueño)`: 5 tests).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add owner WhatsApp onboarding via 360dialog Integrated Onboarding"
```

---

### Task 6: El despachador exige plantilla aprobada

**Files:**
- Modify: `apps/api/src/scheduler/reminder-dispatcher.ts`
- Test: `apps/api/test/dispatcher-templates.e2e-spec.ts`

**Interfaces:**
- Consumes: `WhatsappTemplatesService.approvedNames`, `TEMPLATE_FOR_KIND`.

- [ ] **Step 1: Test (falla)**

`apps/api/test/dispatcher-templates.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ReminderDispatcher } from '../src/scheduler/reminder-dispatcher';
import { Role } from '../src/users/role.enum';
import { FakeClock, FakeD360 } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedPatient, seedService, seedUser, seedWhatsapp } from './utils';

describe('despachador y plantillas aprobadas', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let d360: FakeD360;
  let ds: DataSource;
  let clinicId: string;
  let apptId: string;

  const sm = async () => (await ds.query(`SELECT status, last_error, cancel_reason, send_at FROM scheduled_messages WHERE appointment_id = $1 AND kind = 'REMINDER_24H'`, [apptId]))[0];

  beforeAll(async () => {
    ({ app, clock, d360 } = await createAppWithFakes());
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    clock.set('2026-10-01T12:00:00Z');
    d360.reset();
    await resetDb(app);
    clinicId = (await seedClinic(app)).id;
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId });
    const patientId = (await seedPatient(app, clinicId)).id;
    const serviceId = (await seedService(app, clinicId)).id;
    const recep = request.agent(app.getHttpServer());
    await recep.post('/api/auth/login').send({ email: 'recep@a.com', password: 'secreta123' }).expect(200);
    apptId = (await recep.post('/api/appointments').send({ patientId, serviceId, date: '2026-10-02', time: '09:30' }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('con la plantilla pendiente pospone; al aprobarse envía', async () => {
    await seedWhatsapp(app, clinicId, { templates: false });
    await ds.query(`INSERT INTO whatsapp_templates (clinic_id, name) VALUES ($1, 'recordatorio_cita_24h')`, [clinicId]);
    clock.set('2026-10-01T14:31:00Z');
    await app.get(ReminderDispatcher).runOnce();
    expect(await sm()).toEqual(expect.objectContaining({
      status: 'PENDING', last_error: 'Plantilla no aprobada todavía', send_at: new Date('2026-10-01T14:46:00Z'),
    }));
    expect(d360.sent).toHaveLength(0);

    await ds.query(`UPDATE whatsapp_templates SET status = 'APPROVED' WHERE clinic_id = $1`, [clinicId]);
    clock.set('2026-10-01T14:46:00Z');
    await app.get(ReminderDispatcher).runOnce();
    expect((await sm()).status).toBe('SENT');
  });

  it('plantilla rechazada y cita ya cercana → cancela con el motivo', async () => {
    await seedWhatsapp(app, clinicId, { templates: false });
    await ds.query(`INSERT INTO whatsapp_templates (clinic_id, name, status) VALUES ($1, 'recordatorio_cita_24h', 'REJECTED')`, [clinicId]);
    clock.set('2026-10-02T14:20:00Z'); // faltan 10 min para la cita
    await app.get(ReminderDispatcher).runOnce();
    expect(await sm()).toEqual(expect.objectContaining({ status: 'CANCELLED', cancel_reason: 'Plantilla no aprobada todavía' }));
  });

  it('en sandbox no se exigen plantillas', async () => {
    await seedWhatsapp(app, clinicId, { sandbox: true });
    clock.set('2026-10-01T14:31:00Z');
    await app.get(ReminderDispatcher).runOnce();
    expect((await sm()).status).toBe('SENT');
  });
});
```

Run: `npm run test:e2e -w @recep/api -- dispatcher-templates`
Expected: FAIL (el primer test envía en vez de posponer).

- [ ] **Step 2: Implementación**

En `apps/api/src/scheduler/reminder-dispatcher.ts`:

1. **Imports:** agregar estos dos:
   ```ts
   import { TEMPLATE_FOR_KIND } from '../whatsapp/templates';
   import { WhatsappTemplatesService } from '../whatsapp/whatsapp-templates.service';
   ```
2. **Constante:** debajo de `const NOT_CONNECTED = 'WhatsApp no conectado';`, agregar:
   ```ts
   const TEMPLATE_NOT_APPROVED = 'Plantilla no aprobada todavía';
   ```
3. **`interface Context`:** agregar el campo `approved: Set<string>;`.
4. **Constructor:** agregar el parámetro `private readonly templates: WhatsappTemplatesService,` al final.
5. **`loadContext`:** cambiar el `return` por:
   ```ts
   const account = await this.accounts.forClinic(sm.clinicId);
   const approved = account && !account.sandbox ? await this.templates.approvedNames(sm.clinicId) : new Set<string>();
   return { clinic, appt, account, approved };
   ```
6. **`skipReason`:** cambiar la firma para recibir también `approved` (`{ clinic, appt, account, approved }: Context`). Justo después de la línea `if (!account || account.status !== WaAccountStatus.CONNECTED) return NOT_CONNECTED;`, agregar:
   ```ts
   const templateName = TEMPLATE_FOR_KIND[sm.kind as 'REMINDER_24H' | 'REMINDER_2H'];
   if (!account.sandbox && templateName && !approved.has(templateName)) return TEMPLATE_NOT_APPROVED;
   ```
7. **`process`:** reemplazar la condición
   ```ts
   if (reason === NOT_CONNECTED && ctx.appt && ctx.appt.startsAt.getTime() > now + POSTPONE_MS) {
   ```
   por:
   ```ts
   if ((reason === NOT_CONNECTED || reason === TEMPLATE_NOT_APPROVED) && ctx.appt && ctx.appt.startsAt.getTime() > now + POSTPONE_MS) {
   ```
   En la línea siguiente, usar `lastError: reason` en lugar de `lastError: NOT_CONNECTED`.

- [ ] **Step 3: Tests pasan**

Run: `npm run test:api`
Expected: PASS (`despachador y plantillas aprobadas`: 3 tests; `despachador de recordatorios` y `correcciones de la revisión final` siguen verdes porque `seedWhatsapp` siembra plantillas aprobadas).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): only send reminders with approved templates (postpone while pending)"
```

---

### Task 7: Panel — conectar WhatsApp desde Configuración

**Files:**
- Modify: `apps/web/src/lib/types.ts` (+ `WaTemplate`, `WaStatus`), `apps/web/src/app/app/settings/page.tsx` (tarjeta WhatsApp)
- Create: `apps/web/src/app/app/settings/whatsapp/callback/page.tsx`
- Modify: `README.md`, `docs/HANDOFF.md`

**Interfaces:**
- Consumes: `GET /api/whatsapp`, `POST /api/whatsapp/onboarding/start`, `POST /api/whatsapp/onboarding/complete`.

- [ ] **Step 1: Tipos y tarjeta**

Agregar al final de `apps/web/src/lib/types.ts`:
```ts
export interface WaTemplate {
  name: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  rejectionReason: string | null;
}

export interface WaStatus {
  account: WaAccount | null;
  templates: WaTemplate[];
}
```

En `apps/web/src/app/app/settings/page.tsx`:
- Agregar `WaStatus` al import de tipos.
- Agregar este componente encima de `export default function SettingsPage()`:
```tsx
const TEMPLATE_LABEL: Record<string, string> = {
  recordatorio_cita_24h: 'Recordatorio 24 h',
  recordatorio_cita_2h: 'Recordatorio 2 h',
  recordatorio_pago: 'Recordatorio de pago',
};
const TEMPLATE_STATUS: Record<string, string> = {
  PENDING: 'En revisión',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  PAUSED: 'Pausada',
  DISABLED: 'Deshabilitada',
};

function WhatsappCard() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<WaStatus>('/whatsapp').then(setStatus).catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    load();
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === 'wa-connected') load();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load]);

  async function connect() {
    setError('');
    try {
      const { url } = await api<{ url: string }>('/whatsapp/onboarding/start', { method: 'POST' });
      const popup = window.open(url, 'd360-onboarding', 'width=600,height=800');
      if (!popup) window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const ready = !!status?.account && status.account.status === 'CONNECTED' &&
    status.templates.length > 0 && status.templates.every((t) => t.status === 'APPROVED' || t.name === 'recordatorio_pago');

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">WhatsApp</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status?.account ? (
          <div className="space-y-1">
            <p>
              Número {status.account.phoneNumber} ·{' '}
              <span className={status.account.status === 'CONNECTED' ? 'text-emerald-700' : 'text-red-600'}>
                {status.account.status === 'CONNECTED' ? 'Conectado' : status.account.status === 'ERROR' ? 'Con error' : 'Conectando'}
              </span>
            </p>
            {status.account.lastError && <p className="text-red-600">{status.account.lastError}</p>}
            {ready && <p className="font-medium text-emerald-700">✅ Listo para enviar recordatorios</p>}
          </div>
        ) : (
          <p className="text-slate-500">Todavía no conectaste el WhatsApp del consultorio.</p>
        )}
        {!!status?.templates.length && (
          <ul className="divide-y rounded border">
            {status.templates.map((t) => (
              <li key={t.name} className="flex flex-wrap justify-between gap-2 p-2">
                <span>{TEMPLATE_LABEL[t.name] ?? t.name}</span>
                <span className={t.status === 'APPROVED' ? 'text-emerald-700' : t.status === 'PENDING' ? 'text-amber-700' : 'text-red-600'}>
                  {TEMPLATE_STATUS[t.status]}
                  {t.rejectionReason && ` · ${t.rejectionReason}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">
          Si usas este número en la app WhatsApp Business, en la ventana de conexión elige “Yes, this number is connected to the
          WhatsApp Business App” para seguir usándola.
        </p>
        <Button type="button" onClick={connect}>{status?.account ? 'Reconectar WhatsApp' : 'Conectar WhatsApp'}</Button>
        {error && <p className="text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
```
- En el JSX de `SettingsPage`, agregar `<WhatsappCard />` justo después de `<ClinicDataCard … />`.

- [ ] **Step 2: Página de callback**

`apps/web/src/app/app/settings/whatsapp/callback/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState('Conectando tu WhatsApp…');
  const [failed, setFailed] = useState(false);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const state = params.get('state') ?? '';
    const channels = params.get('channels') ?? '';
    api('/whatsapp/onboarding/complete', { method: 'POST', body: JSON.stringify({ state, channels }) })
      .then(() => {
        setMessage('✅ WhatsApp conectado. Las plantillas quedaron en revisión de Meta (puede tardar hasta 24 h).');
        if (window.opener) {
          window.opener.postMessage({ type: 'wa-connected' }, window.location.origin);
          window.close();
        } else {
          setTimeout(() => router.replace('/app/settings'), 2000);
        }
      })
      .catch((e) => {
        setFailed(true);
        setMessage((e as Error).message);
      });
  }, [params, router]);

  return (
    <main className="mx-auto max-w-md space-y-4 p-8 text-center">
      <p className={failed ? 'text-red-600' : ''}>{message}</p>
      {failed && <Link href="/app/settings" className="text-sm underline">Volver a Configuración</Link>}
    </main>
  );
}

export default function WhatsappCallbackPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center">Cargando…</p>}>
      <Callback />
    </Suspense>
  );
}
```

- [ ] **Step 3: Documentación**

Agregar al final de `README.md`:
````markdown
## Conectar WhatsApp por consultorio (Etapa 4)

1. **Credenciales del partner:** en el Partner Hub de 360dialog, obtener el Partner ID y generar una API key (sección API Keys). Ponerlos en `.env`:
   - `D360_PARTNER_ID=…`
   - `D360_PARTNER_API_KEY=…`

   Elegir **Partner Payment** (tú pagas 360dialog y Meta).
2. **Redirect URL:** en el Partner Hub, configurar como redirect URL `${WEB_URL}/app/settings/whatsapp/callback`.
3. **Conectar:** el dueño entra a **Configuración → WhatsApp → Conectar WhatsApp**, completa el popup y vuelve. Las 3 plantillas se crean solas y su estado se actualiza cada 15 min. Cuando están aprobadas, aparece "Listo para enviar".
4. **Si falla la key del canal:** si 360dialog responde que el canal no está listo ("not running"), esperar unos minutos y reconectar.
````

En `docs/HANDOFF.md`:
- Agregar la línea: "**Etapa 4 (onboarding): completada.** El dueño conecta su número con el popup de 360dialog, las plantillas se crean solas, un poller las sigue cada 15 min y el despachador solo envía con plantillas aprobadas."
- Cambiar el siguiente paso a "Plan 5 (cobros y recordatorio de pago)".
- Actualizar el prompt de retomar a: "escribe el Plan 5 (Etapa 5: cobros y recordatorio de pago) con superpowers:writing-plans".

- [ ] **Step 4: Verificación completa**

Run: `npm run test:api && npm run build -w @recep/api && npm run build -w @recep/web`
Expected: todo en verde; el build incluye la ruta `/app/settings/whatsapp/callback`.

Prueba manual (HTTP, con API y panel levantados):
1. Como dueño, `POST /api/whatsapp/onboarding/start`. Se espera un `url` hacia `app.360dialog.com/.../permissions` con el state.
2. Abrir `http://localhost:3000/app/settings/whatsapp/callback?state=malo&channels=[x]`. Se espera el mensaje "La conexión expiró o no es válida…".

La prueba real con 360dialog la hace el usuario cuando tenga su cuenta Partner.

Expected: los dos pasos se comportan como se describe.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): let owners connect WhatsApp via 360dialog popup and see template approval; document partner setup"
```

---

## Siguientes planes

**Plan 5 (Etapa 5):** cobros (`charges`), recordatorio de pago con la plantilla `recordatorio_pago` (el despachador ya tiene el tipo `PAYMENT_REMINDER`) y la pantalla de cobros del panel.
