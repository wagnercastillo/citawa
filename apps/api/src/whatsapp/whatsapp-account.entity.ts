import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum WaAccountStatus {
  PENDING = 'PENDING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

@Entity('whatsapp_accounts')
export class WhatsappAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'clinic_id', type: 'uuid' }) clinicId: string;
  @Column({ name: 'phone_number', type: 'varchar', length: 20 }) phoneNumber: string;
  @Column({ name: 'display_name', type: 'varchar', length: 120, nullable: true }) displayName: string | null;
  @Column({ name: 'channel_id', type: 'varchar', length: 64, nullable: true }) channelId: string | null;
  @Column({ type: 'boolean', default: false }) sandbox: boolean;
  @Column({ name: 'api_key_enc', type: 'text' }) apiKeyEnc: string;
  @Column({ name: 'webhook_token', type: 'varchar', length: 64 }) webhookToken: string;
  @Column({ type: 'enum', enum: WaAccountStatus, enumName: 'wa_account_status', default: WaAccountStatus.PENDING })
  status: WaAccountStatus;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
