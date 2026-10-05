import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/user.entity';
import { newInviteToken } from './invite-token';

@Injectable()
export class InvitesService {
  constructor(private readonly config: ConfigService) {}

  /** Asigna una invitación nueva al usuario (no lo guarda) y devuelve el enlace para compartir. */
  prepare(user: User): string {
    const { token, hash, expiresAt } = newInviteToken();
    user.inviteTokenHash = hash;
    user.inviteExpiresAt = expiresAt;
    return `${this.config.getOrThrow<string>('WEB_URL')}/invite/${token}`;
  }
}
