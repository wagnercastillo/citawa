export type Role = 'SUPERADMIN' | 'OWNER' | 'RECEPTION';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  clinic: { id: string; name: string; subscriptionStatus: string } | null;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  pending: boolean;
}

export interface ClinicRow {
  id: string;
  name: string;
  address: string | null;
  subscriptionStatus: string;
  paidUntil: string | null;
  owner: PublicUser | null;
}
