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
