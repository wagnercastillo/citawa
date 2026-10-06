import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/session';
import { ClinicSettingsService } from '../clinics/clinic-settings.service';
import { addDays, daysBetween, zonedToUtc } from '../common/zoned-time';
import { PatientsService } from '../patients/patients.service';
import { ReminderScheduler } from '../scheduler/reminder-scheduler';
import { Service } from '../services/service.entity';
import { ServicesService } from '../services/services.service';
import { AppointmentEvent, AppointmentEventType, EventSource } from './appointment-event.entity';
import { canTransition } from './appointment-status';
import { Appointment, AppointmentStatus } from './appointment.entity';
import { CreateAppointmentDto, CreateBlockDto, SetStatusDto, UpdateAppointmentDto } from './appointments.dto';

export interface AppointmentDto {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  isBlock: boolean;
  patient: { id: string; fullName: string; phone: string } | null;
  service: { id: string; name: string; durationMin: number } | null;
}

/** Quién hace el cambio: un usuario del panel o el paciente por WhatsApp. */
export interface Actor {
  userId: string | null;
  source: EventSource;
}

export const panelActor = (user: AuthUser): Actor => ({ userId: user.id, source: EventSource.PANEL });
export const WHATSAPP_ACTOR: Actor = { userId: null, source: EventSource.WHATSAPP };

const toDto = (a: Appointment): AppointmentDto => ({
  id: a.id,
  startsAt: a.startsAt.toISOString(),
  endsAt: a.endsAt.toISOString(),
  status: a.status,
  isBlock: a.isBlock,
  patient: a.patient ? { id: a.patient.id, fullName: a.patient.fullName, phone: a.patient.phoneE164 } : null,
  service: a.service ? { id: a.service.id, name: a.service.name, durationMin: a.service.durationMin } : null,
});

