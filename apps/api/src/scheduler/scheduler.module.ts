import { Module } from '@nestjs/common';
import { ReminderScheduler } from './reminder-scheduler';

@Module({
  providers: [ReminderScheduler],
  exports: [ReminderScheduler],
})
export class SchedulerModule {}
