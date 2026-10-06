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

const PARTNER_API = 'https://hub.360dialog.io/api/v2';

export function d360Urls(sandbox: boolean): { messages: string; webhook: string; templates: string } {
  const host = sandbox ? 'https://waba-sandbox.360dialog.io' : 'https://waba-v2.360dialog.io';
  return {
    messages: sandbox ? `${host}/v1/messages` : `${host}/messages`,
    webhook: `${host}/v1/configs/webhook`,
    templates: `${host}/v1/configs/templates`,
  };
}

export interface PartnerCredentials {
  partnerId: string;
  apiKey: string;
}

@Injectable()
export class D360Client {
  async send(creds: D360Credentials, payload: object): Promise<{ waMessageId: string }> {
    const body = (await this.request('POST', d360Urls(creds.sandbox).messages, { 'D360-API-KEY': creds.apiKey }, payload)) as {
      messages?: { id?: string }[];
    };
    const id = body.messages?.[0]?.id;
    if (!id) throw new D360Error(502, 'Respuesta de 360dialog sin id de mensaje');
    return { waMessageId: id };
  }

  async setWebhook(creds: D360Credentials, url: string): Promise<void> {
    await this.request('POST', d360Urls(creds.sandbox).webhook, { 'D360-API-KEY': creds.apiKey }, { url });
  }

  async createTemplate(creds: D360Credentials, payload: object): Promise<void> {
    await this.request('POST', d360Urls(creds.sandbox).templates, { 'D360-API-KEY': creds.apiKey }, payload);
  }

  async listTemplates(creds: D360Credentials): Promise<{ name: string; status: string; rejected_reason?: string | null }[]> {
    const body = (await this.request('GET', d360Urls(creds.sandbox).templates, { 'D360-API-KEY': creds.apiKey })) as {
      waba_templates?: unknown[];
      templates?: unknown[];
    };
    return (body.waba_templates ?? body.templates ?? []) as { name: string; status: string; rejected_reason?: string | null }[];
  }

  async createChannelApiKey(partner: PartnerCredentials, channelId: string): Promise<{ apiKey: string; address: string }> {
    const url = `${PARTNER_API}/partners/${encodeURIComponent(partner.partnerId)}/channels/${encodeURIComponent(channelId)}/api_keys`;
    const body = (await this.request('POST', url, { 'x-api-key': partner.apiKey }, {})) as { api_key?: string; address?: string };
    if (!body.api_key) throw new D360Error(502, 'La Partner API no devolvió una API key');
    return { apiKey: body.api_key, address: body.address ?? '' };
  }

  private async request(method: 'GET' | 'POST', url: string, auth: Record<string, string>, payload?: object): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
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
