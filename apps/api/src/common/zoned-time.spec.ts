import { addDays, DATE_RE, daysBetween, TIME_RE, zonedToUtc } from './zoned-time';

describe('zoned-time', () => {
  it('convierte hora de pared de Lima (UTC-5) a UTC', () => {
    expect(zonedToUtc('2026-10-06', '09:30', 'America/Lima').toISOString()).toBe('2026-10-06T14:30:00.000Z');
  });

  it('23:30 en Lima es el día siguiente en UTC', () => {
    expect(zonedToUtc('2026-10-06', '23:30', 'America/Lima').toISOString()).toBe('2026-10-07T04:30:00.000Z');
  });

  it('respeta horario de verano (Madrid)', () => {
    expect(zonedToUtc('2026-07-01', '10:00', 'Europe/Madrid').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-01-15', '10:00', 'Europe/Madrid').toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it('medianoche', () => {
    expect(zonedToUtc('2026-10-06', '00:00', 'America/Lima').toISOString()).toBe('2026-10-06T05:00:00.000Z');
  });

  it('addDays cruza meses y años', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('daysBetween', () => {
    expect(daysBetween('2026-10-05', '2026-10-11')).toBe(6);
    expect(daysBetween('2026-10-05', '2026-10-05')).toBe(0);
    expect(daysBetween('2026-10-05', '2026-10-04')).toBe(-1);
  });

  it('regex de fecha y hora', () => {
    expect(DATE_RE.test('2026-10-06')).toBe(true);
    expect(DATE_RE.test('6/10/2026')).toBe(false);
    expect(TIME_RE.test('09:30')).toBe(true);
    expect(TIME_RE.test('9:30')).toBe(false);
    expect(TIME_RE.test('24:00')).toBe(false);
  });
});
