import { addDays, zonedToUtc } from '../common/zoned-time';

export interface HourRange {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface Busy {
  start: Date;
  end: Date;
}

/** Horarios libres (inicio de cada bloque) dentro del horario de atención, sin cruzarse con `busy`. */
export function freeSlots(o: {
  hours: HourRange[];
  busy: Busy[];
  durationMin: number;
  timeZone: string;
  fromDate: string;
  days: number;
  limit: number;
}): Date[] {
  const dur = o.durationMin * 60_000;
  const out: Date[] = [];
  for (let i = 0; i < o.days && out.length < o.limit; i++) {
    const date = addDays(o.fromDate, i);
    const [y, m, d] = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const ranges = o.hours.filter((h) => h.weekday === weekday).sort((a, b) => a.opensAt.localeCompare(b.opensAt));
    for (const r of ranges) {
      const close = zonedToUtc(date, r.closesAt, o.timeZone).getTime();
      for (let t = zonedToUtc(date, r.opensAt, o.timeZone).getTime(); t + dur <= close && out.length < o.limit; t += dur) {
        const clash = o.busy.some((b) => b.start.getTime() < t + dur && t < b.end.getTime());
        if (!clash) out.push(new Date(t));
      }
    }
  }
  return out;
}
