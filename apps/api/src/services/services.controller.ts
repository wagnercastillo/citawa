import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { Role } from '../users/role.enum';
import { CreateServiceDto, UpdateServiceDto } from './services.dto';
import { ServiceDto, ServicesService } from './services.service';

@Roles(Role.OWNER, Role.RECEPTION)
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(@CurrentUser() me: AuthUser): Promise<ServiceDto[]> {
    return this.services.list(me.clinicId!);
  }

  @Roles(Role.OWNER)
  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateServiceDto): Promise<ServiceDto> {
    return this.services.create(me.clinicId!, dto);
  }

  @Roles(Role.OWNER)
  @Patch(':id')
  update(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ): Promise<ServiceDto> {
    return this.services.update(me.clinicId!, id, dto);
  }
}
