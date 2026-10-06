import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Appointment } from '../src/appointments/appointment.entity';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { Role } from '../src/users/role.enum';
import { createTestApp, resetDb, seedClinic, seedPatient, seedService, seedUser } from './utils';

describe('appointments: escrituras concurrentes y bloqueos cancelados', () => {
  let app: INestApplication;
  let ds: DataSource;
  let recep: ReturnType<typeof request.agent>;
  let patientId: string;
  let serviceId: string;

  /** Simula que otro usuario cambió la cita entre la lectura y la escritura: la próxima lectura devuelve el estado viejo. */
  const staleReadOnce = (staleStatus: string) =>
    jest.spyOn(AppointmentsService.prototype as never, 'findInClinic' as never).mockImplementationOnce((async (
      clinicId: string,
      id: string,
    ) => {
      const row = await ds.getRepository(Appointment).findOneByOrFail({ id, clinicId });
      return { ...row, status: staleStatus };
    }) as never);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDb(app);
    const a = await seedClinic(app, 'A');
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId: a.id });
    patientId = (await seedPatient(app, a.id)).id;
    serviceId = (await seedService(app, a.id)).id;
    recep = request.agent(app.getHttpServer());
    await recep.post('/api/auth/login').send({ email: 'recep@a.com', password: 'secreta123' }).expect(200);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app.close(); });

  const bookAndCancel = async (): Promise<string> => {
    const appt = await recep.post('/api/appointments').send({ patientId, serviceId, date: '2026-10-06', time: '09:30' }).expect(201);
    await recep.post(`/api/appointments/${appt.body.id}/status`).send({ status: 'CANCELLED' }).expect(200);
    return appt.body.id;
  };
  const statusOf = async (id: string): Promise<string> =>
    (await ds.query('SELECT status FROM appointments WHERE id = $1', [id]))[0].status;

  it('editar con estado desactualizado no "descancela" la cita (409)', async () => {
    const id = await bookAndCancel();
    staleReadOnce('SCHEDULED');
    await recep.patch(`/api/appointments/${id}`).send({ date: '2026-10-07', time: '10:00', serviceId }).expect(409);
    expect(await statusOf(id)).toBe('CANCELLED');
  });

  it('cambiar estado con lectura desactualizada no salta la máquina de estados (409)', async () => {
    const id = await bookAndCancel();
    staleReadOnce('SCHEDULED');
    await recep.post(`/api/appointments/${id}/status`).send({ status: 'ATTENDED' }).expect(409);
    expect(await statusOf(id)).toBe('CANCELLED');
    const events = await ds.query('SELECT type FROM appointment_events WHERE appointment_id = $1', [id]);
    expect(events.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'CANCELLED']);
  });

  it('un bloqueo quitado ya no aparece en la agenda', async () => {
    const block = await recep.post('/api/appointments/blocks').send({ date: '2026-10-06', time: '13:00', endTime: '14:00' }).expect(201);
    await recep.post(`/api/appointments/${block.body.id}/status`).send({ status: 'CANCELLED' }).expect(200);
    const day = await recep.get('/api/appointments').query({ from: '2026-10-06', to: '2026-10-06' }).expect(200);
    expect(day.body).toEqual([]);
  });
});
