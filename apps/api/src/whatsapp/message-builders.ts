/** Plantilla fija del sandbox de 360dialog (2 botones quick-reply). Idioma sin verificar: "en". */
export const SANDBOX_TEMPLATE = 'interactive_template_sandbox';

const digits = (e164: string): string => e164.replace(/\D/g, '');

const base = (to: string) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(to) });

const quickReply = (index: number, payload: string) => ({
  type: 'button',
  sub_type: 'quick_reply',
  index: String(index),
  parameters: [{ type: 'payload', payload }],
});

const bodyParams = (values: string[]) => ({ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) });

const template = (to: string, name: string, language: string, components: object[]) => ({
  ...base(to),
  type: 'template',
  template: { name, language: { code: language }, components },
});

const sandboxReminder = (to: string, appointmentId: string) =>
  template(to, SANDBOX_TEMPLATE, 'en', [quickReply(0, `CONFIRM:${appointmentId}`), quickReply(1, `CANCEL:${appointmentId}`)]);

export function reminder24h(a: {
  to: string;
  patientName: string;
  clinicName: string;
  dateText: string;
  timeText: string;
  appointmentId: string;
  sandbox: boolean;
}): object {
  if (a.sandbox) return sandboxReminder(a.to, a.appointmentId);
  return template(a.to, 'recordatorio_cita_24h', 'es', [
    bodyParams([a.patientName, a.clinicName, a.dateText, a.timeText]),
    quickReply(0, `CONFIRM:${a.appointmentId}`),
    quickReply(1, `RESCHEDULE:${a.appointmentId}`),
    quickReply(2, `CANCEL:${a.appointmentId}`),
  ]);
}

export function reminder2h(a: {
  to: string;
  patientName: string;
  timeText: string;
  place: string;
  appointmentId: string;
  sandbox: boolean;
}): object {
  if (a.sandbox) return sandboxReminder(a.to, a.appointmentId);
  return template(a.to, 'recordatorio_cita_2h', 'es', [
    bodyParams([a.patientName, a.timeText, a.place]),
    quickReply(0, `CANCEL:${a.appointmentId}`),
  ]);
}

export function textMessage(to: string, body: string): object {
  return { ...base(to), type: 'text', text: { body } };
}

export function slotList(a: { to: string; appointmentId: string; slots: { iso: string; label: string }[]; intro: string }): object {
  return {
    ...base(a.to),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: a.intro },
      action: {
        button: 'Ver horarios',
        sections: [
          {
            title: 'Horarios libres',
            rows: a.slots.slice(0, 10).map((s) => ({ id: `PICK:${a.appointmentId}:${s.iso}`, title: s.label.slice(0, 24) })),
          },
        ],
      },
    },
  };
}
