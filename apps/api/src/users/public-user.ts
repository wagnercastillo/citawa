import { Role } from './role.enum';
import { User } from './user.entity';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  pending: boolean;
}

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, pending: !u.passwordHash };
}
