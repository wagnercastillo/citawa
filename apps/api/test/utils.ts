import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Clinic } from '../src/clinics/clinic.entity';
import { Role } from '../src/users/role.enum';
import { User } from '../src/users/user.entity';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDb(app: INestApplication): Promise<void> {
  await app.get(DataSource).query('TRUNCATE users, clinics RESTART IDENTITY CASCADE');
}

export async function seedClinic(app: INestApplication, name = 'Clínica Demo'): Promise<Clinic> {
  const repo = app.get(DataSource).getRepository(Clinic);
  return repo.save(repo.create({ name }));
}

export async function seedUser(
  app: INestApplication,
  data: { email: string; role: Role; clinicId?: string | null; password?: string; name?: string; active?: boolean },
): Promise<User> {
  const repo = app.get(DataSource).getRepository(User);
  return repo.save(
    repo.create({
      email: data.email,
      name: data.name ?? 'Usuario',
      role: data.role,
      clinicId: data.clinicId ?? null,
      active: data.active ?? true,
      passwordHash: data.password ? await bcrypt.hash(data.password, 4) : null,
    }),
  );
}
