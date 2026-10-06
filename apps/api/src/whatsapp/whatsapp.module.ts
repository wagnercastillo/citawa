import { Module } from '@nestjs/common';
import { AdminWhatsappController } from './admin-whatsapp.controller';
import { D360Client } from './d360-client';
import { MessagesService } from './messages.service';
import { WhatsappAccountsService } from './whatsapp-accounts.service';

@Module({
  controllers: [AdminWhatsappController],
  providers: [D360Client, WhatsappAccountsService, MessagesService],
  exports: [D360Client, WhatsappAccountsService, MessagesService],
})
export class WhatsappModule {}
