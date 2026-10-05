import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { PublicUser } from './public-user';
import { Role } from './role.enum';
import { InviteUserDto, SetActiveDto } from './users.dto';
import { UsersService } from './users.service';

@Roles(Role.OWNER)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() me: AuthUser): Promise<PublicUser[]> {
    return this.users.list(me.clinicId!);
  }

  @Post('invite')
  invite(@CurrentUser() me: AuthUser, @Body() dto: InviteUserDto): Promise<{ user: PublicUser; inviteUrl: string }> {
    return this.users.invite(me.clinicId!, dto);
  }

  @Patch(':id')
  setActive(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
  ): Promise<PublicUser> {
    return this.users.setActive(me.clinicId!, me.id, id, dto.active);
  }

  @Post(':id/reinvite')
  reinvite(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ inviteUrl: string }> {
    return this.users.reinvite(me.clinicId!, id);
  }
}
