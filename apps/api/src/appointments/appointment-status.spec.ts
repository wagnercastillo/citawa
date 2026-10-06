import { AppointmentStatus as S } from './appointment.entity';
import { canTransition } from './appointment-status';

describe('canTransition', () => {
  it('cita programada puede confirmarse, cancelarse, asistir o no asistir', () => {
    for (const to of [S.CONFIRMED, S.CANCELLED, S.ATTENDED, S.NO_SHOW]) expect(canTransition(S.SCHEDULED, to, false)).toBe(true);
  });
  it('confirmada no vuelve a confirmarse', () => {
    expect(canTransition(S.CONFIRMED, S.CONFIRMED, false)).toBe(false);
    expect(canTransition(S.CONFIRMED, S.ATTENDED, false)).toBe(true);
  });
  it('asistió/no asistió se pueden corregir entre sí', () => {
    expect(canTransition(S.ATTENDED, S.NO_SHOW, false)).toBe(true);
    expect(canTransition(S.NO_SHOW, S.ATTENDED, false)).toBe(true);
    expect(canTransition(S.ATTENDED, S.CANCELLED, false)).toBe(false);
  });
  it('cancelada es final', () => {
    for (const to of [S.SCHEDULED, S.CONFIRMED, S.ATTENDED, S.NO_SHOW]) expect(canTransition(S.CANCELLED, to, false)).toBe(false);
  });
  it('un bloqueo solo se puede cancelar', () => {
    expect(canTransition(S.SCHEDULED, S.CANCELLED, true)).toBe(true);
    expect(canTransition(S.SCHEDULED, S.CONFIRMED, true)).toBe(false);
    expect(canTransition(S.SCHEDULED, S.ATTENDED, true)).toBe(false);
  });
});
