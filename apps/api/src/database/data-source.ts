import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Clinic } from '../clinics/clinic.entity';
import { User } from '../users/user.entity';
import { Init1759700000000 } from './migrations/1759700000000-Init';

config({ path: resolve(__dirname, '../../../../.env') });

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Clinic, User],
  migrations: [Init1759700000000],
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
