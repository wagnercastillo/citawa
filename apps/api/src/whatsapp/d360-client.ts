import { Injectable } from '@nestjs/common';

export interface D360Credentials {
  apiKey: string;
  sandbox: boolean;
}

export class D360Error extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }

  /** 0 = sin conexión. 429 y 5xx son transitorios; el resto (400, 401…) no se reintenta. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export function d360Urls(sandbox: boolean): { messages: string; webhook: string } {
  const host = sandbox ? 'https://waba-sandbox.360dialog.io' : 'https://waba-v2.360dialog.io';
  return { messages: sandbox ? `${host}/v1/messages` : `${host}/messages`, webhook: `${host}/v1/configs/webhook` };
}

@Injectable()
export class D360Client {
  async send(creds: D360Credentials, payload: object): Promise<{ waMessageId: string }> {
    const body = (await this.post(creds, d360Urls(creds.sandbox).messages, payload)) as { messages?: { id?: string }[] };
    const id = body.messages?.[0]?.id;
    if (!id) throw new D360Error(502, 'Respuesta de 360dialog sin id de mensaje');
    return { waMessageId: id };
  }

  async setWebhook(creds: D360Credentials, url: string): Promise<void> {
    await this.post(creds, d360Urls(creds.sandbox).webhook, { url });
  }

  private async post(creds: D360Credentials, url: string, payload: object): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'D360-API-KEY': creds.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new D360Error(0, `No se pudo conectar con 360dialog: ${(e as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; meta?: { developer_message?: string } };
    if (!res.ok) throw new D360Error(res.status, body.error?.message ?? body.meta?.developer_message ?? `HTTP ${res.status}`);
    return body;
  }
}
