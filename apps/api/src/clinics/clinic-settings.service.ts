import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BusinessHour } from './business-hour.entity';
import { Clinic, SubscriptionStatus } from './clinic.entity';
import { HourDto, UpdateClinicSettingsDto } from './clinic-settings.dto';

export interface ClinicSettings {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  paymentInstructions: string | null;
  send2hToConfirmed: boolean;
  subscriptionStatus: SubscriptionStatus;
  paidUntil: string | null;
}

const toSettings = (c: Clinic): ClinicSettings => ({
  id: c.id,
  name: c.name,
  address: c.address,
  timezone: c.timezone,
  paymentInstructions: c.paymentInstructions,
  send2hToConfirmed: c.send2hToConfirmed,
  subscriptionStatus: c.subscriptionStatus,
  paidUntil: c.paidUntil,
});

const toHourDto = (h: BusinessHour): HourDto => ({
  weekday: h.weekday,
  opensAt: h.opensAt.slice(0, 5),
  closesAt: h.closesAt.slice(0, 5),
});

const emptyToNull = (v: string | undefined): string | null | undefined => (v === undefined ? undefined : v.trim() || null);

@Injectable()
export class ClinicSettingsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async get(clinicId: string): Promise<ClinicSettings> {
    return toSettings(await this.ds.getRepository(Clinic).findOneByOrFail({ id: clinicId }));
  }

  async getTimezone(clinicId: string): Promise<string> {
    return (await this.ds.getRepository(Clinic).findOneByOrFail({ id: clinicId })).timezone;
  }

  async update(clinicId: string, dto: UpdateClinicSettingsDto): Promise<ClinicSettings> {
    const repo = this.ds.getRepository(Clinic);
    const clinic = await repo.findOneByOrFail({ id: clinicId });
    if (dto.name !== undefined) clinic.name = dto.name;
    const address = emptyToNull(dto.address);
    if (address !== undefined) clinic.address = address;
    const payment = emptyToNull(dto.paymentInstructions);
    if (payment !== undefined) clinic.paymentInstructions = payment;
    if (dto.send2hToConfirmed !== undefined) clinic.send2hToConfirmed = dto.send2hToConfirmed;
    return toSettings(await repo.save(clinic));
  }

  async hours(clinicId: string): Promise<HourDto[]> {
    const rows = await this.ds
      .getRepository(BusinessHour)
      .find({ where: { clinicId }, order: { weekday: 'ASC', opensAt: 'ASC' } });
    return rows.map(toHourDto);
  }

  async replaceHours(clinicId: string, hours: HourDto[]): Promise<HourDto[]> {
    const sorted = [...hours].sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt));
    sorted.forEach((h, i) => {
      if (h.opensAt >= h.closesAt) throw new BadRequestException('La hora de apertura debe ser menor que la de cierre');
      const prev = sorted[i - 1];
      if (prev && prev.weekday === h.weekday && h.opensAt < prev.closesAt) {
        throw new BadRequestException('Hay horarios que se cruzan el mismo día');
      }
    });
    await this.ds.transaction(async (m) => {
      await m.delete(BusinessHour, { clinicId });
      await m.save(sorted.map((h) => m.create(BusinessHour, { clinicId, ...h })));
    });
    return this.hours(clinicId);
  }
}
