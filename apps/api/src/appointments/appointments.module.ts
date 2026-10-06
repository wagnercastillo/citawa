import { Module } from '@nestjs/common';
import { ClinicsModule } from '../clinics/clinics.module';
import { PatientsModule } from '../patients/patients.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { ServicesModule } from '../services/services.module';
import { AppointmentsController, PatientAppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [ClinicsModule, ServicesModule, PatientsModule, SchedulerModule],
  controllers: [AppointmentsController, PatientAppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
