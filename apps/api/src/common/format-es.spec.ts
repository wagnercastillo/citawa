import { firstName, fmtDateEs, fmtSlotLabel, fmtTimeEs } from './format-es';

describe('format-es', () => {
  const tz = 'America/Lima';
  it('fecha larga y hora', () => {
    expect(fmtDateEs(new Date('2026-10-06T14:30:00Z'), tz)).toBe('martes 6 de octubre');
    expect(fmtTimeEs(new Date('2026-10-06T14:30:00Z'), tz)).toBe('09:30');
  });
  it('etiqueta corta de horario (≤ 24 caracteres)', () => {
    const label = fmtSlotLabel(new Date('2026-10-08T15:00:00Z'), tz);
    expect(label).toBe('jue 08/10 10:00');
    expect(label.length).toBeLessThanOrEqual(24);
  });
  it('primer nombre', () => {
    expect(firstName('  Juan Carlos Pérez ')).toBe('Juan');
  });
});
