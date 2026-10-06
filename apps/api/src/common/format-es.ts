import { localParts } from './zoned-time';

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const SHORT_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "martes 6 de octubre" */
export function fmtDateEs(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  const [, m, d] = p.date.split('-').map(Number);
  return `${DAYS[p.weekday]} ${d} de ${MONTHS[m - 1]}`;
}

/** "09:30" */
export function fmtTimeEs(instant: Date, timeZone: string): string {
  return localParts(instant, timeZone).time;
}

/** "jue 08/10 10:00" (cabe en el título de una fila de lista de WhatsApp, máx. 24). */
export function fmtSlotLabel(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  const [, m, d] = p.date.split('-');
  return `${SHORT_DAYS[p.weekday]} ${d}/${m} ${p.time}`;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
