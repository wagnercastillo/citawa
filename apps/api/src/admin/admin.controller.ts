import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { Role } from '../users/role.enum';
import { CreateClinicDto, UpdateClinicDto } from './admin.dto';
import { AdminService, ClinicRow } from './admin.service';

@Roles(Role.SUPERADMIN)
@Controller('admin/clinics')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(): Promise<ClinicRow[]> {
    return this.admin.list();
  }

  @Post()
  create(@Body() dto: CreateClinicDto): Promise<{ clinic: ClinicRow; inviteUrl: string }> {
    return this.admin.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClinicDto): Promise<ClinicRow> {
    return this.admin.update(id, dto);
  }

  @Post(':id/reinvite-owner')
  reinvite(@Param('id', ParseUUIDPipe) id: string): Promise<{ inviteUrl: string }> {
    return this.admin.reinviteOwner(id);
  }
}
