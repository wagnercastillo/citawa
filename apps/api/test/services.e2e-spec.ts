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
