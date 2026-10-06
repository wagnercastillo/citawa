import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ReminderDispatcher } from '../src/scheduler/reminder-dispatcher';
import { Role } from '../src/users/role.enum';
import { FakeClock, FakeD360 } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedPatient, seedService, seedUser, seedWhatsapp } from './utils';

describe('despachador y plantillas aprobadas', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let d360: FakeD360;
  let ds: DataSource;
  let clinicId: string;
  let apptId: string;

  const sm = async () => (await ds.query(`SELECT status, last_error, cancel_reason, send_at FROM scheduled_messages WHERE appointment_id = $1 AND kind = 'REMINDER_24H'`, [apptId]))[0];

  beforeAll(async () => {
    ({ app, clock, d360 } = await createAppWithFakes());
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    clock.set('2026-10-01T12:00:00Z');
    d360.reset();
    await resetDb(app);
    clinicId = (await seedClinic(app)).id;
    await seedUser(app, { email: 'recep@a.com', password: 'secreta123', role: Role.RECEPTION, clinicId });
    const patientId = (await seedPatient(app, clinicId)).id;
    const serviceId = (await seedService(app, clinicId)).id;
    const recep = request.agent(app.getHttpServer());
    await recep.post('/api/auth/login').send({ email: 'recep@a.com', password: 'secreta123' }).expect(200);
    apptId = (await recep.post('/api/appointments').send({ patientId, serviceId, date: '2026-10-02', time: '09:30' }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('con la plantilla pendiente pospone; al aprobarse envía', async () => {
    await seedWhatsapp(app, clinicId, { templates: false });
    await ds.query(`INSERT INTO whatsapp_templates (clinic_id, name) VALUES ($1, 'recordatorio_cita_24h')`, [clinicId]);
    clock.set('2026-10-01T14:31:00Z');
    await app.get(ReminderDispatcher).runOnce();
    expect(await sm()).toEqual(expect.objectContaining({
      status: 'PENDING', last_error: 'Plantilla no aprobada todavía', send_at: new Date('2026-10-01T14:46:00Z'),
    }));
    expect(d360.sent).toHaveLength(0);

    await ds.query(`UPDATE whatsapp_templates SET status = 'APPROVED' WHERE clinic_id = $1`, [clinicId]);
    clock.set('2026-10-01T14:46:00Z');
    await app.get(ReminderDispatcher).runOnce();
    expect((await sm()).status).toBe('SENT');
  });

  it('plantilla rechazada y cita ya cercana → cancela con el motivo', async () => {
    await seedWhatsapp(app, clinicId, { templates: false });
    await ds.query(`INSERT INTO whatsapp_templates (clinic_id, name, status) VALUES ($1, 'recordatorio_cita_24h', 'REJECTED')`, [clinicId]);
    clock.set('2026-10-02T14:20:00Z'); // faltan 10 min para la cita
    await app.get(ReminderDispatcher).runOnce();
    expect(await sm()).toEqual(expect.objectContaining({ status: 'CANCELLED', cancel_reason: 'Plantilla no aprobada todavía' }));
  });

  it('en sandbox no se exigen plantillas', async () => {
    await seedWhatsapp(app, clinicId, { sandbox: true });
    clock.set('2026-10-01T14:31:00Z');
    await app.get(ReminderDispatcher).runOnce();
    expect((await sm()).status).toBe('SENT');
  });
});
