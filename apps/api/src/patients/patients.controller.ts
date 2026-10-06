import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { Role } from '../users/role.enum';
import { CreatePatientDto, SearchPatientsDto, UpdatePatientDto } from './patients.dto';
import { PatientDto, PatientsService } from './patients.service';

@Roles(Role.OWNER, Role.RECEPTION)
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  search(@CurrentUser() me: AuthUser, @Query() query: SearchPatientsDto): Promise<PatientDto[]> {
    return this.patients.search(me.clinicId!, query.q);
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PatientDto> {
    return this.patients.get(me.clinicId!, id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreatePatientDto): Promise<PatientDto> {
    return this.patients.create(me.clinicId!, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
  ): Promise<PatientDto> {
    return this.patients.update(me.clinicId!, id, dto);
  }
}
