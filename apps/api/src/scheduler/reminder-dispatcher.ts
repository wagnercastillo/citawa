import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Appointment, AppointmentStatus } from '../appointments/appointment.entity';
import { Clinic, SubscriptionStatus } from '../clinics/clinic.entity';
import { Clock } from '../common/clock';
import { firstName, fmtDateEs, fmtTimeEs } from '../common/format-es';
import { D360Client, D360Error } from '../whatsapp/d360-client';
import { reminder24h, reminder2h } from '../whatsapp/message-builders';
import { MessagesService } from '../whatsapp/messages.service';
import { WaAccountStatus, WhatsappAccount } from '../whatsapp/whatsapp-account.entity';
import { WhatsappAccountsService } from '../whatsapp/whatsapp-accounts.service';
import { ScheduledKind, ScheduledMessage, ScheduledStatus } from './scheduled-message.entity';

const MAX_ATTEMPTS = 3;
const BACKOFF_MIN = [5, 15];
const BATCH = 50;
const STALE_MS = 10 * 60_000;

interface Context {
  clinic: Clinic;
  appt: Appointment | null;
  account: WhatsappAccount | null;
}

/** TypeORM devuelve [filas, n] para UPDATE … RETURNING en Postgres. */
const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) && Array.isArray(res[0]) ? (res[0] as T[]) : (res as T[]));

@Injectable()
export class ReminderDispatcher implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReminderDispatcher.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: Clock,
    private readonly d360: D360Client,
    private readonly accounts: WhatsappAccountsService,
    private readonly messages: MessagesService,
  ) {}

  private get enabled(): boolean {
    return process.env.SCHEDULER_ENABLED !== 'false';
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.enabled) await this.recoverStale();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.runOnce();
    } catch (e) {
      this.logger.error(e);
    }
  }

  async recoverStale(): Promise<number> {
    const res = await this.ds.query(
      `UPDATE scheduled_messages SET status = 'PENDING', updated_at = now()
       WHERE status = 'SENDING' AND updated_at < $1 RETURNING id`,
      [new Date(this.clock.now().getTime() - STALE_MS)],
    );
    return rowsOf(res).length;
  }

  async runOnce(): Promise<number> {
    const res = await this.ds.query(
      `UPDATE scheduled_messages SET status = 'SENDING', updated_at = now()
       WHERE id IN (
         SELECT id FROM scheduled_messages WHERE status = 'PENDING' AND send_at <= $1
         ORDER BY send_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
       ) RETURNING id`,
      [this.clock.now()],
    );
    const ids = rowsOf<{ id: string }>(res).map((r) => r.id);
    for (const id of ids) await this.process(id);
    return ids.length;
  }

  private async process(id: string): Promise<void> {
    const sm = await this.ds.getRepository(ScheduledMessage).findOneByOrFail({ id });
    const ctx = await this.loadContext(sm);
    const reason = this.skipReason(sm, ctx);
    if (reason) {
      await this.ds.getRepository(ScheduledMessage).update({ id }, { status: ScheduledStatus.CANCELLED, cancelReason: reason });
      return;
    }
    try {
      const creds = this.accounts.credentials(ctx.account!);
      const payload = this.buildPayload(sm, ctx, creds.sandbox);
      const { waMessageId } = await this.d360.send(creds, payload);
      await this.ds.transaction(async (m) => {
        await m.update(ScheduledMessage, { id }, { status: ScheduledStatus.SENT, lastError: null });
        await this.messages.recordOutbound(
          { clinicId: sm.clinicId, patientId: ctx.appt?.patientId ?? null, waMessageId, type: 'template', payload, scheduledMessageId: id },
          m,
        );
      });
    } catch (e) {
      await this.fail(sm, e);
    }
  }

  private async loadContext(sm: ScheduledMessage): Promise<Context> {
    const clinic = await this.ds.getRepository(Clinic).findOneByOrFail({ id: sm.clinicId });
    const appt = sm.appointmentId
      ? await this.ds.getRepository(Appointment).findOne({ where: { id: sm.appointmentId }, relations: { patient: true, service: true } })
      : null;
    return { clinic, appt, account: await this.accounts.forClinic(sm.clinicId) };
  }

  private skipReason(sm: ScheduledMessage, { clinic, appt, account }: Context): string | null {
    if (clinic.subscriptionStatus === SubscriptionStatus.SUSPENDED) return 'Suscripción suspendida';
    if (!account || account.status !== WaAccountStatus.CONNECTED) return 'WhatsApp no conectado';
    if (sm.kind === ScheduledKind.PAYMENT_REMINDER) return 'Recordatorio de pago no disponible todavía';
    if (!appt || appt.isBlock || !appt.patient || ![AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED].includes(appt.status)) {
      return 'Cita no vigente';
    }
    if (!appt.patient.whatsappOptIn) return 'Paciente sin consentimiento';
    if (sm.kind === ScheduledKind.REMINDER_2H && appt.status === AppointmentStatus.CONFIRMED && !clinic.send2hToConfirmed) {
      return 'Ya confirmó';
    }
    return null;
  }

  private buildPayload(sm: ScheduledMessage, { clinic, appt }: Context, sandbox: boolean): object {
    const a = appt!;
    const common = { to: a.patient!.phoneE164, patientName: firstName(a.patient!.fullName), appointmentId: a.id, sandbox };
    const timeText = fmtTimeEs(a.startsAt, clinic.timezone);
    if (sm.kind === ScheduledKind.REMINDER_24H) {
      return reminder24h({ ...common, clinicName: clinic.name, dateText: fmtDateEs(a.startsAt, clinic.timezone), timeText });
    }
    return reminder2h({ ...common, timeText, place: clinic.address ?? clinic.name });
  }

  private async fail(sm: ScheduledMessage, e: unknown): Promise<void> {
    const attempts = sm.attempts + 1;
    const message = (e as Error).message ?? String(e);
    const unauthorized = e instanceof D360Error && e.status === 401;
    if (unauthorized) await this.accounts.markError(sm.clinicId, message);
    const retryable = !(e instanceof D360Error) || e.retryable;
    const repo = this.ds.getRepository(ScheduledMessage);
    if (retryable && !unauthorized && attempts < MAX_ATTEMPTS) {
      const sendAt = new Date(this.clock.now().getTime() + BACKOFF_MIN[attempts - 1] * 60_000);
      await repo.update({ id: sm.id }, { status: ScheduledStatus.PENDING, attempts, lastError: message, sendAt });
    } else {
      await repo.update({ id: sm.id }, { status: ScheduledStatus.FAILED, attempts, lastError: message });
    }
  }
}
