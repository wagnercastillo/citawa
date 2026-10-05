import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedUser } from './utils';

describe('admin clinics', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof request.agent>;

  const tokenFrom = (url: string): string => url.split('/invite/')[1];

  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(async () => {
    await resetDb(app);
    await seedUser(app, { email: 'root@a.com', password: 'secreta123', role: Role.SUPERADMIN });
    admin = request.agent(app.getHttpServer());
    await admin.post('/api/auth/login').send({ email: 'root@a.com', password: 'secreta123' }).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('crea clínica, el dueño acepta la invitación (email normalizado) y queda logueado como OWNER', async () => {
    const res = await admin
      .post('/api/admin/clinics')
      .send({ name: 'Sonrisas', address: 'Av. Larco 123', ownerName: 'Ana', ownerEmail: ' Ana@Mail.com ' })
      .expect(201);
    expect(res.body.inviteUrl).toMatch(/^http:\/\/web\.test\/invite\/.+/);
    expect(res.body.clinic.owner).toEqual(expect.objectContaining({ email: 'ana@mail.com', role: 'OWNER', pending: true }));

    const token = tokenFrom(res.body.inviteUrl);
    const info = await request(app.getHttpServer()).get(`/api/auth/invite/${token}`).expect(200);
    expect(info.body).toEqual({ name: 'Ana', email: 'ana@mail.com' });

    const owner = request.agent(app.getHttpServer());
    const accepted = await owner.post('/api/auth/invite/accept').send({ token, password: 'clave1234' }).expect(200);
    expect(accepted.body.role).toBe('OWNER');
    expect(accepted.body.clinic.name).toBe('Sonrisas');
    await owner.get('/api/auth/me').expect(200);

    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'ANA@mail.com', password: 'clave1234' }).expect(200);
  });

  it('una invitación usada no se puede reutilizar', async () => {
    const res = await admin.post('/api/admin/clinics').send({ name: 'Clinica C', ownerName: 'Ana', ownerEmail: 'ana@a.com' }).expect(201);
    const token = tokenFrom(res.body.inviteUrl);
    await request(app.getHttpServer()).post('/api/auth/invite/accept').send({ token, password: 'clave1234' }).expect(200);
    const again = await request(app.getHttpServer()).post('/api/auth/invite/accept').send({ token, password: 'otra12345' }).expect(400);
    expect(again.body.message).toBe('Invitación inválida o vencida');
    await request(app.getHttpServer()).get(`/api/auth/invite/${token}`).expect(404);
  });

  it('una invitación vencida no sirve', async () => {
    const res = await admin.post('/api/admin/clinics').send({ name: 'Clinica C', ownerName: 'Ana', ownerEmail: 'ana@a.com' }).expect(201);
    await app.get(DataSource).query(`UPDATE users SET invite_expires_at = now() - interval '1 minute' WHERE email = 'ana@a.com'`);
    await request(app.getHttpServer())
      .post('/api/auth/invite/accept')
      .send({ token: tokenFrom(res.body.inviteUrl), password: 'clave1234' })
      .expect(400);
  });

  it('reinvitar al dueño invalida el enlace anterior', async () => {
    const res = await admin.post('/api/admin/clinics').send({ name: 'Clinica C', ownerName: 'Ana', ownerEmail: 'ana@a.com' }).expect(201);
    const old = tokenFrom(res.body.inviteUrl);
    const re = await admin.post(`/api/admin/clinics/${res.body.clinic.id}/reinvite-owner`).expect(201);
    await request(app.getHttpServer()).get(`/api/auth/invite/${old}`).expect(404);
    await request(app.getHttpServer()).get(`/api/auth/invite/${tokenFrom(re.body.inviteUrl)}`).expect(200);
  });

  it('no se puede reinvitar a un dueño que ya activó su cuenta', async () => {
    const res = await admin.post('/api/admin/clinics').send({ name: 'Clinica C', ownerName: 'Ana', ownerEmail: 'ana@a.com' }).expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/invite/accept')
      .send({ token: tokenFrom(res.body.inviteUrl), password: 'clave1234' })
      .expect(200);
    await admin.post(`/api/admin/clinics/${res.body.clinic.id}/reinvite-owner`).expect(400);
  });

  it('email de dueño duplicado da 409 y no crea la clínica', async () => {
    await seedUser(app, { email: 'ana@a.com', role: Role.SUPERADMIN });
    await admin.post('/api/admin/clinics').send({ name: 'Clinica C', ownerName: 'Ana', ownerEmail: 'ana@a.com' }).expect(409);
    const list = await admin.get('/api/admin/clinics').expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('lista clínicas y actualiza "pagado hasta"', async () => {
    const res = await admin.post('/api/admin/clinics').send({ name: 'Clinica C', ownerName: 'Ana', ownerEmail: 'ana@a.com' }).expect(201);
    const upd = await admin.patch(`/api/admin/clinics/${res.body.clinic.id}`).send({ paidUntil: '2026-12-31' }).expect(200);
    expect(upd.body.paidUntil).toBe('2026-12-31');
    await admin.patch(`/api/admin/clinics/${res.body.clinic.id}`).send({ paidUntil: 'mañana' }).expect(400);
    const list = await admin.get('/api/admin/clinics').expect(200);
    expect(list.body[0]).toEqual(expect.objectContaining({ name: 'Clinica C', paidUntil: '2026-12-31', subscriptionStatus: 'ACTIVE' }));
  });

  it('un OWNER no puede usar las rutas de admin', async () => {
    const clinic = await seedClinic(app);
    await seedUser(app, { email: 'o@a.com', password: 'secreta123', role: Role.OWNER, clinicId: clinic.id });
    const owner = request.agent(app.getHttpServer());
    await owner.post('/api/auth/login').send({ email: 'o@a.com', password: 'secreta123' }).expect(200);
    await owner.get('/api/admin/clinics').expect(403);
  });

  it('PATCH de clínica inexistente da 404', () =>
    admin.patch('/api/admin/clinics/00000000-0000-0000-0000-000000000000').send({ paidUntil: '2026-12-31' }).expect(404));
});
