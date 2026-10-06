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
    const s1 = await start();
    await owner.post('/api/whatsapp/onboarding/complete').send({ state: s1, channels: '[]' }).expect(400);
    d360.partnerError = new Error('channel not running');
    const s2 = await start();
    const res = await owner.post('/api/whatsapp/onboarding/complete').send({ state: s2, channels: 'ch_2' }).expect(502);
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
