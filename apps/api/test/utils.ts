import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BusinessHour } from '../src/clinics/business-hour.entity';
import { Clinic } from '../src/clinics/clinic.entity';
import { Clock } from '../src/common/clock';
import { encrypt } from '../src/common/crypto';
import { D360Client } from '../src/whatsapp/d360-client';
import { WaAccountStatus, WhatsappAccount } from '../src/whatsapp/whatsapp-account.entity';
import { FakeClock, FakeD360 } from './fakes';
import { Patient } from '../src/patients/patient.entity';
import { Service } from '../src/services/service.entity';
import { Role } from '../src/users/role.enum';
import { User } from '../src/users/user.entity';

export async function createTestApp(
  customize?: (b: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (customize) builder = customize(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export async function createAppWithFakes(
  nowIso = '2026-10-01T12:00:00Z',
): Promise<{ app: INestApplication; clock: FakeClock; d360: FakeD360 }> {
  const clock = new FakeClock(nowIso);
  const d360 = new FakeD360();
  const app = await createTestApp((b) => b.overrideProvider(Clock).useValue(clock).overrideProvider(D360Client).useValue(d360));
  return { app, clock, d360 };
}

export async function seedWhatsapp(
  app: INestApplication,
  clinicId: string,
  opts: { apiKey?: string; sandbox?: boolean; status?: WaAccountStatus; token?: string; phone?: string; templates?: boolean } = {},
): Promise<WhatsappAccount> {
  const repo = app.get(DataSource).getRepository(WhatsappAccount);
  const account = await repo.save(
    repo.create({
      clinicId,
      phoneNumber: opts.phone ?? '+51900000000',
      sandbox: opts.sandbox ?? false,
      apiKeyEnc: encrypt(opts.apiKey ?? 'key-123'),
      webhookToken: opts.token ?? `tok-${clinicId}`,
      status: opts.status ?? WaAccountStatus.CONNECTED,
    }),
  );
  if (opts.templates ?? !account.sandbox) {
    await app.get(DataSource).query(
      `INSERT INTO whatsapp_templates (clinic_id, name, status) VALUES ($1,'recordatorio_cita_24h','APPROVED'),($1,'recordatorio_cita_2h','APPROVED'),($1,'recordatorio_pago','APPROVED')`,
      [clinicId],
    );
  }
  return account;
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

export async function seedService(app: INestApplication, clinicId: string, name = 'Limpieza', durationMin = 30): Promise<Service> {
  const repo = app.get(DataSource).getRepository(Service);
  return repo.save(repo.create({ clinicId, name, durationMin }));
}

export async function seedPatient(
  app: INestApplication,
  clinicId: string,
  data: { fullName?: string; phone?: string; optIn?: boolean } = {},
): Promise<Patient> {
  const repo = app.get(DataSource).getRepository(Patient);
  const optIn = data.optIn ?? true;
  return repo.save(
    repo.create({
      clinicId,
      fullName: data.fullName ?? 'Juan Pérez',
      phoneE164: data.phone ?? '+51987654321',
      whatsappOptIn: optIn,
      optInAt: optIn ? new Date() : null,
    }),
  );
}

export async function seedHours(
  app: INestApplication,
  clinicId: string,
  rows: { weekday: number; opensAt: string; closesAt: string }[],
): Promise<void> {
  const repo = app.get(DataSource).getRepository(BusinessHour);
  await repo.save(rows.map((r) => repo.create({ clinicId, ...r })));
}
