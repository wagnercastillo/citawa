import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';

config({ path: resolve(__dirname, '../../../../.env') });

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [],
  migrations: [],
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
