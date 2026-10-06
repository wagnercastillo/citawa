import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { Clinic } from '../clinics/clinic.entity';
import { decrypt, encrypt } from '../common/crypto';
import { normalizePhone } from '../common/phone';
import { D360Client, D360Credentials } from './d360-client';
import { WaAccountStatus, WhatsappAccount } from './whatsapp-account.entity';
import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { ConnectWhatsappDto } from './whatsapp.dto';

export interface WhatsappAccountDto {
  phoneNumber: string;
  displayName: string | null;
  sandbox: boolean;
  status: WaAccountStatus;
  lastError: string | null;
  webhookUrl: string;
}

@Injectable()
export class WhatsappAccountsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly d360: D360Client,
    private readonly config: ConfigService,
    private readonly templates: WhatsappTemplatesService,
  ) {}

  /** Conexión manual del superadmin (key pegada a mano). */
  async connect(clinicId: string, dto: ConnectWhatsappDto): Promise<WhatsappAccountDto> {
    if (!(await this.ds.getRepository(Clinic).findOneBy({ id: clinicId }))) throw new NotFoundException('Consultorio no encontrado');
    return this.attach(clinicId, { apiKey: dto.apiKey, phoneNumber: dto.phoneNumber, sandbox: dto.sandbox ?? false, displayName: dto.displayName });
  }

  /** Guarda la key cifrada, registra el webhook y (en producción) crea las plantillas. */
  async attach(
    clinicId: string,
    a: { apiKey: string; phoneNumber: string; sandbox: boolean; displayName?: string; channelId?: string },
  ): Promise<WhatsappAccountDto> {
    // La Partner API devuelve el número sin "+" (51987654321); el panel lo envía en formato local o E.164.
    const phone = normalizePhone(a.phoneNumber) ?? normalizePhone(`+${a.phoneNumber}`);
    if (!phone) throw new BadRequestException('Teléfono inválido');

    const repo = this.ds.getRepository(WhatsappAccount);
    const account = (await repo.findOneBy({ clinicId })) ?? repo.create({ clinicId, webhookToken: randomBytes(24).toString('base64url') });
    account.phoneNumber = phone;
    account.displayName = a.displayName?.trim() || null;
    account.sandbox = a.sandbox;
    account.channelId = a.channelId ?? account.channelId ?? null;
    account.apiKeyEnc = encrypt(a.apiKey);
    account.status = WaAccountStatus.PENDING;
    account.lastError = null;
    await repo.save(account);

    const creds = { apiKey: a.apiKey, sandbox: a.sandbox };
    try {
      await this.d360.setWebhook(creds, this.webhookUrl(account));
      account.status = WaAccountStatus.CONNECTED;
    } catch (e) {
      account.status = WaAccountStatus.ERROR;
      account.lastError = (e as Error).message;
    }
    await repo.save(account);
    if (account.status === WaAccountStatus.CONNECTED && !a.sandbox) await this.templates.provision(clinicId, creds);
    return this.toDto(account);
  }

  async get(clinicId: string): Promise<{ account: WhatsappAccountDto | null }> {
    const account = await this.forClinic(clinicId);
    return { account: account ? this.toDto(account) : null };
  }

  forClinic(clinicId: string): Promise<WhatsappAccount | null> {
    return this.ds.getRepository(WhatsappAccount).findOneBy({ clinicId });
  }

  findByWebhookToken(token: string): Promise<WhatsappAccount | null> {
    return this.ds.getRepository(WhatsappAccount).findOneBy({ webhookToken: token });
  }

  credentials(account: WhatsappAccount): D360Credentials {
    return { apiKey: decrypt(account.apiKeyEnc), sandbox: account.sandbox };
  }

  async markError(clinicId: string, message: string): Promise<void> {
    await this.ds.getRepository(WhatsappAccount).update({ clinicId }, { status: WaAccountStatus.ERROR, lastError: message });
  }

  private webhookUrl(account: WhatsappAccount): string {
    return `${this.config.getOrThrow<string>('PUBLIC_API_URL')}/api/webhooks/wa/${account.webhookToken}`;
  }

  private toDto(a: WhatsappAccount): WhatsappAccountDto {
    return {
      phoneNumber: a.phoneNumber,
      displayName: a.displayName,
      sandbox: a.sandbox,
      status: a.status,
      lastError: a.lastError,
      webhookUrl: this.webhookUrl(a),
    };
  }
}
