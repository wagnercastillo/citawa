import { Module } from '@nestjs/common';
import { AdminWhatsappController } from './admin-whatsapp.controller';
import { D360Client } from './d360-client';
import { WhatsappAccountsService } from './whatsapp-accounts.service';

@Module({
  controllers: [AdminWhatsappController],
  providers: [D360Client, WhatsappAccountsService],
  exports: [D360Client, WhatsappAccountsService],
})
export class WhatsappModule {}
