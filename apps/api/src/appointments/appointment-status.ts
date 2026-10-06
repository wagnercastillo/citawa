import { AppointmentStatus as S } from './appointment.entity';

const ALLOWED: Record<S, S[]> = {
  [S.SCHEDULED]: [S.CONFIRMED, S.CANCELLED, S.ATTENDED, S.NO_SHOW],
  [S.CONFIRMED]: [S.CANCELLED, S.ATTENDED, S.NO_SHOW],
  [S.ATTENDED]: [S.NO_SHOW],
  [S.NO_SHOW]: [S.ATTENDED],
  [S.CANCELLED]: [],
};

export function canTransition(from: S, to: S, isBlock: boolean): boolean {
  if (isBlock) return from === S.SCHEDULED && to === S.CANCELLED;
  return ALLOWED[from].includes(to);
}
