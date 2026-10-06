import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Message, MessageDirection, MessageStatus } from './message.entity';

@Injectable()
export class MessagesService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async recordOutbound(
    data: {
      clinicId: string;
      patientId: string | null;
      waMessageId: string;
      type: string;
      payload: object;
      scheduledMessageId?: string | null;
    },
    m: EntityManager = this.ds.manager,
  ): Promise<void> {
    await m.save(
      m.create(Message, {
        clinicId: data.clinicId,
        patientId: data.patientId,
        direction: MessageDirection.OUT,
        waMessageId: data.waMessageId,
        type: data.type,
        payload: data.payload as Record<string, unknown>,
        status: MessageStatus.SENT,
        scheduledMessageId: data.scheduledMessageId ?? null,
      }),
    );
  }

  /** Guarda un mensaje entrante. Devuelve false si ese wa_message_id ya se había procesado. */
  async recordInbound(data: { clinicId: string; patientId: string | null; waMessageId: string; type: string; payload: object }): Promise<boolean> {
    const res = await this.ds.query(
      `INSERT INTO messages (clinic_id, patient_id, direction, wa_message_id, type, payload)
       VALUES ($1, $2, 'IN', $3, $4, $5) ON CONFLICT (wa_message_id) DO NOTHING RETURNING id`,
      [data.clinicId, data.patientId, data.waMessageId, data.type, JSON.stringify(data.payload)],
    );
    return res.length > 0;
  }

  /** SENT → DELIVERED → READ solo avanzan; FAILED se aplica siempre. */
  async updateStatus(waMessageId: string, status: MessageStatus): Promise<void> {
    await this.ds.query(
      `UPDATE messages SET status = $2::message_status, updated_at = now()
       WHERE wa_message_id = $1 AND direction = 'OUT' AND (
         $2::message_status = 'FAILED' OR status IS NULL OR
         array_position(ARRAY['SENT','DELIVERED','READ']::message_status[], status) <
         array_position(ARRAY['SENT','DELIVERED','READ']::message_status[], $2::message_status)
       )`,
      [waMessageId, status],
    );
  }
}
