import { WaTemplateStatus } from './whatsapp-template.entity';

export interface TemplateDef {
  name: string;
  text: string;
  example: string[];
  buttons: string[];
}

/** Textos del spec §5.5. Los botones siguen el orden de índices que usa message-builders.ts. */
export const TEMPLATE_DEFS: TemplateDef[] = [
  {
    name: 'recordatorio_cita_24h',
    text: 'Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}}.',
    example: ['Juan', 'Sonrisas', 'martes 6 de octubre', '09:30'],
    buttons: ['Confirmo', 'Reprogramar', 'Cancelar'],
  },
  {
    name: 'recordatorio_cita_2h',
    text: '{{1}}, te esperamos hoy a las {{2}} en {{3}}.',
    example: ['Juan', '09:30', 'Av. Larco 123'],
    buttons: ['Cancelar'],
  },
  {
    name: 'recordatorio_pago',
    text: 'Hola {{1}}, tienes un saldo de S/ {{2}} por {{3}}. Puedes pagar así: {{4}}.',
    example: ['Juan', '150.00', 'tratamiento de ortodoncia', 'Yape 987654321'],
    buttons: [],
  },
];

export const TEMPLATE_FOR_KIND: Record<'REMINDER_24H' | 'REMINDER_2H', string> = {
  REMINDER_24H: 'recordatorio_cita_24h',
  REMINDER_2H: 'recordatorio_cita_2h',
};

export function templateCreatePayload(def: TemplateDef): object {
  const components: object[] = [{ type: 'BODY', text: def.text, example: { body_text: [def.example] } }];
  if (def.buttons.length) components.push({ type: 'BUTTONS', buttons: def.buttons.map((text) => ({ type: 'QUICK_REPLY', text })) });
  return { name: def.name, category: 'UTILITY', language: 'es', components };
}

const KNOWN: Record<string, WaTemplateStatus> = {
  approved: WaTemplateStatus.APPROVED,
  rejected: WaTemplateStatus.REJECTED,
  paused: WaTemplateStatus.PAUSED,
  disabled: WaTemplateStatus.DISABLED,
};

/** submitted, pending, in_appeal y cualquier valor desconocido → PENDING. */
export function normalizeTemplateStatus(raw: unknown): WaTemplateStatus {
  return KNOWN[String(raw ?? '').toLowerCase()] ?? WaTemplateStatus.PENDING;
}
