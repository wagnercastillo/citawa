import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { normalizePhone } from '../common/phone';
import { Patient } from './patient.entity';
import { CreatePatientDto, UpdatePatientDto } from './patients.dto';

export interface PatientDto {
  id: string;
  fullName: string;
  phone: string;
  whatsappOptIn: boolean;
  optInAt: string | null;
  notes: string | null;
}

export const toPatientDto = (p: Patient): PatientDto => ({
  id: p.id,
  fullName: p.fullName,
  phone: p.phoneE164,
  whatsappOptIn: p.whatsappOptIn,
  optInAt: p.optInAt ? p.optInAt.toISOString() : null,
  notes: p.notes,
});

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class PatientsService {
  constructor(@InjectRepository(Patient) private readonly patients: Repository<Patient>) {}

  async search(clinicId: string, q?: string): Promise<PatientDto[]> {
    const qb = this.patients.createQueryBuilder('p').where('p.clinic_id = :clinicId', { clinicId });
    const text = q?.trim();
    if (text) {
      const digits = text.replace(/\D/g, '');
      const params = { name: `%${escapeLike(text)}%`, digits: `%${digits}%` };
      qb.andWhere(
        digits.length >= 3 ? '(p.full_name ILIKE :name OR p.phone_e164 LIKE :digits)' : 'p.full_name ILIKE :name',
        params,
      );
    }
    const rows = await qb.orderBy('p.full_name', 'ASC').limit(50).getMany();
    return rows.map(toPatientDto);
  }

  async get(clinicId: string, id: string): Promise<PatientDto> {
    return toPatientDto(await this.findInClinic(clinicId, id));
  }

  async create(clinicId: string, dto: CreatePatientDto): Promise<PatientDto> {
    const phone = this.parsePhone(dto.phone);
    await this.assertPhoneFree(clinicId, phone);
    const optIn = dto.whatsappOptIn ?? false;
    const patient = this.patients.create({
      clinicId,
      fullName: dto.fullName.trim(),
      phoneE164: phone,
      whatsappOptIn: optIn,
      optInAt: optIn ? new Date() : null,
      notes: dto.notes?.trim() || null,
    });
    return toPatientDto(await this.patients.save(patient));
  }

  async update(clinicId: string, id: string, dto: UpdatePatientDto): Promise<PatientDto> {
    const patient = await this.findInClinic(clinicId, id);
    if (dto.fullName !== undefined) patient.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) {
      const phone = this.parsePhone(dto.phone);
      await this.assertPhoneFree(clinicId, phone, patient.id);
      patient.phoneE164 = phone;
    }
    if (dto.whatsappOptIn !== undefined && dto.whatsappOptIn !== patient.whatsappOptIn) {
      patient.whatsappOptIn = dto.whatsappOptIn;
      patient.optInAt = dto.whatsappOptIn ? new Date() : null;
    }
    if (dto.notes !== undefined) patient.notes = dto.notes.trim() || null;
    return toPatientDto(await this.patients.save(patient));
  }

  async findInClinic(clinicId: string, id: string): Promise<Patient> {
    const patient = await this.patients.findOne({ where: { id, clinicId } });
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    return patient;
  }

  private parsePhone(input: string): string {
    const phone = normalizePhone(input);
    if (!phone) throw new BadRequestException('Teléfono inválido');
    return phone;
  }

  private async assertPhoneFree(clinicId: string, phone: string, exceptId?: string): Promise<void> {
    const taken = await this.patients.findOne({
      where: { clinicId, phoneE164: phone, ...(exceptId ? { id: Not(exceptId) } : {}) },
    });
    if (taken) throw new ConflictException('Ya existe un paciente con ese teléfono');
  }
}
