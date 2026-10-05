import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { InvitesService } from '../auth/invites.service';
import { Clinic, SubscriptionStatus } from '../clinics/clinic.entity';
import { PublicUser, toPublicUser } from '../users/public-user';
import { Role } from '../users/role.enum';
import { User } from '../users/user.entity';
import { CreateClinicDto, UpdateClinicDto } from './admin.dto';

export interface ClinicRow {
  id: string;
  name: string;
  address: string | null;
  subscriptionStatus: SubscriptionStatus;
  paidUntil: string | null;
  owner: PublicUser | null;
}

const toRow = (c: Clinic, owner?: User): ClinicRow => ({
  id: c.id,
  name: c.name,
  address: c.address,
  subscriptionStatus: c.subscriptionStatus,
  paidUntil: c.paidUntil,
  owner: owner ? toPublicUser(owner) : null,
});

@Injectable()
export class AdminService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly invites: InvitesService) {}

  async list(): Promise<ClinicRow[]> {
    const clinics = await this.ds.getRepository(Clinic).find({ order: { createdAt: 'DESC' } });
    if (!clinics.length) return [];
    const owners = await this.ds
      .getRepository(User)
      .find({ where: { role: Role.OWNER, clinicId: In(clinics.map((c) => c.id)) }, order: { createdAt: 'ASC' } });
    return clinics.map((c) => toRow(c, owners.find((o) => o.clinicId === c.id)));
  }

  create(dto: CreateClinicDto): Promise<{ clinic: ClinicRow; inviteUrl: string }> {
    return this.ds.transaction(async (m) => {
      if (await m.findOne(User, { where: { email: dto.ownerEmail } })) {
        throw new ConflictException('Ya existe un usuario con ese email');
      }
      const clinic = await m.save(m.create(Clinic, { name: dto.name, address: dto.address ?? null }));
      const owner = m.create(User, { name: dto.ownerName, email: dto.ownerEmail, role: Role.OWNER, clinicId: clinic.id });
      const inviteUrl = this.invites.prepare(owner);
      await m.save(owner);
      return { clinic: toRow(clinic, owner), inviteUrl };
    });
  }

  async update(id: string, dto: UpdateClinicDto): Promise<ClinicRow> {
    const repo = this.ds.getRepository(Clinic);
    const clinic = await repo.findOne({ where: { id } });
    if (!clinic) throw new NotFoundException('Consultorio no encontrado');
    clinic.paidUntil = dto.paidUntil;
    await repo.save(clinic);
    const owner = await this.ds.getRepository(User).findOne({ where: { clinicId: id, role: Role.OWNER } });
    return toRow(clinic, owner ?? undefined);
  }

  async reinviteOwner(clinicId: string): Promise<{ inviteUrl: string }> {
    const repo = this.ds.getRepository(User);
    const owner = await repo.findOne({ where: { clinicId, role: Role.OWNER }, order: { createdAt: 'ASC' } });
    if (!owner) throw new NotFoundException('Consultorio no encontrado');
    if (owner.passwordHash) throw new BadRequestException('El dueño ya activó su cuenta');
    const inviteUrl = this.invites.prepare(owner);
    await repo.save(owner);
    return { inviteUrl };
  }
}
