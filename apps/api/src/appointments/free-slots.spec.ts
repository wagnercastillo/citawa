import { freeSlots } from './free-slots';

const tz = 'America/Lima';
const lima = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);
const iso = (d: Date[]) => d.map((x) => x.toISOString());

describe('freeSlots', () => {
  const monday = { weekday: 1, opensAt: '09:00', closesAt: '11:00' };

  it('bloques del largo del servicio, saltando lo ocupado', () => {
    const slots = freeSlots({
      hours: [monday],
      busy: [{ start: lima('2026-10-12', '09:30'), end: lima('2026-10-12', '10:00') }],
      durationMin: 30, timeZone: tz, fromDate: '2026-10-12', days: 1, limit: 10,
    });
    expect(iso(slots)).toEqual([
      lima('2026-10-12', '09:00').toISOString(),
      lima('2026-10-12', '10:00').toISOString(),
      lima('2026-10-12', '10:30').toISOString(),
    ]);
  });

  it('un ocupado parcial descarta todos los bloques que toca', () => {
    const slots = freeSlots({
      hours: [monday],
      busy: [{ start: lima('2026-10-12', '10:15'), end: lima('2026-10-12', '10:45') }],
      durationMin: 30, timeZone: tz, fromDate: '2026-10-12', days: 1, limit: 10,
    });
    expect(iso(slots)).toEqual([lima('2026-10-12', '09:00').toISOString(), lima('2026-10-12', '09:30').toISOString()]);
  });

  it('salta días sin horario y respeta el límite', () => {
    const slots = freeSlots({ hours: [monday], busy: [], durationMin: 30, timeZone: tz, fromDate: '2026-10-11', days: 2, limit: 3 });
    expect(iso(slots)).toEqual([
      lima('2026-10-12', '09:00').toISOString(),
      lima('2026-10-12', '09:30').toISOString(),
      lima('2026-10-12', '10:00').toISOString(),
    ]);
  });

  it('varias franjas el mismo día y servicio que no entra completo', () => {
    const slots = freeSlots({
      hours: [{ weekday: 1, opensAt: '15:00', closesAt: '16:00' }, { weekday: 1, opensAt: '09:00', closesAt: '10:00' }],
      busy: [], durationMin: 45, timeZone: tz, fromDate: '2026-10-12', days: 1, limit: 10,
    });
    expect(iso(slots)).toEqual([lima('2026-10-12', '09:00').toISOString(), lima('2026-10-12', '15:00').toISOString()]);
  });
});
