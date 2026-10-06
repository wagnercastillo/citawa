import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { ConversationService } from '../src/conversation/conversation.service';
import { ReminderDispatcher } from '../src/scheduler/reminder-dispatcher';
import { Role } from '../src/users/role.enum';
import { MessagesService } from '../src/whatsapp/messages.service';
import { FakeClock, FakeD360 } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedHours, seedPatient, seedService, seedUser, seedWhatsapp } from './utils';

describe('correcciones de la revisión final (etapa 3)', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let d360: FakeD360;
  let ds: DataSource;
  let clinicId: string;
  let patientId: string;
  let serviceId: string;
  const TOKEN = 'tok-fixes';
  const FROM = '51987654321';
  let seq = 0;

  const hook = (payload: string, id = `wamid.fx.${++seq}`) =>
    request(app.getHttpServer())
      .post(`/api/webhooks/wa/${TOKEN}`)
      .send({ entry: [{ changes: [{ value: { messages: [{ from: FROM, id, type: 'button', button: { payload } }] } }] }] });
  const insertAppt = async (starts: string, ends: string, patient = patientId) =>
    (await ds.query(
      `INSERT INTO appointments (clinic_id, patient_id, service_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [clinicId, patient, serviceId, starts, ends],
    ))[0].id as string;
  const sm = async (apptId: string, kind = 'REMINDER_24H') =>
    (await ds.query(`SELECT status, attempts, send_at, last_error, cancel_reason FROM scheduled_messages WHERE appointment_id = $1 AND kind = $2`, [apptId, kind]))[0];

  beforeAll(async () => {
    ({ app, clock, d360 } = await createAppWithFakes());
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    clock.set('2026-10-05T12:00:00Z');
    d360.reset();
    await resetDb(app);
    clinicId = (await seedClinic(app, 'Sonrisas')).id;
    await seedWhatsapp(app, clinicId, { token: TOKEN });
    await seedHours(app, clinicId, [{ weekday: 2, opensAt: '09:00', closesAt: '11:00' }]);
    serviceId = (await seedService(app, clinicId, 'Limpieza', 30)).id;
    patientId = (await seedPatient(app, clinicId, { phone: `+${FROM}` })).id;
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId });
  });
  afterAll(async () => { await app.close(); });

  it('I1: PICK a un horario que otro tomó en paralelo reenvía la lista (no 500)', async () => {
    const appt = await insertAppt('2026-10-06T14:30:00Z', '2026-10-06T15:00:00Z');
    const other = (await seedPatient(app, clinicId, { phone: '+51911111111' })).id;
    await insertAppt('2026-10-06T15:00:00Z', '2026-10-06T15:30:00Z', other);
    // Simula que al calcular los horarios el de las 10:00 aún estaba libre.
    jest.spyOn(ConversationService.prototype as never, 'slotsFor' as never).mockResolvedValueOnce([new Date('2026-10-06T15:00:00Z')] as never);
    await hook(`PICK:${appt}:2026-10-06T15:00:00.000Z`).expect(200);
    expect(d360.sent).toHaveLength(1);
    expect(d360.sent[0].payload.interactive.body.text).toBe('Ese horario se acaba de ocupar. Elige otro:');
  });

  it('I2: si procesar falla, el mensaje no se pierde: el reintento de 360dialog lo vuelve a procesar', async () => {
    const appt = await insertAppt('2026-10-06T14:30:00Z', '2026-10-06T15:00:00Z');
    jest.spyOn(AppointmentsService.prototype, 'changeStatus').mockRejectedValueOnce(new Error('DB caída'));
    await hook(`CONFIRM:${appt}`, 'wamid.retry').expect(500);
    await hook(`CONFIRM:${appt}`, 'wamid.retry').expect(200);
    expect((await ds.query('SELECT status FROM appointments WHERE id = $1', [appt]))[0].status).toBe('CONFIRMED');
  });

  describe('despachador', () => {
    let dispatcher: ReminderDispatcher;
    let apptA: string;
    let apptB: string;

    beforeEach(async () => {
      dispatcher = app.get(ReminderDispatcher);
      clock.set('2026-10-01T12:00:00Z');
      const recep = request.agent(app.getHttpServer());
      await recep.post('/api/auth/login').send({ email: 'recep@a.com', password: 'secreta123' }).expect(200);
      apptA = (await recep.post('/api/appointments').send({ patientId, serviceId, date: '2026-10-02', time: '09:30' }).expect(201)).body.id;
      apptB = (await recep.post('/api/appointments').send({ patientId, serviceId, date: '2026-10-02', time: '10:30' }).expect(201)).body.id;
      clock.set('2026-10-01T15:31:00Z'); // vencen los 24h de A (14:30Z) y B (15:30Z)
    });

    it('I3: si falla el registro después de enviar, no se reenvía', async () => {
      jest.spyOn(MessagesService.prototype, 'recordOutbound').mockRejectedValueOnce(new Error('DB caída'));
      await dispatcher.runOnce();
      expect(d360.sent).toHaveLength(2);
      expect((await sm(apptA)).status).toBe('SENT');
      clock.set('2026-10-01T16:00:00Z');
      await dispatcher.runOnce();
      expect(d360.sent).toHaveLength(2);
    });

    it('I4: un error inesperado en un recordatorio no deja colgado al resto del lote', async () => {
      const loadContext = (ReminderDispatcher.prototype as unknown as { loadContext: (s: unknown) => unknown }).loadContext;
      jest.spyOn(ReminderDispatcher.prototype as never, 'loadContext' as never).mockImplementation((async function (this: unknown, s: { appointmentId: string }) {
        if (s.appointmentId === apptA) throw new Error('inesperado');
        return loadContext.call(this, s);
      }) as never);
      await dispatcher.runOnce();
      expect((await sm(apptB)).status).toBe('SENT');
      expect(await sm(apptA)).toEqual(expect.objectContaining({ status: 'PENDING', attempts: 1, last_error: 'inesperado' }));
    });

    it('I5: con WhatsApp desconectado el recordatorio espera (no se cancela) y sale al reconectar', async () => {
      await ds.query(`UPDATE whatsapp_accounts SET status = 'ERROR' WHERE clinic_id = $1`, [clinicId]);
      await dispatcher.runOnce();
      expect(await sm(apptA)).toEqual(expect.objectContaining({
        status: 'PENDING', last_error: 'WhatsApp no conectado', send_at: new Date('2026-10-01T15:46:00Z'),
      }));
      await ds.query(`UPDATE whatsapp_accounts SET status = 'CONNECTED' WHERE clinic_id = $1`, [clinicId]);
      clock.set('2026-10-01T15:46:00Z');
      await dispatcher.runOnce();
      expect((await sm(apptA)).status).toBe('SENT');
    });
  });
});
