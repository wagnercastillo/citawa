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
