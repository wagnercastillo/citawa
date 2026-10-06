import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Appointment, AppointmentStatus } from '../appointments/appointment.entity';
import { Clock } from '../common/clock';
import { ScheduledKind } from './scheduled-message.entity';

const REMINDERS: [ScheduledKind, number][] = [
  [ScheduledKind.REMINDER_24H, 24 * 60 * 60_000],
  [ScheduledKind.REMINDER_2H, 2 * 60 * 60_000],
];

/**
 * Mantiene `scheduled_messages` al día con el estado de la cita. Se llama dentro de la transacción
 * que modifica la cita. Un recordatorio ya enviado solo se re-programa si cambia su hora de envío.
 */
@Injectable()
export class ReminderScheduler {
  constructor(private readonly clock: Clock) {}

  async sync(m: EntityManager, appointmentId: string): Promise<void> {
    const appt = await m.findOneByOrFail(Appointment, { id: appointmentId });
    const active = !appt.isBlock && (appt.status === AppointmentStatus.SCHEDULED || appt.status === AppointmentStatus.CONFIRMED);
    if (!active) {
      await m.query(
        `UPDATE scheduled_messages SET status = 'CANCELLED', cancel_reason = $2, updated_at = now()
         WHERE appointment_id = $1 AND status = 'PENDING'`,
        [appt.id, `Cita ${appt.status}`],
      );
      return;
    }
    const now = this.clock.now().getTime();
    for (const [kind, offsetMs] of REMINDERS) {
      const sendAt = new Date(appt.startsAt.getTime() - offsetMs);
      if (sendAt.getTime() <= now) {
        await m.query(
          `UPDATE scheduled_messages SET status = 'CANCELLED', cancel_reason = 'La hora de envío ya pasó', updated_at = now()
           WHERE appointment_id = $1 AND kind = $2 AND status = 'PENDING'`,
          [appt.id, kind],
        );
        continue;
      }
      await m.query(
        `INSERT INTO scheduled_messages (clinic_id, kind, appointment_id, send_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (appointment_id, kind) WHERE appointment_id IS NOT NULL DO UPDATE
           SET send_at = EXCLUDED.send_at, status = 'PENDING', attempts = 0, last_error = NULL, cancel_reason = NULL, updated_at = now()
           WHERE scheduled_messages.send_at IS DISTINCT FROM EXCLUDED.send_at AND scheduled_messages.status <> 'SENDING'`,
        [appt.clinicId, kind, appt.id, sendAt],
      );
    }
  }
}
