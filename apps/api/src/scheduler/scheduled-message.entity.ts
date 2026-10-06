import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum ScheduledKind {
  REMINDER_24H = 'REMINDER_24H',
  REMINDER_2H = 'REMINDER_2H',
  PAYMENT_REMINDER = 'PAYMENT_REMINDER',
}

export enum ScheduledStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('scheduled_messages')
export class ScheduledMessage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ type: 'enum', enum: ScheduledKind, enumName: 'scheduled_kind' }) kind: ScheduledKind;
  @Column({ name: 'appointment_id', type: 'uuid', nullable: true }) appointmentId: string | null;
  @Column({ name: 'charge_id', type: 'uuid', nullable: true }) chargeId: string | null;
  @Column({ name: 'send_at', type: 'timestamptz' }) sendAt: Date;
  @Column({ type: 'enum', enum: ScheduledStatus, enumName: 'scheduled_status', default: ScheduledStatus.PENDING })
  status: ScheduledStatus;
  @Column({ type: 'integer', default: 0 }) attempts: number;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError: string | null;
  @Column({ name: 'cancel_reason', type: 'varchar', length: 120, nullable: true }) cancelReason: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
