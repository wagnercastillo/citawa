import { IsDateString, IsIn, IsUUID, Matches } from 'class-validator';
import { DATE_RE, TIME_RE } from '../common/zoned-time';
import { AppointmentStatus } from './appointment.entity';

const DATE_MSG = { message: 'La fecha debe tener formato AAAA-MM-DD' };
const TIME_MSG = { message: 'La hora debe tener formato HH:MM' };

export class ListAppointmentsDto {
  @Matches(DATE_RE, DATE_MSG) @IsDateString({ strict: true }, DATE_MSG) from: string;
  @Matches(DATE_RE, DATE_MSG) @IsDateString({ strict: true }, DATE_MSG) to: string;
}

export class CreateAppointmentDto {
  @IsUUID() patientId: string;
  @IsUUID() serviceId: string;
  @Matches(DATE_RE, DATE_MSG) @IsDateString({ strict: true }, DATE_MSG) date: string;
  @Matches(TIME_RE, TIME_MSG) time: string;
}

export class CreateBlockDto {
  @Matches(DATE_RE, DATE_MSG) @IsDateString({ strict: true }, DATE_MSG) date: string;
  @Matches(TIME_RE, TIME_MSG) time: string;
  @Matches(TIME_RE, TIME_MSG) endTime: string;
}

export class UpdateAppointmentDto {
  @Matches(DATE_RE, DATE_MSG) @IsDateString({ strict: true }, DATE_MSG) date: string;
  @Matches(TIME_RE, TIME_MSG) time: string;
  @IsUUID() serviceId: string;
}

export const SETTABLE_STATUSES = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CANCELLED,
  AppointmentStatus.ATTENDED,
  AppointmentStatus.NO_SHOW,
] as const;

export class SetStatusDto {
  @IsIn(SETTABLE_STATUSES, { message: 'Estado inválido' }) status: (typeof SETTABLE_STATUSES)[number];
}
