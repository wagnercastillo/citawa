import {
  Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Clinic } from '../clinics/clinic.entity';
import { Role } from './role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 254, unique: true }) email: string;
  @Column({ name: 'password_hash', type: 'varchar', length: 100, nullable: true }) passwordHash: string | null;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'enum', enum: Role, enumName: 'user_role' }) role: Role;
  @Column({ name: 'clinic_id', type: 'uuid', nullable: true }) clinicId: string | null;
  @ManyToOne(() => Clinic, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clinic_id' })
  clinic?: Clinic;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ name: 'invite_token_hash', type: 'char', length: 64, nullable: true, unique: true })
  inviteTokenHash: string | null;
  @Column({ name: 'invite_expires_at', type: 'timestamptz', nullable: true }) inviteExpiresAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
