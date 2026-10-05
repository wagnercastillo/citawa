import * as bcrypt from 'bcryptjs';
import { Role } from '../users/role.enum';
import { User } from '../users/user.entity';
import dataSource from './data-source';

async function main(): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password || password.length < 8) {
    throw new Error('Define SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD (mínimo 8 caracteres) en .env');
  }
  await dataSource.initialize();
  const repo = dataSource.getRepository(User);
  const user = (await repo.findOne({ where: { email } })) ?? repo.create({ email, name: 'Superadmin' });
  user.role = Role.SUPERADMIN;
  user.clinicId = null;
  user.active = true;
  user.passwordHash = await bcrypt.hash(password, 10);
  await repo.save(user);
  console.log(`Superadmin listo: ${email}`);
  await dataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
