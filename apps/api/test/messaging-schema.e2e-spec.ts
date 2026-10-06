import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb, seedClinic, seedPatient, seedService } from './utils';

describe('messaging schema', () => {
  let app: INestApplication;
  let ds: DataSource;
  let clinicId: string;
  let apptId: string;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDb(app);
    clinicId = (await seedClinic(app)).id;
    const patient = await seedPatient(app, clinicId);
    const service = await seedService(app, clinicId);
    [{ id: apptId }] = await ds.query(
      `INSERT INTO appointments (clinic_id, patient_id, service_id, starts_at, ends_at)
       VALUES ($1, $2, $3, '2026-10-06T14:30:00Z', '2026-10-06T15:00:00Z') RETURNING id`,
      [clinicId, patient.id, service.id],
    );
  });
  afterAll(async () => { await app.close(); });

  const schedule = (kind: string) =>
    ds.query(
      `INSERT INTO scheduled_messages (clinic_id, kind, appointment_id, send_at) VALUES ($1, $2, $3, now())`,
      [clinicId, kind, apptId],
    );

  it('una sola fila por cita y tipo de recordatorio', async () => {
    await schedule('REMINDER_24H');
    await schedule('REMINDER_2H');
    await expect(schedule('REMINDER_24H')).rejects.toMatchObject({ code: '23505' });
  });

  it('borrar la cita borra sus recordatorios', async () => {
    await schedule('REMINDER_24H');
    await ds.query('DELETE FROM appointments WHERE id = $1', [apptId]);
    const [{ count }] = await ds.query('SELECT count(*)::int AS count FROM scheduled_messages');
    expect(count).toBe(0);
  });

  it('wa_message_id es único (permite varios NULL)', async () => {
    const insert = (wa: string | null) =>
      ds.query(`INSERT INTO messages (clinic_id, direction, wa_message_id, type) VALUES ($1, 'OUT', $2, 'text')`, [clinicId, wa]);
    await insert('wamid.1');
    await insert(null);
    await insert(null);
    await expect(insert('wamid.1')).rejects.toMatchObject({ code: '23505' });
  });

  it('una cuenta de WhatsApp por consultorio', async () => {
    const insert = (token: string) =>
      ds.query(
        `INSERT INTO whatsapp_accounts (clinic_id, phone_number, api_key_enc, webhook_token) VALUES ($1, '+51987654321', 'x', $2)`,
        [clinicId, token],
      );
    await insert('tok-1');
    await expect(insert('tok-2')).rejects.toMatchObject({ code: '23505' });
  });
});
