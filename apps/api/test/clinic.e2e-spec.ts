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
