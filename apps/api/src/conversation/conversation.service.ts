import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThan, MoreThan, Not } from 'typeorm';
import { canTransition } from '../appointments/appointment-status';
import { Appointment, AppointmentStatus } from '../appointments/appointment.entity';
import { AppointmentsService, WHATSAPP_ACTOR } from '../appointments/appointments.service';
import { freeSlots } from '../appointments/free-slots';
import { ClinicSettings, ClinicSettingsService } from '../clinics/clinic-settings.service';
import { Clock } from '../common/clock';
import { fmtDateEs, fmtSlotLabel, fmtTimeEs } from '../common/format-es';
import { addDays, localParts } from '../common/zoned-time';
import { Patient } from '../patients/patient.entity';
import { D360Client } from '../whatsapp/d360-client';
import { slotList, textMessage } from '../whatsapp/message-builders';
import { MessagesService } from '../whatsapp/messages.service';
import { InboundMessage } from '../whatsapp/parse-webhook';
import { WhatsappAccount } from '../whatsapp/whatsapp-account.entity';
import { WhatsappAccountsService } from '../whatsapp/whatsapp-accounts.service';

const PAYLOAD_RE = /^(CONFIRM|CANCEL|RESCHEDULE|PICK):([0-9a-f-]{36})(?::(.+))?$/;
const SLOT_DAYS = 7;
const SLOT_LIMIT = 10;
const INACTIVE_MSG = 'Esta cita ya no está activa. Si necesitas una nueva, escríbenos.';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly appointments: AppointmentsService,
    private readonly settings: ClinicSettingsService,
    private readonly accounts: WhatsappAccountsService,
    private readonly messages: MessagesService,
    private readonly d360: D360Client,
    private readonly clock: Clock,
  ) {}

  async handle(account: WhatsappAccount, msg: InboundMessage): Promise<void> {
    const patient = await this.ds.getRepository(Patient).findOneBy({ clinicId: account.clinicId, phoneE164: `+${msg.from}` });
    const isNew = await this.messages.recordInbound({
      clinicId: account.clinicId,
      patientId: patient?.id ?? null,
      waMessageId: msg.waId,
      type: msg.type,
      payload: { text: msg.text, payload: msg.payload },
    });
    if (!isNew || !msg.payload || !patient) return;

    const match = PAYLOAD_RE.exec(msg.payload);
    if (!match) return;
    const [, action, apptId, iso] = match;
    const appt = await this.appointments.findWithRelations(account.clinicId, apptId);
    if (!appt || appt.isBlock || appt.patientId !== patient.id) return; // otro consultorio u otro paciente: se ignora

    const clinic = await this.settings.get(account.clinicId);
    const send = (payload: object) => this.reply(account, patient.id, payload);
    const active = appt.status === AppointmentStatus.SCHEDULED || appt.status === AppointmentStatus.CONFIRMED;
    if (!active) return send(textMessage(patient.phoneE164, INACTIVE_MSG));

    if (action === 'CONFIRM') {
      if (canTransition(appt.status, AppointmentStatus.CONFIRMED, false)) {
        await this.appointments.changeStatus(account.clinicId, WHATSAPP_ACTOR, appt.id, AppointmentStatus.CONFIRMED);
      }
      return send(textMessage(patient.phoneE164, `✅ ¡Confirmado! Te esperamos el ${this.when(appt.startsAt, clinic)}.`));
    }
    if (action === 'CANCEL') {
      await this.appointments.changeStatus(account.clinicId, WHATSAPP_ACTOR, appt.id, AppointmentStatus.CANCELLED);
      return send(textMessage(patient.phoneE164, 'Tu cita fue cancelada. Si quieres agendar otra, escríbenos.'));
    }
    if (action === 'RESCHEDULE') return this.offerSlots(account, patient, appt, clinic, 'Elige un nuevo horario:');

    // PICK: solo se acepta un horario que siga libre y dentro del horario de atención.
    const slots = await this.slotsFor(appt, clinic);
    if (!iso || !slots.some((s) => s.toISOString() === iso)) {
      return this.offerSlots(account, patient, appt, clinic, 'Ese horario ya no está disponible. Elige otro:', slots);
    }
    try {
      const moved = await this.appointments.reschedule(account.clinicId, WHATSAPP_ACTOR, appt.id, new Date(iso));
      return send(textMessage(patient.phoneE164, `📅 Listo, tu cita quedó para el ${this.when(new Date(moved.startsAt), clinic)}.`));
    } catch (e) {
      if (e instanceof ConflictException) {
        return this.offerSlots(account, patient, appt, clinic, 'Ese horario se acaba de ocupar. Elige otro:');
      }
      throw e;
    }
  }

  private when(instant: Date, clinic: ClinicSettings): string {
    return `${fmtDateEs(instant, clinic.timezone)} a las ${fmtTimeEs(instant, clinic.timezone)}`;
  }

  private async slotsFor(appt: Appointment, clinic: ClinicSettings): Promise<Date[]> {
    const fromDate = addDays(localParts(this.clock.now(), clinic.timezone).date, 1);
    const windowStart = new Date(`${fromDate}T00:00:00Z`).getTime() - 24 * 3_600_000;
    const windowEnd = new Date(`${addDays(fromDate, SLOT_DAYS)}T00:00:00Z`).getTime() + 24 * 3_600_000;
    const busy = await this.ds.getRepository(Appointment).find({
      where: {
        clinicId: appt.clinicId,
        id: Not(appt.id),
        status: Not(AppointmentStatus.CANCELLED),
        startsAt: LessThan(new Date(windowEnd)),
        endsAt: MoreThan(new Date(windowStart)),
      },
    });
    return freeSlots({
      hours: await this.settings.hours(appt.clinicId),
      busy: busy.map((b) => ({ start: b.startsAt, end: b.endsAt })),
      durationMin: appt.service!.durationMin,
      timeZone: clinic.timezone,
      fromDate,
      days: SLOT_DAYS,
      limit: SLOT_LIMIT,
    });
  }

  private async offerSlots(
    account: WhatsappAccount,
    patient: Patient,
    appt: Appointment,
    clinic: ClinicSettings,
    intro: string,
    precomputed?: Date[],
  ): Promise<void> {
    const slots = precomputed ?? (await this.slotsFor(appt, clinic));
    if (!slots.length) {
      return this.reply(account, patient.id, textMessage(patient.phoneE164, 'No encontramos horarios libres en los próximos 7 días; escríbenos para coordinar.'));
    }
    const list = slotList({
      to: patient.phoneE164,
      appointmentId: appt.id,
      intro,
      slots: slots.map((s) => ({ iso: s.toISOString(), label: fmtSlotLabel(s, clinic.timezone) })),
    });
    return this.reply(account, patient.id, list);
  }

  private async reply(account: WhatsappAccount, patientId: string, payload: object): Promise<void> {
    try {
      const { waMessageId } = await this.d360.send(this.accounts.credentials(account), payload);
      await this.messages.recordOutbound({
        clinicId: account.clinicId,
        patientId,
        waMessageId,
        type: (payload as { type: string }).type,
        payload,
      });
    } catch (e) {
      this.logger.warn(`No se pudo responder por WhatsApp: ${(e as Error).message}`);
    }
  }
}
