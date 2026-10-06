import { Clock } from '../src/common/clock';
import { D360Credentials, D360Error } from '../src/whatsapp/d360-client';

export class FakeClock extends Clock {
  private t: Date;

  constructor(iso: string) {
    super();
    this.t = new Date(iso);
  }

  now(): Date {
    return new Date(this.t);
  }

  set(iso: string): void {
    this.t = new Date(iso);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPayload = any;

export class FakeD360 {
  sent: { creds: D360Credentials; payload: AnyPayload }[] = [];
  webhooks: { creds: D360Credentials; url: string }[] = [];
  sendErrors: D360Error[] = [];
  webhookError: Error | null = null;
  templatesCreated: { creds: D360Credentials; payload: AnyPayload }[] = [];
  templateList: { name: string; status: string; rejected_reason?: string | null }[] = [];
  channelKeys: { partner: { partnerId: string; apiKey: string }; channelId: string }[] = [];
  partnerError: Error | null = null;
  templateCreateError: Error | null = null;
  listError: Error | null = null;
  private seq = 0;

  async send(creds: D360Credentials, payload: AnyPayload): Promise<{ waMessageId: string }> {
    const err = this.sendErrors.shift();
    if (err) throw err;
    this.sent.push({ creds, payload });
    this.seq += 1;
    return { waMessageId: `wamid.fake.${this.seq}.${Math.random().toString(36).slice(2)}` };
  }

  async setWebhook(creds: D360Credentials, url: string): Promise<void> {
    if (this.webhookError) throw this.webhookError;
    this.webhooks.push({ creds, url });
  }

  async createTemplate(creds: D360Credentials, payload: AnyPayload): Promise<void> {
    if (this.templateCreateError) throw this.templateCreateError;
    this.templatesCreated.push({ creds, payload });
    if (!this.templateList.some((t) => t.name === payload.name)) this.templateList.push({ name: payload.name, status: 'submitted' });
  }

  async listTemplates(): Promise<{ name: string; status: string; rejected_reason?: string | null }[]> {
    if (this.listError) throw this.listError;
    return this.templateList;
  }

  async createChannelApiKey(partner: { partnerId: string; apiKey: string }, channelId: string): Promise<{ apiKey: string; address: string }> {
    if (this.partnerError) throw this.partnerError;
    this.channelKeys.push({ partner, channelId });
    return { apiKey: `key-${channelId}`, address: '51987654321' };
  }

  reset(): void {
    this.sent = [];
    this.webhooks = [];
    this.sendErrors = [];
    this.webhookError = null;
    this.templatesCreated = [];
    this.templateList = [];
    this.channelKeys = [];
    this.partnerError = null;
    this.templateCreateError = null;
    this.listError = null;
  }
}
