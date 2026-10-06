import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ReminderDispatcher } from './reminder-dispatcher';
import { ReminderScheduler } from './reminder-scheduler';

@Module({
  imports: [WhatsappModule],
  providers: [ReminderScheduler, ReminderDispatcher],
  exports: [ReminderScheduler],
})
export class SchedulerModule {}