const MAX_RANGE_DAYS = 31;
const STALE_MSG = 'La cita cambió mientras la editabas; recarga la agenda e inténtalo de nuevo';
const ACTIVE = [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED];

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: ClinicSettingsService,
    private readonly services: ServicesService,
    private readonly patients: PatientsService,
    private readonly reminders: ReminderScheduler,
  ) {}

  async list(clinicId: string, from: string, to: string): Promise<AppointmentDto[]> {
    const span = daysBetween(from, to);
    if (span < 0) throw new BadRequestException('La fecha "hasta" debe ser igual o posterior a "desde"');
    if (span > MAX_RANGE_DAYS) throw new BadRequestException(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
    const tz = await this.settings.getTimezone(clinicId);
    const start = zonedToUtc(from, '00:00', tz);
    const end = zonedToUtc(addDays(to, 1), '00:00', tz);
    const rows = await this.ds.getRepository(Appointment).find({
      where: { clinicId, startsAt: Between(start, new Date(end.getTime() - 1)) },
      relations: { patient: true, service: true },
      order: { startsAt: 'ASC' },
    });
    // Un bloqueo quitado no aporta nada en la agenda; las citas canceladas sí se muestran (tachadas).
    return rows.filter((a) => !(a.isBlock && a.status === AppointmentStatus.CANCELLED)).map(toDto);
  }

  async forPatient(clinicId: string, patientId: string): Promise<AppointmentDto[]> {
    await this.patients.findInClinic(clinicId, patientId);
    const rows = await this.ds.getRepository(Appointment).find({
      where: { clinicId, patientId },
      relations: { patient: true, service: true },
      order: { startsAt: 'DESC' },
      take: 100,
    });
    return rows.map(toDto);
  }

  findWithRelations(clinicId: string, id: string): Promise<Appointment | null> {
    return this.ds.getRepository(Appointment).findOne({ where: { id, clinicId }, relations: { patient: true, service: true } });
  }

  async create(user: AuthUser, dto: CreateAppointmentDto): Promise<AppointmentDto> {
    const clinicId = user.clinicId!;
    await this.patients.findInClinic(clinicId, dto.patientId);
    const service = await this.services.findInClinic(clinicId, dto.serviceId);
    if (!service.active) throw new BadRequestException('El servicio está desactivado');
    const startsAt = zonedToUtc(dto.date, dto.time, await this.settings.getTimezone(clinicId));
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
    const id = await this.ds.transaction(async (m) => {
      const appt = await m.save(
        m.create(Appointment, {
          clinicId, patientId: dto.patientId, serviceId: service.id, startsAt, endsAt, createdBy: user.id, calendarDirty: true,
        }),
      );
      await this.logEvent(m, appt, panelActor(user), AppointmentEventType.CREATED);
      await this.reminders.sync(m, appt.id);
      return appt.id;
    });
    return this.getDto(clinicId, id);
  }

  async createBlock(user: AuthUser, dto: CreateBlockDto): Promise<AppointmentDto> {
    if (dto.endTime <= dto.time) throw new BadRequestException('La hora de fin debe ser posterior a la de inicio');
    const clinicId = user.clinicId!;
    const tz = await this.settings.getTimezone(clinicId);
    const id = await this.ds.transaction(async (m) => {
      const appt = await m.save(
        m.create(Appointment, {
          clinicId,
          isBlock: true,
          patientId: null,
          serviceId: null,
          startsAt: zonedToUtc(dto.date, dto.time, tz),
          endsAt: zonedToUtc(dto.date, dto.endTime, tz),
          createdBy: user.id,
          calendarDirty: true,
        }),
      );
      await this.logEvent(m, appt, panelActor(user), AppointmentEventType.CREATED, { block: true });
      return appt.id;
    });
    return this.getDto(clinicId, id);
  }

  async update(user: AuthUser, id: string, dto: UpdateAppointmentDto): Promise<AppointmentDto> {
    const clinicId = user.clinicId!;
    const appt = await this.findEditable(clinicId, id);
    const service = await this.services.findInClinic(clinicId, dto.serviceId);
    if (!service.active && service.id !== appt.serviceId) throw new BadRequestException('El servicio está desactivado');
    const startsAt = zonedToUtc(dto.date, dto.time, await this.settings.getTimezone(clinicId));
    return this.applyMove(clinicId, panelActor(user), appt, startsAt, service);
  }

  /** Mueve la cita a `startsAt` manteniendo su servicio (usado por la reprogramación por WhatsApp). */
  async reschedule(clinicId: string, actor: Actor, id: string, startsAt: Date): Promise<AppointmentDto> {
    const appt = await this.findEditable(clinicId, id);
    const service = await this.services.findInClinic(clinicId, appt.serviceId!);
    return this.applyMove(clinicId, actor, appt, startsAt, service);
  }

  setStatus(user: AuthUser, id: string, dto: SetStatusDto): Promise<AppointmentDto> {
    return this.changeStatus(user.clinicId!, panelActor(user), id, dto.status as AppointmentStatus);
  }

  async changeStatus(clinicId: string, actor: Actor, id: string, to: AppointmentStatus): Promise<AppointmentDto> {
    const appt = await this.findInClinic(clinicId, id);
    if (!canTransition(appt.status, to, appt.isBlock)) {
      throw new BadRequestException(`No se puede pasar de ${appt.status} a ${to}`);
    }
    await this.ds.transaction(async (m) => {
      // Condicionado al estado leído: si otro usuario (o el webhook) lo cambió entretanto, no se pisa.
      const result = await m.update(Appointment, { id, clinicId, status: appt.status }, { status: to, calendarDirty: true });
      if (!result.affected) throw new ConflictException(STALE_MSG);
      await this.logEvent(m, appt, actor, to as unknown as AppointmentEventType, { from: appt.status });
      await this.reminders.sync(m, id);
    });
    return this.getDto(clinicId, id);
  }

  private async applyMove(clinicId: string, actor: Actor, appt: Appointment, startsAt: Date, service: Service): Promise<AppointmentDto> {
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
    const moved = startsAt.getTime() !== appt.startsAt.getTime();
    const before = { startsAt: appt.startsAt.toISOString(), serviceId: appt.serviceId };
    await this.ds.transaction(async (m) => {
      const result = await m.update(Appointment, { id: appt.id, clinicId, status: appt.status }, {
        startsAt,
        endsAt,
        serviceId: service.id,
        status: moved ? AppointmentStatus.SCHEDULED : appt.status,
        calendarDirty: true,
      });
      if (!result.affected) throw new ConflictException(STALE_MSG);
      await this.logEvent(m, appt, actor, moved ? AppointmentEventType.RESCHEDULED : AppointmentEventType.UPDATED, {
        from: before,
        to: { startsAt: startsAt.toISOString(), serviceId: service.id },
      });
      await this.reminders.sync(m, appt.id);
    });
    return this.getDto(clinicId, appt.id);
  }

  private async findEditable(clinicId: string, id: string): Promise<Appointment> {
    const appt = await this.findInClinic(clinicId, id);
    if (appt.isBlock) throw new BadRequestException('Los bloqueos no se editan; elimínalo y crea otro');
    if (!ACTIVE.includes(appt.status)) throw new BadRequestException('Solo se pueden editar citas programadas o confirmadas');
    return appt;
  }

  private async findInClinic(clinicId: string, id: string): Promise<Appointment> {
    const appt = await this.ds.getRepository(Appointment).findOne({ where: { id, clinicId } });
    if (!appt) throw new NotFoundException('Cita no encontrada');
    return appt;
  }

  private async getDto(clinicId: string, id: string): Promise<AppointmentDto> {
    const appt = await this.ds.getRepository(Appointment).findOneOrFail({
      where: { id, clinicId },
      relations: { patient: true, service: true },
    });
    return toDto(appt);
  }

  private async logEvent(
    m: EntityManager,
    appt: Appointment,
    actor: Actor,
    type: AppointmentEventType,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await m.save(
      m.create(AppointmentEvent, {
        appointmentId: appt.id, clinicId: appt.clinicId, type, source: actor.source, actorUserId: actor.userId, data,
      }),
    );
  }
}
