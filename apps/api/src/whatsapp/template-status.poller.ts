import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WhatsappAccount } from './whatsapp-account.entity';
import { WhatsappAccountsService } from './whatsapp-accounts.service';
import { WhatsappTemplatesService } from './whatsapp-templates.service';

/** Cada 15 min consulta 360dialog para cada cuenta de producción (Meta también pausa o deshabilita plantillas aprobadas). */
@Injectable()
export class TemplateStatusPoller {
  private readonly logger = new Logger(TemplateStatusPoller.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly accounts: WhatsappAccountsService,
    private readonly templates: WhatsappTemplatesService,
  ) {}

  @Cron('0 */15 * * * *')
  async tick(): Promise<void> {
    if (process.env.SCHEDULER_ENABLED === 'false') return;
    await this.runOnce().catch((e) => this.logger.error(e));
  }

  async runOnce(): Promise<number> {
    const clinicIds: { clinic_id: string }[] = await this.ds.query(
      `SELECT clinic_id FROM whatsapp_accounts WHERE status = 'CONNECTED' AND NOT sandbox`,
    );
    for (const { clinic_id } of clinicIds) {
      const account = await this.ds.getRepository(WhatsappAccount).findOneByOrFail({ clinicId: clinic_id });
      await this.templates
        .refresh(clinic_id, this.accounts.credentials(account))
        .catch((e) => this.logger.warn(`Plantillas de ${clinic_id}: ${(e as Error).message}`));
    }
    return clinicIds.length;
  }
}
