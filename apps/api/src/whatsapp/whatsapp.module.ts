import { Module } from '@nestjs/common';
import { AdminWhatsappController } from './admin-whatsapp.controller';
import { D360Client } from './d360-client';
import { MessagesService } from './messages.service';
import { TemplateStatusPoller } from './template-status.poller';
import { WhatsappAccountsService } from './whatsapp-accounts.service';
import { WhatsappTemplatesService } from './whatsapp-templates.service';

@Module({
  controllers: [AdminWhatsappController],
  providers: [D360Client, WhatsappAccountsService, MessagesService, WhatsappTemplatesService, TemplateStatusPoller],
  exports: [D360Client, WhatsappAccountsService, MessagesService, WhatsappTemplatesService],
})
export class WhatsappModule {}
