import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedUser } from './utils';

describe('auth', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(async () => { await resetDb(app); });
  afterAll(async () => { await app.close(); });

  it('login correcto setea cookie httpOnly y /me devuelve el usuario con su clínica', async () => {
    const clinic = await seedClinic(app, 'Sonrisas');
    await seedUser(app, { email: 'ana@a.com', password: 'secreta123', role: Role.OWNER, clinicId: clinic.id, name: 'Ana' });
    const agent = request.agent(app.getHttpServer());

    const res = await agent.post('/api/auth/login').send({ email: 'ana@a.com', password: 'secreta123' }).expect(200);
    expect(res.headers['set-cookie'][0]).toMatch(/^session=.+HttpOnly/);
    expect(res.body).toEqual({
      id: expect.any(String), name: 'Ana', email: 'ana@a.com', role: 'OWNER',
      clinic: { id: clinic.id, name: 'Sonrisas', subscriptionStatus: 'ACTIVE' },
    });

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.email).toBe('ana@a.com');
  });

  it('contraseña incorrecta y email desconocido dan el mismo 401', async () => {
    await seedUser(app, { email: 'ana@a.com', password: 'secreta123', role: Role.SUPERADMIN });
    const a = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'ana@a.com', password: 'mala1234' }).expect(401);
    const b = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'nadie@a.com', password: 'mala1234' }).expect(401);
    expect(a.body.message).toBe('Email o contraseña incorrectos');
    expect(b.body.message).toBe(a.body.message);
  });

  it('usuario con invitación pendiente (sin contraseña) no puede hacer login', async () => {
    await seedUser(app, { email: 'p@a.com', role: Role.SUPERADMIN });
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'p@a.com', password: 'cualquiera1' }).expect(401);
  });

  it('/me sin cookie da 401', () => request(app.getHttpServer()).get('/api/auth/me').expect(401));

  it('usuario desactivado pierde acceso aunque tenga la cookie', async () => {
    const u = await seedUser(app, { email: 'ana@a.com', password: 'secreta123', role: Role.SUPERADMIN });
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email: 'ana@a.com', password: 'secreta123' }).expect(200);
    await app.get(DataSource).query('UPDATE users SET active = false WHERE id = $1', [u.id]);
    await agent.get('/api/auth/me').expect(401);
  });

  it('logout borra la cookie', async () => {
    await seedUser(app, { email: 'ana@a.com', password: 'secreta123', role: Role.SUPERADMIN });
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email: 'ana@a.com', password: 'secreta123' }).expect(200);
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('login valida el body', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'no-es-email' }).expect(400);
    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it('health sigue siendo público', () => request(app.getHttpServer()).get('/api/health').expect(200));
});
