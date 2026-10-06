import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ReminderDispatcher } from '../src/scheduler/reminder-dispatcher';
import { Role } from '../src/users/role.enum';
import { D360Error } from '../src/whatsapp/d360-client';
import { FakeClock, FakeD360 } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedPatient, seedService, seedUser, seedWhatsapp } from './utils';

describe('despachador de recordatorios', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let d360: FakeD360;
  let ds: DataSource;
  let dispatcher: ReminderDispatcher;
  let clinicId: string;
  let patientId: string;
  let apptId: string;

  const statusOf = async (kind: string) =>
    (await ds.query(`SELECT status, attempts, send_at, last_error, cancel_reason FROM scheduled_messages WHERE appointment_id = $1 AND kind = $2`, [apptId, kind]))[0];

  beforeAll(async () => {
    ({ app, clock, d360 } = await createAppWithFakes());
    ds = app.get(DataSource);
    dispatcher = app.get(ReminderDispatcher);
  });
  beforeEach(async () => {
    clock.set('2026-10-01T12:00:00Z');
    d360.reset();
    await resetDb(app);
    const clinic = await seedClinic(app, 'Sonrisas');
    clinicId = clinic.id;
    await ds.query(`UPDATE clinics SET address = 'Av. Larco 123' WHERE id = $1`, [clinicId]);
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId });
    patientId = (await seedPatient(app, clinicId, { fullName: 'Juan Pérez', phone: '+51987654321' })).id;
    const serviceId = (await seedService(app, clinicId)).id;
    await seedWhatsapp(app, clinicId, { apiKey: 'key-123' });
    const recep = request.agent(app.getHttpServer());
    await recep.post('/api/auth/login').send({ email: 'recep@a.com', password: 'secreta123' }).expect(200);
    // viernes 2 de octubre 09:30 Lima = 14:30Z → 24h: 2026-10-01T14:30Z, 2h: 2026-10-02T12:30Z
    apptId = (await recep.post('/api/appointments').send({ patientId, serviceId, date: '2026-10-02', time: '09:30' }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('no envía antes de tiempo; a su hora envía la plantilla y registra el mensaje', async () => {
    expect(await dispatcher.runOnce()).toBe(0);
    clock.set('2026-10-01T14:31:00Z');
    expect(await dispatcher.runOnce()).toBe(1);
    expect(d360.sent).toHaveLength(1);
    const { creds, payload } = d360.sent[0];
    expect(creds).toEqual({ apiKey: 'key-123', sandbox: false });
    expect(payload.to).toBe('51987654321');
    expect(payload.template.name).toBe('recordatorio_cita_24h');
    expect(payload.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      'Juan', 'Sonrisas', 'viernes 2 de octubre', '09:30',
    ]);
    expect((await statusOf('REMINDER_24H')).status).toBe('SENT');
    const [msg] = await ds.query(`SELECT direction, status, type, wa_message_id, patient_id FROM messages`);
    expect(msg).toEqual(expect.objectContaining({ direction: 'OUT', status: 'SENT', type: 'template', patient_id: patientId }));
    expect(msg.wa_message_id).toMatch(/^wamid\.fake\./);
  });

  it('el de 2 h usa la dirección; se omite si ya confirmó (salvo que el consultorio lo pida)', async () => {
    await ds.query(`UPDATE appointments SET status = 'CONFIRMED' WHERE id = $1`, [apptId]);
    clock.set('2026-10-02T12:31:00Z');
    await dispatcher.runOnce();
    expect((await statusOf('REMINDER_2H')).cancel_reason).toBe('Ya confirmó');
    expect(d360.sent.filter((s) => s.payload.template.name === 'recordatorio_cita_2h')).toHaveLength(0);

    await ds.query(`UPDATE scheduled_messages SET status = 'PENDING', cancel_reason = NULL WHERE appointment_id = $1 AND kind = 'REMINDER_2H'`, [apptId]);
    await ds.query(`UPDATE clinics SET send_2h_to_confirmed = true WHERE id = $1`, [clinicId]);
    await dispatcher.runOnce();
    const sent2h = d360.sent.find((s) => s.payload.template.name === 'recordatorio_cita_2h');
    expect(sent2h!.payload.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(['Juan', '09:30', 'Av. Larco 123']);
  });

  it('cancela con motivo (sin consentimiento, suscripción suspendida); WhatsApp desconectado pospone', async () => {
    clock.set('2026-10-01T14:31:00Z');
    await ds.query(`UPDATE patients SET whatsapp_opt_in = false WHERE id = $1`, [patientId]);
    await dispatcher.runOnce();
    expect(await statusOf('REMINDER_24H')).toEqual(expect.objectContaining({ status: 'CANCELLED', cancel_reason: 'Paciente sin consentimiento' }));

    await ds.query(`UPDATE patients SET whatsapp_opt_in = true WHERE id = $1`, [patientId]);
    await ds.query(`UPDATE clinics SET subscription_status = 'SUSPENDED' WHERE id = $1`, [clinicId]);
    await ds.query(`UPDATE scheduled_messages SET status = 'PENDING' WHERE appointment_id = $1 AND kind = 'REMINDER_24H'`, [apptId]);
    await dispatcher.runOnce();
    expect((await statusOf('REMINDER_24H')).cancel_reason).toBe('Suscripción suspendida');

    await ds.query(`UPDATE clinics SET subscription_status = 'ACTIVE' WHERE id = $1`, [clinicId]);
    await ds.query(`UPDATE whatsapp_accounts SET status = 'ERROR' WHERE clinic_id = $1`, [clinicId]);
    await ds.query(`UPDATE scheduled_messages SET status = 'PENDING' WHERE appointment_id = $1 AND kind = 'REMINDER_24H'`, [apptId]);
    await dispatcher.runOnce();
    expect(await statusOf('REMINDER_24H')).toEqual(expect.objectContaining({ status: 'PENDING', last_error: 'WhatsApp no conectado' }));
    expect(d360.sent).toHaveLength(0);
  });

  it('reintenta a los 5 y 15 min y falla al tercer error', async () => {
    clock.set('2026-10-01T14:31:00Z');
    d360.sendErrors.push(new D360Error(503, 'caído'), new D360Error(503, 'caído'), new D360Error(503, 'caído'));
    await dispatcher.runOnce();
    expect(await statusOf('REMINDER_24H')).toEqual(expect.objectContaining({
      status: 'PENDING', attempts: 1, last_error: 'caído', send_at: new Date('2026-10-01T14:36:00Z'),
    }));
    clock.set('2026-10-01T14:36:00Z');
    await dispatcher.runOnce();
    expect(await statusOf('REMINDER_24H')).toEqual(expect.objectContaining({ attempts: 2, send_at: new Date('2026-10-01T14:51:00Z') }));
    clock.set('2026-10-01T14:51:00Z');
    await dispatcher.runOnce();
    expect(await statusOf('REMINDER_24H')).toEqual(expect.objectContaining({ status: 'FAILED', attempts: 3 }));
  });

  it('un 401 falla de inmediato y marca la cuenta en ERROR', async () => {
    clock.set('2026-10-01T14:31:00Z');
    d360.sendErrors.push(new D360Error(401, 'Invalid API key'));
    await dispatcher.runOnce();
    expect((await statusOf('REMINDER_24H')).status).toBe('FAILED');
    const [acc] = await ds.query(`SELECT status, last_error FROM whatsapp_accounts WHERE clinic_id = $1`, [clinicId]);
    expect(acc).toEqual({ status: 'ERROR', last_error: 'Invalid API key' });
  });

  it('dos despachadores a la vez envían una sola vez', async () => {
    clock.set('2026-10-01T14:31:00Z');
    const [a, b] = await Promise.all([dispatcher.runOnce(), dispatcher.runOnce()]);
    expect(a + b).toBe(1);
    expect(d360.sent).toHaveLength(1);
  });

  it('recupera envíos que quedaron en SENDING hace más de 10 min', async () => {
    await ds.query(`UPDATE scheduled_messages SET status = 'SENDING', updated_at = '2026-10-01T11:00:00Z' WHERE appointment_id = $1 AND kind = 'REMINDER_24H'`, [apptId]);
    expect(await dispatcher.recoverStale()).toBe(1);
    expect((await statusOf('REMINDER_24H')).status).toBe('PENDING');
  });
});
