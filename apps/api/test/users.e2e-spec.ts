import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '../src/users/role.enum';
import { User } from '../src/users/user.entity';
import { createTestApp, resetDb, seedClinic, seedUser } from './utils';

describe('clinic users', () => {
  let app: INestApplication;
  let ownerA: ReturnType<typeof request.agent>;
  let ownerAUser: User;
  let recepB: User;

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
    ownerAUser = await seedUser(app, { email: 'owner@a.com', password: 'secreta123', role: Role.OWNER, clinicId: a.id });
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId: a.id });
    await seedUser(app, { email: 'owner@b.com', password: 'secreta123', role: Role.OWNER, clinicId: b.id });
    recepB = await seedUser(app, { email: 'recep@b.com', password: 'secreta123', role: Role.RECEPTION, clinicId: b.id });
    await seedUser(app, { email: 'root@x.com', password: 'secreta123', role: Role.SUPERADMIN });
    ownerA = await loginAs('owner@a.com');
  });
  afterAll(async () => { await app.close(); });

  it('el OWNER invita a una recepcionista', async () => {
    const res = await ownerA.post('/api/users/invite').send({ name: 'Rosa', email: 'Rosa@A.com' }).expect(201);
    expect(res.body.user).toEqual(expect.objectContaining({ email: 'rosa@a.com', role: 'RECEPTION', pending: true, active: true }));
    expect(res.body.inviteUrl).toMatch(/\/invite\/.+/);
  });

  it('no se puede escalar privilegios enviando role o clinicId', async () => {
    await ownerA.post('/api/users/invite').send({ name: 'Xavier', email: 'x@a.com', role: 'OWNER' }).expect(400);
    await ownerA.post('/api/users/invite').send({ name: 'Xavier', email: 'x@a.com', clinicId: recepB.clinicId }).expect(400);
  });

  it('RECEPTION y SUPERADMIN no gestionan usuarios del consultorio', async () => {
    const recep = await loginAs('recep@a.com');
    await recep.post('/api/users/invite').send({ name: 'Xavier', email: 'x@a.com' }).expect(403);
    const root = await loginAs('root@x.com');
    await root.get('/api/users').expect(403);
  });

  it('la lista solo muestra usuarios del propio consultorio', async () => {
    const res = await ownerA.get('/api/users').expect(200);
    const emails = res.body.map((u: { email: string }) => u.email).sort();
    expect(emails).toEqual(['owner@a.com', 'recep@a.com']);
  });

  it('no puede tocar usuarios de otro consultorio (404)', async () => {
    await ownerA.patch(`/api/users/${recepB.id}`).send({ active: false }).expect(404);
    await ownerA.post(`/api/users/${recepB.id}/reinvite`).expect(404);
    const recepBAgent = await loginAs('recep@b.com');
    await recepBAgent.get('/api/auth/me').expect(200);
  });

  it('no puede desactivarse a sí mismo', () =>
    ownerA.patch(`/api/users/${ownerAUser.id}`).send({ active: false }).expect(400));

  it('desactivar a una recepcionista le quita el acceso', async () => {
    const list = await ownerA.get('/api/users').expect(200);
    const recep = list.body.find((u: { email: string }) => u.email === 'recep@a.com');
    const res = await ownerA.patch(`/api/users/${recep.id}`).send({ active: false }).expect(200);
    expect(res.body.active).toBe(false);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'recep@a.com', password: 'secreta123' }).expect(401);
  });

  it('reinvitar a una recepcionista pendiente devuelve un enlace nuevo; a una activa da 400', async () => {
    const inv = await ownerA.post('/api/users/invite').send({ name: 'Rosa', email: 'rosa@a.com' }).expect(201);
    const re = await ownerA.post(`/api/users/${inv.body.user.id}/reinvite`).expect(201);
    expect(re.body.inviteUrl).not.toEqual(inv.body.inviteUrl);
    const list = await ownerA.get('/api/users').expect(200);
    const active = list.body.find((u: { email: string }) => u.email === 'recep@a.com');
    await ownerA.post(`/api/users/${active.id}/reinvite`).expect(400);
  });

  it('email ya registrado da 409', () =>
    ownerA.post('/api/users/invite').send({ name: 'Xavier', email: 'recep@b.com' }).expect(409));
});
