import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('business_hours')
export class BusinessHour {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ type: 'smallint' }) weekday: number;
  @Column({ name: 'opens_at', type: 'time' }) opensAt: string;
  @Column({ name: 'closes_at', type: 'time' }) closesAt: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
