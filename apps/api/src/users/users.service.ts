import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvitesService } from '../auth/invites.service';
import { PublicUser, toPublicUser } from './public-user';
import { Role } from './role.enum';
import { User } from './user.entity';
import { InviteUserDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>, private readonly invites: InvitesService) {}

  async list(clinicId: string): Promise<PublicUser[]> {
    const rows = await this.users.find({ where: { clinicId }, order: { createdAt: 'ASC' } });
    return rows.map(toPublicUser);
  }

  async invite(clinicId: string, dto: InviteUserDto): Promise<{ user: PublicUser; inviteUrl: string }> {
    if (await this.users.findOne({ where: { email: dto.email } })) {
      throw new ConflictException('Ya existe un usuario con ese email');
    }
    const user = this.users.create({ name: dto.name, email: dto.email, role: Role.RECEPTION, clinicId });
    const inviteUrl = this.invites.prepare(user);
    await this.users.save(user);
    return { user: toPublicUser(user), inviteUrl };
  }

  async setActive(clinicId: string, actorId: string, userId: string, active: boolean): Promise<PublicUser> {
    const user = await this.findInClinic(clinicId, userId);
    if (user.id === actorId) throw new BadRequestException('No puedes desactivarte a ti mismo');
    user.active = active;
    await this.users.save(user);
    return toPublicUser(user);
  }

  async reinvite(clinicId: string, userId: string): Promise<{ inviteUrl: string }> {
    const user = await this.findInClinic(clinicId, userId);
    if (user.passwordHash) throw new BadRequestException('Este usuario ya activó su cuenta');
    const inviteUrl = this.invites.prepare(user);
    await this.users.save(user);
    return { inviteUrl };
  }

  private async findInClinic(clinicId: string, userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId, clinicId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }
}
