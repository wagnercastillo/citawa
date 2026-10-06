import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { Role } from '../users/role.enum';
import {
  CreateAppointmentDto, CreateBlockDto, ListAppointmentsDto, SetStatusDto, UpdateAppointmentDto,
} from './appointments.dto';
import { AppointmentDto, AppointmentsService } from './appointments.service';

@Roles(Role.OWNER, Role.RECEPTION)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  list(@CurrentUser() me: AuthUser, @Query() q: ListAppointmentsDto): Promise<AppointmentDto[]> {
    return this.appointments.list(me.clinicId!, q.from, q.to);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateAppointmentDto): Promise<AppointmentDto> {
    return this.appointments.create(me, dto);
  }

  @Post('blocks')
  createBlock(@CurrentUser() me: AuthUser, @Body() dto: CreateBlockDto): Promise<AppointmentDto> {
    return this.appointments.createBlock(me, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
  ): Promise<AppointmentDto> {
    return this.appointments.update(me, id, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  setStatus(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStatusDto,
  ): Promise<AppointmentDto> {
    return this.appointments.setStatus(me, id, dto);
  }
}

@Roles(Role.OWNER, Role.RECEPTION)
@Controller('patients')
export class PatientAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get(':id/appointments')
  forPatient(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<AppointmentDto[]> {
    return this.appointments.forPatient(me.clinicId!, id);
  }
}
