import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum AppointmentEventType {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  RESCHEDULED = 'RESCHEDULED',
  ATTENDED = 'ATTENDED',
  NO_SHOW = 'NO_SHOW',
}

export enum EventSource {
  PANEL = 'PANEL',
  WHATSAPP = 'WHATSAPP',
}

@Entity('appointment_events')
export class AppointmentEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'appointment_id', type: 'uuid' }) appointmentId: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ type: 'enum', enum: AppointmentEventType, enumName: 'appointment_event_type' }) type: AppointmentEventType;
  @Column({ type: 'enum', enum: EventSource, enumName: 'event_source' }) source: EventSource;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true }) actorUserId: string | null;
  @Column({ type: 'jsonb', default: {} }) data: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
