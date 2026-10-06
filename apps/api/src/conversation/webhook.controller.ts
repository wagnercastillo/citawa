import { Body, Controller, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { MessageStatus } from '../whatsapp/message.entity';
import { MessagesService } from '../whatsapp/messages.service';
import { parseWebhook } from '../whatsapp/parse-webhook';
import { WhatsappAccountsService } from '../whatsapp/whatsapp-accounts.service';
import { ConversationService } from './conversation.service';

@Public()
@Controller('webhooks/wa')
export class WebhookController {
  constructor(
    private readonly accounts: WhatsappAccountsService,
    private readonly messages: MessagesService,
    private readonly conversation: ConversationService,
  ) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post(':token')
  @HttpCode(200)
  async receive(@Param('token') token: string, @Body() body: unknown): Promise<{ ok: true }> {
    const account = await this.accounts.findByWebhookToken(token);
    if (!account) throw new NotFoundException();
    const { messages, statuses } = parseWebhook(body);
    for (const s of statuses) await this.messages.updateStatus(s.waId, s.status as MessageStatus);
    for (const m of messages) await this.conversation.handle(account, m);
    return { ok: true };
  }
}
