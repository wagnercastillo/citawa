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

export interface ClinicSettings {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  paymentInstructions: string | null;
  send2hToConfirmed: boolean;
  subscriptionStatus: string;
  paidUntil: string | null;
}

export interface BusinessHour {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  active: boolean;
}

export interface Patient {
  id: string;
  fullName: string;
  phone: string;
  whatsappOptIn: boolean;
  optInAt: string | null;
  notes: string | null;
}

export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED' | 'NO_SHOW';

export interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  isBlock: boolean;
  patient: { id: string; fullName: string; phone: string } | null;
  service: { id: string; name: string; durationMin: number } | null;
}

export interface WaAccount {
  phoneNumber: string;
  displayName: string | null;
  sandbox: boolean;
  status: 'PENDING' | 'CONNECTED' | 'ERROR';
  lastError: string | null;
  webhookUrl: string;
}

export interface WaTemplate {
  name: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  rejectionReason: string | null;
}

export interface WaStatus {
  account: WaAccount | null;
  templates: WaTemplate[];
}
