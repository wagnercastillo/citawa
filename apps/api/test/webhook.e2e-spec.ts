import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { FakeClock, FakeD360 } from './fakes';
import { createAppWithFakes, resetDb, seedClinic, seedHours, seedPatient, seedService, seedWhatsapp } from './utils';

describe('webhook y conversación', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let d360: FakeD360;
  let ds: DataSource;
  let clinicId: string;
  let apptId: string;
  let foreignApptId: string;
  const TOKEN = 'tok-webhook-test';
  const FROM = '51987654321';

  let seq = 0;
  const post = (body: unknown, token = TOKEN) => request(app.getHttpServer()).post(`/api/webhooks/wa/${token}`).send(body as object);
  const tap = (payload: string, from = FROM, id = `wamid.in.${++seq}`) =>
    post({ entry: [{ changes: [{ value: { messages: [{ from, id, type: 'button', button: { text: 'x', payload } }] } }] }] });
  const pick = (payload: string) =>
    post({ entry: [{ changes: [{ value: { messages: [{ from: FROM, id: `wamid.in.${++seq}`, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: payload, title: 't' } } }] } }] }] });
  const apptRow = async (id: string) => (await ds.query('SELECT status, starts_at FROM appointments WHERE id = $1', [id]))[0];
  const events = async (id: string) => ds.query('SELECT type, source, actor_user_id FROM appointment_events WHERE appointment_id = $1 ORDER BY created_at', [id]);
  const insertAppt = async (clinic: string, patient: string, service: string, starts: string, ends: string) =>
    (await ds.query(
      `INSERT INTO appointments (clinic_id, patient_id, service_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [clinic, patient, service, starts, ends],
    ))[0].id;

  beforeAll(async () => {
    ({ app, clock, d360 } = await createAppWithFakes());
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    clock.set('2026-10-05T12:00:00Z'); // lunes 07:00 Lima → "mañana" = martes 6
    d360.reset();
    await resetDb(app);
    clinicId = (await seedClinic(app, 'Sonrisas')).id;
    await seedWhatsapp(app, clinicId, { token: TOKEN });
    await seedHours(app, clinicId, [{ weekday: 2, opensAt: '09:00', closesAt: '11:00' }]);
    const service = await seedService(app, clinicId, 'Limpieza', 30);
    const juan = await seedPatient(app, clinicId, { fullName: 'Juan Pérez', phone: `+${FROM}` });
    const ana = await seedPatient(app, clinicId, { fullName: 'Ana', phone: '+51911111111' });
    apptId = await insertAppt(clinicId, juan.id, service.id, '2026-10-06T14:30:00Z', '2026-10-06T15:00:00Z'); // 09:30
    await insertAppt(clinicId, ana.id, service.id, '2026-10-06T15:00:00Z', '2026-10-06T15:30:00Z'); // 10:00
    const other = await seedClinic(app, 'Otra');
    const otherPatient = await seedPatient(app, other.id, { phone: `+${FROM}` });
    const otherService = await seedService(app, other.id);
    foreignApptId = await insertAppt(other.id, otherPatient.id, otherService.id, '2026-10-06T14:30:00Z', '2026-10-06T15:00:00Z');
  });
  afterAll(async () => { await app.close(); });

  it('token desconocido → 404; válido → 200 { ok: true }', async () => {
    await post({}, 'no-existe').expect(404);
    await post({}).expect(200).expect({ ok: true });
  });

  it('CONFIRM confirma, registra evento WHATSAPP y responde; repetido se procesa una vez', async () => {
    const body = { entry: [{ changes: [{ value: { messages: [{ from: FROM, id: 'wamid.dup', type: 'button', button: { payload: `CONFIRM:${apptId}` } }] } }] }] };
    await post(body).expect(200);
    await post(body).expect(200);
    expect((await apptRow(apptId)).status).toBe('CONFIRMED');
    expect(await events(apptId)).toEqual([{ type: 'CONFIRMED', source: 'WHATSAPP', actor_user_id: null }]);
    expect(d360.sent).toHaveLength(1);
    expect(d360.sent[0].payload.text.body).toBe('✅ ¡Confirmado! Te esperamos el martes 6 de octubre a las 09:30.');
    const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM messages WHERE direction = 'IN'`);
    expect(count).toBe(1);
  });

  it('CANCEL cancela y cancela los recordatorios', async () => {
    await ds.query(`INSERT INTO scheduled_messages (clinic_id, kind, appointment_id, send_at) VALUES ($1, 'REMINDER_2H', $2, '2026-10-06T12:30:00Z')`, [clinicId, apptId]);
    await tap(`CANCEL:${apptId}`).expect(200);
    expect((await apptRow(apptId)).status).toBe('CANCELLED');
    const [sm] = await ds.query(`SELECT status FROM scheduled_messages WHERE appointment_id = $1`, [apptId]);
    expect(sm.status).toBe('CANCELLED');
    expect(d360.sent[0].payload.text.body).toBe('Tu cita fue cancelada. Si quieres agendar otra, escríbenos.');
  });

  it('ignora botones desde otro teléfono o de citas de otro consultorio', async () => {
    await tap(`CONFIRM:${apptId}`, '51900000001').expect(200);
    await tap(`CONFIRM:${foreignApptId}`).expect(200);
    expect((await apptRow(apptId)).status).toBe('SCHEDULED');
    expect((await apptRow(foreignApptId)).status).toBe('SCHEDULED');
    expect(d360.sent).toHaveLength(0);
  });

  it('RESCHEDULE envía la lista de horarios libres (sin el ocupado por otra cita)', async () => {
    await tap(`RESCHEDULE:${apptId}`).expect(200);
    const rows = d360.sent[0].payload.interactive.action.sections[0].rows;
    expect(rows.map((r: { id: string }) => r.id)).toEqual([
      `PICK:${apptId}:2026-10-06T14:00:00.000Z`,
      `PICK:${apptId}:2026-10-06T14:30:00.000Z`,
      `PICK:${apptId}:2026-10-06T15:30:00.000Z`,
    ]);
    expect(rows[0].title).toBe('mar 06/10 09:00');
  });

  it('PICK válido mueve la cita, la deja programada y responde', async () => {
    await pick(`PICK:${apptId}:2026-10-06T15:30:00.000Z`).expect(200);
    const row = await apptRow(apptId);
    expect(row).toEqual({ status: 'SCHEDULED', starts_at: new Date('2026-10-06T15:30:00Z') });
    expect((await events(apptId)).map((e: { type: string; source: string }) => [e.type, e.source])).toEqual([['RESCHEDULED', 'WHATSAPP']]);
    expect(d360.sent[0].payload.text.body).toBe('📅 Listo, tu cita quedó para el martes 6 de octubre a las 10:30.');
  });

  it('PICK manipulado (ocupado o fuera de horario) no mueve la cita y reenvía la lista', async () => {
    await pick(`PICK:${apptId}:2026-10-06T15:00:00.000Z`).expect(200);
    await pick(`PICK:${apptId}:2026-10-06T20:00:00.000Z`).expect(200);
    expect((await apptRow(apptId)).starts_at).toEqual(new Date('2026-10-06T14:30:00Z'));
    expect(d360.sent).toHaveLength(2);
    expect(d360.sent.every((s) => s.payload.type === 'interactive')).toBe(true);
    expect(d360.sent[0].payload.interactive.body.text).toBe('Ese horario ya no está disponible. Elige otro:');
  });

  it('cita ya cancelada: responde que no está activa', async () => {
    await ds.query(`UPDATE appointments SET status = 'CANCELLED' WHERE id = $1`, [apptId]);
    await tap(`CONFIRM:${apptId}`).expect(200);
    expect(d360.sent[0].payload.text.body).toBe('Esta cita ya no está activa. Si necesitas una nueva, escríbenos.');
  });

  it('texto libre se guarda sin responder; formato v1 también se acepta', async () => {
    await post({ messages: [{ from: FROM, id: 'wamid.v1', type: 'text', text: { body: 'Hola, ¿atienden el sábado?' } }] }).expect(200);
    const [msg] = await ds.query(`SELECT direction, type, payload FROM messages WHERE wa_message_id = 'wamid.v1'`);
    expect(msg).toEqual(expect.objectContaining({ direction: 'IN', type: 'text' }));
    expect(d360.sent).toHaveLength(0);
  });

  it('estados de entrega solo avanzan; FAILED siempre se registra', async () => {
    await ds.query(`INSERT INTO messages (clinic_id, direction, wa_message_id, type, status) VALUES ($1, 'OUT', 'wamid.out', 'template', 'SENT')`, [clinicId]);
    const status = (s: string) => post({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.out', status: s }] } }] }] }).expect(200);
    const current = async () => (await ds.query(`SELECT status FROM messages WHERE wa_message_id = 'wamid.out'`))[0].status;
    await status('read');
    expect(await current()).toBe('READ');
    await status('delivered');
    expect(await current()).toBe('READ');
    await status('failed');
    expect(await current()).toBe('FAILED');
  });
});
