import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedUser } from './utils';

describe('onboarding schema', () => {
  let app: INestApplication;
  let ds: DataSource;
  let clinicId: string;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDb(app);
    clinicId = (await seedClinic(app)).id;
    userId = (await seedUser(app, { email: 'o@a.com', role: Role.OWNER, clinicId })).id;
  });
  afterAll(async () => { await app.close(); });

  it('una plantilla por nombre y consultorio', async () => {
    const insert = () => ds.query(`INSERT INTO whatsapp_templates (clinic_id, name) VALUES ($1, 'recordatorio_cita_24h')`, [clinicId]);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505' });
    const [row] = await ds.query(`SELECT status, language FROM whatsapp_templates`);
    expect(row).toEqual({ status: 'PENDING', language: 'es' });
  });

  it('el hash del state es único y se borra con el consultorio', async () => {
    const insert = () =>
      ds.query(`INSERT INTO whatsapp_onboarding_states (clinic_id, user_id, state_hash, expires_at) VALUES ($1, $2, $3, now())`, [clinicId, userId, 'a'.repeat(64)]);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505' });
    await ds.query('DELETE FROM clinics WHERE id = $1', [clinicId]);
    const [{ count }] = await ds.query('SELECT count(*)::int AS count FROM whatsapp_onboarding_states');
    expect(count).toBe(0);
  });
});
