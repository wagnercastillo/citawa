import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum MessageDirection {
  IN = 'IN',
  OUT = 'OUT',
}

export enum MessageStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  FAILED = 'FAILED',
}

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ name: 'patient_id', type: 'uuid', nullable: true }) patientId: string | null;
  @Column({ type: 'enum', enum: MessageDirection, enumName: 'message_direction' }) direction: MessageDirection;
  @Column({ name: 'wa_message_id', type: 'varchar', length: 128, nullable: true }) waMessageId: string | null;
  @Column({ type: 'varchar', length: 32 }) type: string;
  @Column({ type: 'jsonb', default: {} }) payload: Record<string, unknown>;
  @Column({ type: 'enum', enum: MessageStatus, enumName: 'message_status', nullable: true }) status: MessageStatus | null;
  @Column({ name: 'scheduled_message_id', type: 'uuid', nullable: true }) scheduledMessageId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
