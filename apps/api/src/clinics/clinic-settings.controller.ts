import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { Role } from '../users/role.enum';
import { HourDto, PutHoursDto, UpdateClinicSettingsDto } from './clinic-settings.dto';
import { ClinicSettings, ClinicSettingsService } from './clinic-settings.service';

@Roles(Role.OWNER, Role.RECEPTION)
@Controller('clinic')
export class ClinicSettingsController {
  constructor(private readonly settings: ClinicSettingsService) {}

  @Get()
  get(@CurrentUser() me: AuthUser): Promise<ClinicSettings> {
    return this.settings.get(me.clinicId!);
  }

  @Roles(Role.OWNER)
  @Patch()
  update(@CurrentUser() me: AuthUser, @Body() dto: UpdateClinicSettingsDto): Promise<ClinicSettings> {
    return this.settings.update(me.clinicId!, dto);
  }

  @Get('hours')
  hours(@CurrentUser() me: AuthUser): Promise<HourDto[]> {
    return this.settings.hours(me.clinicId!);
  }

  @Roles(Role.OWNER)
  @Put('hours')
  replaceHours(@CurrentUser() me: AuthUser, @Body() dto: PutHoursDto): Promise<HourDto[]> {
    return this.settings.replaceHours(me.clinicId!, dto.hours);
  }
}
