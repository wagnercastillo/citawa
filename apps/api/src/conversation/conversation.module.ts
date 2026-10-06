import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ClinicsModule } from '../clinics/clinics.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConversationService } from './conversation.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [AppointmentsModule, ClinicsModule, WhatsappModule],
  controllers: [WebhookController],
  providers: [ConversationService],
})
export class ConversationModule {}
