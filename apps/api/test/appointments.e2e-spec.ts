import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedPatient, seedService, seedUser } from './utils';

describe('appointments', () => {
  let app: INestApplication;
  let ds: DataSource;
  let recep: ReturnType<typeof request.agent>;
  let patientA: string;
  let serviceA: string;
  let patientB: string;
  let serviceB: string;

  const loginAs = async (email: string): Promise<ReturnType<typeof request.agent>> => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: 'secreta123' }).expect(200);
    return agent;
  };
  const book = (time: string, date = '2026-10-06', extra: Record<string, unknown> = {}) =>
    recep.post('/api/appointments').send({ patientId: patientA, serviceId: serviceA, date, time, ...extra });

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDb(app);
    const a = await seedClinic(app, 'A');
    const b = await seedClinic(app, 'B');
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId: a.id });
    await seedUser(app, { email: 'owner@b.com', password: 'secreta123', role: Role.OWNER, clinicId: b.id });
    await seedUser(app, { email: 'root@x.com', password: 'secreta123', role: Role.SUPERADMIN });
    patientA = (await seedPatient(app, a.id, { fullName: 'Juan Pérez' })).id;
    serviceA = (await seedService(app, a.id, 'Limpieza', 30)).id;
    patientB = (await seedPatient(app, b.id)).id;
    serviceB = (await seedService(app, b.id)).id;
    recep = await loginAs('recep@a.com');
  });
  afterAll(async () => { await app.close(); });

  it('crea una cita en hora de Lima, calcula el fin y registra el evento', async () => {
    const res = await book('09:30').expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      startsAt: '2026-10-06T14:30:00.000Z',
      endsAt: '2026-10-06T15:00:00.000Z',
      status: 'SCHEDULED',
      isBlock: false,
      patient: { id: patientA, fullName: 'Juan Pérez', phone: '+51987654321' },
      service: { id: serviceA, name: 'Limpieza', durationMin: 30 },
    });
    const [row] = await ds.query('SELECT calendar_dirty, created_by FROM appointments WHERE id = $1', [res.body.id]);
    expect(row.calendar_dirty).toBe(true);
    expect(row.created_by).toEqual(expect.any(String));
    const events = await ds.query('SELECT type, source, actor_user_id FROM appointment_events WHERE appointment_id = $1', [res.body.id]);
    expect(events).toEqual([{ type: 'CREATED', source: 'PANEL', actor_user_id: row.created_by }]);
  });

  it('impide citas que se cruzan (409) y permite las pegadas', async () => {
    await book('09:30').expect(201);
    const clash = await book('09:45').expect(409);
    expect(clash.body.message).toBe('Horario ocupado: ya hay otra cita en ese horario');
    await book('10:00').expect(201);
  });

  it('un bloqueo ocupa el horario y valida que el fin sea posterior', async () => {
    const block = await recep.post('/api/appointments/blocks').send({ date: '2026-10-06', time: '13:00', endTime: '14:00' }).expect(201);
    expect(block.body).toEqual(expect.objectContaining({ isBlock: true, patient: null, service: null }));
    await book('13:30').expect(409);
    await recep.post('/api/appointments/blocks').send({ date: '2026-10-06', time: '15:00', endTime: '15:00' }).expect(400);
  });

  it('lista por rango de fechas en hora local: una cita a las 23:30 cae en su día', async () => {
    await book('23:30', '2026-10-06').expect(201);
    await book('08:00', '2026-10-07').expect(201);
    const day6 = await recep.get('/api/appointments').query({ from: '2026-10-06', to: '2026-10-06' }).expect(200);
    expect(day6.body.map((a: { startsAt: string }) => a.startsAt)).toEqual(['2026-10-07T04:30:00.000Z']);
    const day7 = await recep.get('/api/appointments').query({ from: '2026-10-07', to: '2026-10-07' }).expect(200);
    expect(day7.body.map((a: { startsAt: string }) => a.startsAt)).toEqual(['2026-10-07T13:00:00.000Z']);
    const week = await recep.get('/api/appointments').query({ from: '2026-10-05', to: '2026-10-11' }).expect(200);
    expect(week.body).toHaveLength(2);
  });

  it('valida el rango de fechas', async () => {
    await recep.get('/api/appointments').query({ from: '2026-10-07', to: '2026-10-06' }).expect(400);
    await recep.get('/api/appointments').query({ from: '2026-10-01', to: '2026-11-15' }).expect(400);
    await recep.get('/api/appointments').query({ from: '2026-02-30', to: '2026-03-01' }).expect(400);
    await recep.get('/api/appointments').expect(400);
  });

  it('reprogramar mueve la cita, vuelve a SCHEDULED y registra RESCHEDULED', async () => {
    const appt = await book('09:30').expect(201);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CONFIRMED' }).expect(200);
    const moved = await recep.patch(`/api/appointments/${appt.body.id}`).send({ date: '2026-10-08', time: '11:00', serviceId: serviceA }).expect(200);
    expect(moved.body).toEqual(expect.objectContaining({ startsAt: '2026-10-08T16:00:00.000Z', status: 'SCHEDULED' }));
    const types = await ds.query('SELECT type FROM appointment_events WHERE appointment_id = $1 ORDER BY created_at', [appt.body.id]);
    expect(types.map((t: { type: string }) => t.type)).toEqual(['CREATED', 'CONFIRMED', 'RESCHEDULED']);
  });

  it('mover una cita encima de otra da 409 y la deja intacta', async () => {
    await book('09:30').expect(201);
    const other = await book('11:00').expect(201);
    await recep.post(`/api/appointments/${other.body.id}/status`).send({ status: 'CONFIRMED' }).expect(200);
    await recep.patch(`/api/appointments/${other.body.id}`).send({ date: '2026-10-06', time: '09:30', serviceId: serviceA }).expect(409);
    const day = await recep.get('/api/appointments').query({ from: '2026-10-06', to: '2026-10-06' }).expect(200);
    const kept = day.body.find((a: { id: string }) => a.id === other.body.id);
    expect(kept).toEqual(expect.objectContaining({ startsAt: '2026-10-06T16:00:00.000Z', status: 'CONFIRMED' }));
  });

  it('cancelar libera el horario; una cancelada no cambia de estado', async () => {
    const appt = await book('09:30').expect(201);
    const cancelled = await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CANCELLED' }).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    await book('09:30').expect(201);
    const bad = await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CONFIRMED' }).expect(400);
    expect(bad.body.message).toBe('No se puede pasar de CANCELLED a CONFIRMED');
    await recep.patch(`/api/appointments/${appt.body.id}`).send({ date: '2026-10-09', time: '09:30', serviceId: serviceA }).expect(400);
  });

  it('asistió y no asistió se pueden corregir; un bloqueo no se confirma', async () => {
    const appt = await book('09:30').expect(201);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'NO_SHOW' }).expect(200);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'ATTENDED' }).expect(200);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'SCHEDULED' }).expect(400);
    const block = await recep.post('/api/appointments/blocks').send({ date: '2026-10-06', time: '13:00', endTime: '14:00' }).expect(201);
    await recep.post(`/api/appointments/${block.body.id}/status`).send({ status: 'CONFIRMED' }).expect(400);
    await recep.post(`/api/appointments/${block.body.id}/status`).send({ status: 'CANCELLED' }).expect(200);
  });

  it('servicio inactivo da 400; paciente o servicio de otro consultorio da 404', async () => {
    await ds.query('UPDATE services SET active = false WHERE id = $1', [serviceA]);
    await book('09:30').expect(400);
    await ds.query('UPDATE services SET active = true WHERE id = $1', [serviceA]);
    await book('09:30', '2026-10-06', { patientId: patientB }).expect(404);
    await book('09:30', '2026-10-06', { serviceId: serviceB }).expect(404);
  });

  it('otro consultorio no ve ni modifica las citas; superadmin no entra', async () => {
    const appt = await book('09:30').expect(201);
    const ownerB = await loginAs('owner@b.com');
    expect((await ownerB.get('/api/appointments').query({ from: '2026-10-06', to: '2026-10-06' }).expect(200)).body).toEqual([]);
    await ownerB.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CANCELLED' }).expect(404);
    await ownerB.patch(`/api/appointments/${appt.body.id}`).send({ date: '2026-10-06', time: '10:00', serviceId: serviceB }).expect(404);
    await ownerB.get(`/api/patients/${patientA}/appointments`).expect(404);
    const root = await loginAs('root@x.com');
    await root.get('/api/appointments').query({ from: '2026-10-06', to: '2026-10-06' }).expect(403);
  });

  it('historial del paciente: más recientes primero', async () => {
    await book('09:30', '2026-10-06').expect(201);
    await book('09:30', '2026-10-08').expect(201);
    const res = await recep.get(`/api/patients/${patientA}/appointments`).expect(200);
    expect(res.body.map((a: { startsAt: string }) => a.startsAt)).toEqual(['2026-10-08T14:30:00.000Z', '2026-10-06T14:30:00.000Z']);
  });
});
