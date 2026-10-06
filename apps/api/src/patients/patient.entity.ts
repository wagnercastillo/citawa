import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ name: 'full_name', type: 'varchar', length: 160 }) fullName: string;
  @Column({ name: 'phone_e164', type: 'varchar', length: 20 }) phoneE164: string;
  @Column({ name: 'whatsapp_opt_in', type: 'boolean', default: false }) whatsappOptIn: boolean;
  @Column({ name: 'opt_in_at', type: 'timestamptz', nullable: true }) optInAt: Date | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
