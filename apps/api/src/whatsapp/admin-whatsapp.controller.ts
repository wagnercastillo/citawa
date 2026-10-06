import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { Role } from '../users/role.enum';
import { WhatsappAccountDto, WhatsappAccountsService } from './whatsapp-accounts.service';
import { ConnectWhatsappDto } from './whatsapp.dto';

@Roles(Role.SUPERADMIN)
@Controller('admin/clinics')
export class AdminWhatsappController {
  constructor(private readonly accounts: WhatsappAccountsService) {}

  @Get(':id/whatsapp')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<{ account: WhatsappAccountDto | null }> {
    return this.accounts.get(id);
  }

  @Put(':id/whatsapp')
  connect(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConnectWhatsappDto): Promise<WhatsappAccountDto> {
    return this.accounts.connect(id, dto);
  }
}
