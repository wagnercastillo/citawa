import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/session';
import { Role } from '../users/role.enum';
import { OnboardingService } from './onboarding.service';

class CompleteOnboardingDto {
  @IsString() @MaxLength(200) state: string;
  @IsString() @MaxLength(500) channels: string;
}

@Roles(Role.OWNER)
@Controller('whatsapp')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  status(@CurrentUser() me: AuthUser) {
    return this.onboarding.status(me.clinicId!);
  }

  @Post('onboarding/start')
  start(@CurrentUser() me: AuthUser) {
    return this.onboarding.start(me);
  }

  @Post('onboarding/complete')
  complete(@CurrentUser() me: AuthUser, @Body() dto: CompleteOnboardingDto) {
    return this.onboarding.complete(me, dto.state, dto.channels);
  }
}
