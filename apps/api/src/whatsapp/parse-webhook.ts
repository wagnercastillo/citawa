export interface InboundMessage {
  waId: string;
  from: string;
  type: string;
  text: string | null;
  payload: string | null;
}

export type DeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface StatusUpdate {
  waId: string;
  status: DeliveryStatus;
}

const STATUSES: Record<string, DeliveryStatus> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Acepta el formato Cloud (entry[].changes[].value) y el v1 (arrays en la raíz). */
export function parseWebhook(body: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Json;
  const values: Json[] = Array.isArray(b.entry)
    ? b.entry.flatMap((e: Json) => (Array.isArray(e?.changes) ? e.changes.map((c: Json) => c?.value ?? {}) : []))
    : [b];

  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  for (const v of values) {
    for (const m of Array.isArray(v.messages) ? v.messages : []) {
      if (typeof m?.id !== 'string' || typeof m?.from !== 'string') continue;
      messages.push({
        waId: m.id,
        from: m.from,
        type: String(m.type ?? 'unknown'),
        text: typeof m.text?.body === 'string' ? m.text.body : null,
        payload: m.button?.payload ?? m.interactive?.list_reply?.id ?? m.interactive?.button_reply?.id ?? null,
      });
    }
    for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
      const status = STATUSES[String(s?.status)];
      if (typeof s?.id === 'string' && status) statuses.push({ waId: s.id, status });
    }
  }
  return { messages, statuses };
}
