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
