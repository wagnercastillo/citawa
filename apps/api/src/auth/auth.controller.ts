import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Response } from 'express';
import { AcceptInviteDto, LoginDto } from './auth.dto';
import { AuthService, MeResponse } from './auth.service';
import { CurrentUser, Public } from './decorators';
import { AuthUser, SESSION_COOKIE, sessionCookieOptions } from './session';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<MeResponse> {
    const { token, me } = await this.auth.login(dto.email, dto.password);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return me;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Get('invite/:token')
  inviteInfo(@Param('token') token: string): Promise<{ name: string; email: string }> {
    return this.auth.inviteInfo(token);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('invite/accept')
  @HttpCode(200)
  async accept(@Body() dto: AcceptInviteDto, @Res({ passthrough: true }) res: Response): Promise<MeResponse> {
    const { token, me } = await this.auth.acceptInvite(dto.token, dto.password);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return me;
  }
}
