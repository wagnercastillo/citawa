import { Module } from '@nestjs/common';
import { ClinicsModule } from '../clinics/clinics.module';
import { PatientsModule } from '../patients/patients.module';
import { ServicesModule } from '../services/services.module';
import { AppointmentsController, PatientAppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [ClinicsModule, ServicesModule, PatientsModule],
  controllers: [AppointmentsController, PatientAppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
