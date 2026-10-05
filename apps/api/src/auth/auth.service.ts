import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { SubscriptionStatus } from '../clinics/clinic.entity';
import { Role } from '../users/role.enum';
import { User } from '../users/user.entity';
import { hashInviteToken } from './invite-token';

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  role: Role;
  clinic: { id: string; name: string; subscriptionStatus: SubscriptionStatus } | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; me: MeResponse }> {
    const user = await this.users.findOne({ where: { email } });
    const ok = !!user && user.active && !!user.passwordHash && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw new UnauthorizedException('Email o contraseña incorrectos');
    return { token: await this.sign(user!), me: await this.me(user!.id) };
  }

  async inviteInfo(token: string): Promise<{ name: string; email: string }> {
    const user = await this.findValidInvite(token);
    if (!user) throw new NotFoundException('Invitación inválida o vencida');
    return { name: user.name, email: user.email };
  }

  async acceptInvite(token: string, password: string): Promise<{ token: string; me: MeResponse }> {
    const user = await this.findValidInvite(token);
    if (!user) throw new BadRequestException('Invitación inválida o vencida');
    user.passwordHash = await bcrypt.hash(password, 10);
    user.inviteTokenHash = null;
    user.inviteExpiresAt = null;
    await this.users.save(user);
    return { token: await this.sign(user), me: await this.me(user.id) };
  }

  async me(userId: string): Promise<MeResponse> {
    const u = await this.users.findOneOrFail({ where: { id: userId }, relations: { clinic: true } });
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      clinic: u.clinic ? { id: u.clinic.id, name: u.clinic.name, subscriptionStatus: u.clinic.subscriptionStatus } : null,
    };
  }

  private async findValidInvite(token: string): Promise<User | null> {
    const user = await this.users.findOne({ where: { inviteTokenHash: hashInviteToken(token) } });
    if (!user || !user.active || !user.inviteExpiresAt || user.inviteExpiresAt.getTime() < Date.now()) return null;
    return user;
  }

  private sign(user: User): Promise<string> {
    return this.jwt.signAsync({ sub: user.id });
  }
}
