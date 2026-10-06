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

  reset(): void {
    this.sent = [];
    this.webhooks = [];
    this.sendErrors = [];
    this.webhookError = null;
  }
}
