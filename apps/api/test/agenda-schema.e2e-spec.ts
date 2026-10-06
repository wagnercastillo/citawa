import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb, seedClinic, seedPatient, seedService } from './utils';

describe('agenda schema', () => {
  let app: INestApplication;
  let ds: DataSource;
  let clinicA: string;
  let clinicB: string;
  let patientA: string;
  let serviceA: string;
  let patientB: string;
  let serviceB: string;

  const insert = (clinicId: string, starts: string, ends: string, extra: Record<string, unknown> = {}) => {
    const block = extra.is_block === true;
    return ds.query(
      `INSERT INTO appointments (clinic_id, patient_id, service_id, starts_at, ends_at, status, is_block)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        clinicId,
        block ? null : (extra.patient_id ?? (clinicId === clinicA ? patientA : patientB)),
        block ? null : (extra.service_id ?? (clinicId === clinicA ? serviceA : serviceB)),
        starts,
        ends,
        extra.status ?? 'SCHEDULED',
        block,
      ],
    );
  };

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDb(app);
    clinicA = (await seedClinic(app, 'A')).id;
    clinicB = (await seedClinic(app, 'B')).id;
    patientA = (await seedPatient(app, clinicA)).id;
    serviceA = (await seedService(app, clinicA)).id;
    patientB = (await seedPatient(app, clinicB)).id;
    serviceB = (await seedService(app, clinicB)).id;
  });
  afterAll(async () => { await app.close(); });

  it('rechaza citas que se cruzan en el mismo consultorio', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z');
    await expect(insert(clinicA, '2026-10-06T14:15:00Z', '2026-10-06T14:45:00Z')).rejects.toMatchObject({ code: '23P01' });
  });

  it('permite citas pegadas (una termina cuando empieza la otra)', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z');
    await expect(insert(clinicA, '2026-10-06T14:30:00Z', '2026-10-06T15:00:00Z')).resolves.toBeDefined();
  });

  it('una cita cancelada no ocupa el horario', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z', { status: 'CANCELLED' });
    await expect(insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z')).resolves.toBeDefined();
  });

  it('otro consultorio puede tener cita a la misma hora', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z');
    await expect(insert(clinicB, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z')).resolves.toBeDefined();
  });

  it('un bloqueo también ocupa el horario', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T16:00:00Z', { is_block: true });
    await expect(insert(clinicA, '2026-10-06T15:00:00Z', '2026-10-06T15:30:00Z')).rejects.toMatchObject({ code: '23P01' });
  });

  it('rechaza fin antes del inicio y bloqueo con paciente', async () => {
    await expect(insert(clinicA, '2026-10-06T15:00:00Z', '2026-10-06T14:00:00Z')).rejects.toMatchObject({ code: '23514' });
    await expect(
      ds.query(
        `INSERT INTO appointments (clinic_id, patient_id, service_id, starts_at, ends_at, is_block)
         VALUES ($1, $2, $3, '2026-10-06T14:00:00Z', '2026-10-06T15:00:00Z', true)`,
        [clinicA, patientA, serviceA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('borrar el consultorio borra pacientes, servicios y citas', async () => {
    await insert(clinicA, '2026-10-06T14:00:00Z', '2026-10-06T14:30:00Z');
    await ds.query('DELETE FROM clinics WHERE id = $1', [clinicA]);
    const [{ count }] = await ds.query('SELECT count(*)::int AS count FROM appointments WHERE clinic_id = $1', [clinicA]);
    expect(count).toBe(0);
  });
});
