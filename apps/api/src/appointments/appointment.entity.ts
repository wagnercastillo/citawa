import {
  Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Patient } from '../patients/patient.entity';
import { Service } from '../services/service.entity';

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  ATTENDED = 'ATTENDED',
  NO_SHOW = 'NO_SHOW',
}

@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ name: 'patient_id', type: 'uuid', nullable: true }) patientId: string | null;
  @ManyToOne(() => Patient)
  @JoinColumn({ name: 'patient_id' })
  patient?: Patient | null;
  @Column({ name: 'service_id', type: 'uuid', nullable: true }) serviceId: string | null;
  @ManyToOne(() => Service)
  @JoinColumn({ name: 'service_id' })
  service?: Service | null;
  @Column({ name: 'starts_at', type: 'timestamptz' }) startsAt: Date;
  @Column({ name: 'ends_at', type: 'timestamptz' }) endsAt: Date;
  @Column({ type: 'enum', enum: AppointmentStatus, enumName: 'appointment_status', default: AppointmentStatus.SCHEDULED })
  status: AppointmentStatus;
  @Column({ name: 'is_block', type: 'boolean', default: false }) isBlock: boolean;
  @Column({ name: 'google_event_id', type: 'varchar', length: 255, nullable: true }) googleEventId: string | null;
  @Column({ name: 'calendar_dirty', type: 'boolean', default: true }) calendarDirty: boolean;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
