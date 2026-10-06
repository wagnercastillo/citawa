import { reminder24h, reminder2h, SANDBOX_TEMPLATE, slotList, textMessage } from './message-builders';

const ID = '11111111-1111-1111-1111-111111111111';

describe('message builders', () => {
  it('recordatorio 24 h en producción: plantilla, parámetros y 3 botones', () => {
    const p = reminder24h({ to: '+51987654321', patientName: 'Juan', clinicName: 'Sonrisas', dateText: 'martes 6 de octubre', timeText: '09:30', appointmentId: ID, sandbox: false }) as any;
    expect(p).toMatchObject({ messaging_product: 'whatsapp', to: '51987654321', type: 'template' });
    expect(p.template.name).toBe('recordatorio_cita_24h');
    expect(p.template.language).toEqual({ code: 'es' });
    expect(p.template.components[0]).toEqual({
      type: 'body',
      parameters: ['Juan', 'Sonrisas', 'martes 6 de octubre', '09:30'].map((text) => ({ type: 'text', text })),
    });
    expect(p.template.components.slice(1).map((c: any) => [c.sub_type, c.index, c.parameters[0].payload])).toEqual([
      ['quick_reply', '0', `CONFIRM:${ID}`],
      ['quick_reply', '1', `RESCHEDULE:${ID}`],
      ['quick_reply', '2', `CANCEL:${ID}`],
    ]);
  });

  it('recordatorio 2 h en producción: lugar y botón cancelar', () => {
    const p = reminder2h({ to: '+51987654321', patientName: 'Juan', timeText: '09:30', place: 'Av. Larco 123', appointmentId: ID, sandbox: false }) as any;
    expect(p.template.name).toBe('recordatorio_cita_2h');
    expect(p.template.components[0].parameters.map((x: any) => x.text)).toEqual(['Juan', '09:30', 'Av. Larco 123']);
    expect(p.template.components[1].parameters[0].payload).toBe(`CANCEL:${ID}`);
  });

  it('en sandbox usa la plantilla de prueba con CONFIRM y CANCEL', () => {
    const p = reminder24h({ to: '+51987654321', patientName: 'J', clinicName: 'C', dateText: 'd', timeText: 't', appointmentId: ID, sandbox: true }) as any;
    expect(p.template.name).toBe(SANDBOX_TEMPLATE);
    expect(p.template.components.map((c: any) => c.parameters[0].payload)).toEqual([`CONFIRM:${ID}`, `CANCEL:${ID}`]);
  });

  it('lista de horarios: máx. 10 filas, título ≤ 24, id PICK', () => {
    const slots = Array.from({ length: 12 }, (_, i) => ({ iso: `2026-10-0${(i % 9) + 1}T15:00:00.000Z`, label: `etiqueta muy larga número ${i}` }));
    const p = slotList({ to: '+51987654321', appointmentId: ID, slots, intro: 'Elige:' }) as any;
    const rows = p.interactive.action.sections[0].rows;
    expect(p.interactive.type).toBe('list');
    expect(rows).toHaveLength(10);
    expect(rows.every((r: any) => r.title.length <= 24)).toBe(true);
    expect(rows[0].id).toBe(`PICK:${ID}:${slots[0].iso}`);
    expect(p.interactive.action.button.length).toBeLessThanOrEqual(20);
  });

  it('texto simple', () => {
    expect(textMessage('+51987654321', 'Hola')).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '51987654321', type: 'text', text: { body: 'Hola' },
    });
  });
});
