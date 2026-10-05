import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  SUSPENDED = 'SUSPENDED',
}

@Entity('clinics')
export class Clinic {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) address: string | null;
  @Column({ type: 'varchar', length: 64, default: 'America/Lima' }) timezone: string;
  @Column({ name: 'payment_instructions', type: 'text', nullable: true }) paymentInstructions: string | null;
  @Column({ name: 'send_2h_to_confirmed', type: 'boolean', default: false }) send2hToConfirmed: boolean;
  @Column({
    name: 'subscription_status',
    type: 'enum',
    enum: SubscriptionStatus,
    enumName: 'subscription_status',
    default: SubscriptionStatus.ACTIVE,
  })
  subscriptionStatus: SubscriptionStatus;
  @Column({ name: 'paid_until', type: 'date', nullable: true }) paidUntil: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
