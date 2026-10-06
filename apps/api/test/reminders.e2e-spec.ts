import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { FakeClock } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedPatient, seedService, seedUser } from './utils';

describe('programación de recordatorios', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let ds: DataSource;
  let recep: ReturnType<typeof request.agent>;
  let patientId: string;
  let serviceId: string;

  const rows = async (apptId: string) =>
    ds.query(
      `SELECT kind, status, send_at, cancel_reason FROM scheduled_messages WHERE appointment_id = $1 ORDER BY kind`,
      [apptId],
    );
  const book = (date: string, time: string) =>
    recep.post('/api/appointments').send({ patientId, serviceId, date, time }).expect(201);

  beforeAll(async () => {
    ({ app, clock } = await createAppWithFakes('2026-10-01T12:00:00Z'));
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    clock.set('2026-10-01T12:00:00Z');
    await resetDb(app);
    const clinic = await seedClinic(app);
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId: clinic.id });
    patientId = (await seedPatient(app, clinic.id)).id;
    serviceId = (await seedService(app, clinic.id)).id;
    recep = request.agent(app.getHttpServer());
    await recep.post('/api/auth/login').send({ email: 'recep@a.com', password: 'secreta123' }).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('crear una cita programa 24 h y 2 h antes', async () => {
    const appt = await book('2026-10-06', '09:30');
    expect(await rows(appt.body.id)).toEqual([
      { kind: 'REMINDER_24H', status: 'PENDING', send_at: new Date('2026-10-05T14:30:00Z'), cancel_reason: null },
      { kind: 'REMINDER_2H', status: 'PENDING', send_at: new Date('2026-10-06T12:30:00Z'), cancel_reason: null },
    ]);
  });

  it('si faltan menos de 24 h solo programa el de 2 h', async () => {
    const appt = await book('2026-10-01', '14:00');
    expect((await rows(appt.body.id)).map((r: { kind: string }) => r.kind)).toEqual(['REMINDER_2H']);
  });

  it('mover la cita reprograma, aunque el recordatorio ya se haya enviado; confirmar no reenvía', async () => {
    const appt = await book('2026-10-06', '09:30');
    await ds.query(`UPDATE scheduled_messages SET status = 'SENT' WHERE appointment_id = $1 AND kind = 'REMINDER_24H'`, [appt.body.id]);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CONFIRMED' }).expect(200);
    expect((await rows(appt.body.id))[0].status).toBe('SENT');
    await recep.patch(`/api/appointments/${appt.body.id}`).send({ date: '2026-10-08', time: '11:00', serviceId }).expect(200);
    expect(await rows(appt.body.id)).toEqual([
      { kind: 'REMINDER_24H', status: 'PENDING', send_at: new Date('2026-10-07T16:00:00Z'), cancel_reason: null },
      { kind: 'REMINDER_2H', status: 'PENDING', send_at: new Date('2026-10-08T14:00:00Z'), cancel_reason: null },
    ]);
  });

  it('cancelar la cita cancela los recordatorios pendientes', async () => {
    const appt = await book('2026-10-06', '09:30');
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CANCELLED' }).expect(200);
    expect((await rows(appt.body.id)).map((r: { status: string; cancel_reason: string }) => [r.status, r.cancel_reason])).toEqual([
      ['CANCELLED', 'Cita CANCELLED'],
      ['CANCELLED', 'Cita CANCELLED'],
    ]);
  });

  it('los bloqueos no programan recordatorios', async () => {
    const block = await recep.post('/api/appointments/blocks').send({ date: '2026-10-06', time: '13:00', endTime: '14:00' }).expect(201);
    expect(await rows(block.body.id)).toEqual([]);
  });
});
