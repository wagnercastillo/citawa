import './env';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/database/data-source';

export default async function globalSetup(): Promise<void> {
  const ds = new DataSource({ ...dataSourceOptions, url: process.env.DATABASE_URL } as typeof dataSourceOptions);
  await ds.initialize();
  await ds.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await ds.runMigrations();
  await ds.destroy();
}
