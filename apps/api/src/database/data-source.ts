import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AppointmentEvent } from '../appointments/appointment-event.entity';
import { Appointment } from '../appointments/appointment.entity';
import { BusinessHour } from '../clinics/business-hour.entity';
import { Clinic } from '../clinics/clinic.entity';
import { Patient } from '../patients/patient.entity';
import { Service } from '../services/service.entity';
import { User } from '../users/user.entity';
import { Init1759700000000 } from './migrations/1759700000000-Init';
import { Agenda1759800000000 } from './migrations/1759800000000-Agenda';
import { Messaging1759900000000 } from './migrations/1759900000000-Messaging';
import { ScheduledMessage } from '../scheduler/scheduled-message.entity';
import { Message } from '../whatsapp/message.entity';
import { WhatsappAccount } from '../whatsapp/whatsapp-account.entity';

config({ path: resolve(__dirname, '../../../../.env') });

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Clinic, User, BusinessHour, Service, Patient, Appointment, AppointmentEvent, WhatsappAccount, ScheduledMessage, Message],
  migrations: [Init1759700000000, Agenda1759800000000, Messaging1759900000000],
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
