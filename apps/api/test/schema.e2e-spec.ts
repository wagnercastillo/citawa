import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedUser } from './utils';

describe('schema', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(async () => { await resetDb(app); });
  afterAll(async () => { await app.close(); });

  it('crea clínica con valores por defecto', async () => {
    const clinic = await seedClinic(app, 'Sonrisas');
    expect(clinic.timezone).toBe('America/Lima');
    expect(clinic.subscriptionStatus).toBe('ACTIVE');
    expect(clinic.send2hToConfirmed).toBe(false);
  });

  it('rechaza SUPERADMIN con clinic_id y OWNER sin clinic_id', async () => {
    const clinic = await seedClinic(app);
    await expect(seedUser(app, { email: 'x@a.com', role: Role.SUPERADMIN, clinicId: clinic.id })).rejects.toThrow();
    await expect(seedUser(app, { email: 'y@a.com', role: Role.OWNER, clinicId: null })).rejects.toThrow();
  });

  it('email único', async () => {
    await seedUser(app, { email: 'a@a.com', role: Role.SUPERADMIN });
    await expect(seedUser(app, { email: 'a@a.com', role: Role.SUPERADMIN })).rejects.toThrow();
  });

  it('borrar clínica borra sus usuarios', async () => {
    const clinic = await seedClinic(app);
    await seedUser(app, { email: 'o@a.com', role: Role.OWNER, clinicId: clinic.id });
    const ds = app.get(DataSource);
    await ds.query('DELETE FROM clinics WHERE id = $1', [clinic.id]);
    const [{ count }] = await ds.query('SELECT count(*)::int AS count FROM users');
    expect(count).toBe(0);
  });
});
