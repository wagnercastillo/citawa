import type { AppointmentStatus } from './types';

export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Programada',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  ATTENDED: 'Asistió',
  NO_SHOW: 'No asistió',
};

export const STATUS_CLASS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-200 text-slate-500 line-through',
  ATTENDED: 'bg-blue-100 text-blue-800',
  NO_SHOW: 'bg-red-100 text-red-800',
};

export function fmtTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-PE', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/** Fecha local YYYY-MM-DD del instante `iso` en la zona `timeZone`. */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function todayIn(timeZone: string): string {
  return localDate(new Date().toISOString(), timeZone);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Lunes de la semana que contiene `date`. */
export function startOfWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function fmtDayHeader(date: string): string {
  return new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
