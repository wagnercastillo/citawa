import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { AuthUser } from '../auth/session';
import { Clock } from '../common/clock';
import { D360Client, PartnerCredentials } from './d360-client';
import { onboardingUrl, parseChannels } from './onboarding';
import { OnboardingState } from './onboarding-state.entity';
import { WhatsappAccountDto, WhatsappAccountsService } from './whatsapp-accounts.service';
import { TemplateDto, WhatsappTemplatesService } from './whatsapp-templates.service';

const STATE_TTL_MS = 30 * 60_000;
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');

@Injectable()
export class OnboardingService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly config: ConfigService,
    private readonly clock: Clock,
    private readonly d360: D360Client,
    private readonly accounts: WhatsappAccountsService,
    private readonly templates: WhatsappTemplatesService,
  ) {}

  async start(user: AuthUser): Promise<{ url: string }> {
    const partner = this.partner();
    const state = randomBytes(32).toString('base64url');
    await this.ds.getRepository(OnboardingState).insert({
      clinicId: user.clinicId!,
      userId: user.id,
      stateHash: hash(state),
      expiresAt: new Date(this.clock.now().getTime() + STATE_TTL_MS),
    });
    const redirect = `${this.config.getOrThrow<string>('WEB_URL')}/app/settings/whatsapp/callback`;
    return { url: onboardingUrl(partner.partnerId, redirect, state) };
  }

  async complete(user: AuthUser, state: string, channels: string): Promise<{ account: WhatsappAccountDto; templates: TemplateDto[] }> {
    const partner = this.partner();
    // Consumo atómico del state: un solo uso, vigente y del mismo consultorio.
    const consumed = await this.ds.getRepository(OnboardingState).update(
      { stateHash: hash(state), clinicId: user.clinicId!, usedAt: IsNull(), expiresAt: MoreThan(this.clock.now()) },
      { usedAt: this.clock.now() },
    );
    if (!consumed.affected) throw new BadRequestException('La conexión expiró o no es válida; vuelve a intentarlo');

    const [channelId] = parseChannels(channels);
    if (!channelId) throw new BadRequestException('360dialog no devolvió ningún número conectado');

    let account: WhatsappAccountDto;
    try {
      let key: { apiKey: string; address: string };
      try {
        key = await this.d360.createChannelApiKey(partner, channelId);
      } catch (e) {
        throw new BadGatewayException(`360dialog no entregó la API key: ${(e as Error).message}`);
      }
      account = await this.accounts.attach(user.clinicId!, { apiKey: key.apiKey, phoneNumber: key.address, sandbox: false, channelId });
    } catch (e) {
      // El fallo más común es "canal aún no listo": se libera el state para que el dueño reintente sin repetir el popup.
      await this.ds.getRepository(OnboardingState).update({ stateHash: hash(state) }, { usedAt: null });
      throw e;
    }
    return { account, templates: await this.templates.list(user.clinicId!) };
  }

  async status(clinicId: string): Promise<{ account: WhatsappAccountDto | null; templates: TemplateDto[] }> {
    const { account } = await this.accounts.get(clinicId);
    return { account, templates: await this.templates.list(clinicId) };
  }

  private partner(): PartnerCredentials {
    const partnerId = this.config.get<string>('D360_PARTNER_ID');
    const apiKey = this.config.get<string>('D360_PARTNER_API_KEY');
    if (!partnerId || !apiKey) throw new ServiceUnavailableException('Onboarding de WhatsApp no configurado');
    return { partnerId, apiKey };
  }
}
