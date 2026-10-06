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
}
