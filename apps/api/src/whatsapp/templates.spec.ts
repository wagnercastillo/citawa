import { normalizeTemplateStatus, TEMPLATE_DEFS, TEMPLATE_FOR_KIND, templateCreatePayload } from './templates';

describe('templates', () => {
  it('define las 3 plantillas del spec', () => {
    expect(TEMPLATE_DEFS.map((t) => t.name)).toEqual(['recordatorio_cita_24h', 'recordatorio_cita_2h', 'recordatorio_pago']);
    expect(TEMPLATE_FOR_KIND).toEqual({ REMINDER_24H: 'recordatorio_cita_24h', REMINDER_2H: 'recordatorio_cita_2h' });
  });

  it('payload de 24 h: UTILITY/es, ejemplo de 4 valores y 3 quick replies en el orden de los builders', () => {
    const p = templateCreatePayload(TEMPLATE_DEFS[0]) as any;
    expect(p).toMatchObject({ name: 'recordatorio_cita_24h', category: 'UTILITY', language: 'es' });
    expect(p.components[0]).toEqual({
      type: 'BODY',
      text: 'Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}}.',
      example: { body_text: [['Juan', 'Sonrisas', 'martes 6 de octubre', '09:30']] },
    });
    expect(p.components[1]).toEqual({
      type: 'BUTTONS',
      buttons: ['Confirmo', 'Reprogramar', 'Cancelar'].map((text) => ({ type: 'QUICK_REPLY', text })),
    });
  });

  it('la de pago no tiene botones', () => {
    const p = templateCreatePayload(TEMPLATE_DEFS[2]) as any;
    expect(p.components).toHaveLength(1);
  });

  it('normaliza estados de 360dialog', () => {
    expect(normalizeTemplateStatus('approved')).toBe('APPROVED');
    expect(normalizeTemplateStatus('APPROVED')).toBe('APPROVED');
    expect(normalizeTemplateStatus('rejected')).toBe('REJECTED');
    expect(normalizeTemplateStatus('paused')).toBe('PAUSED');
    expect(normalizeTemplateStatus('disabled')).toBe('DISABLED');
    expect(normalizeTemplateStatus('submitted')).toBe('PENDING');
    expect(normalizeTemplateStatus('in_appeal')).toBe('PENDING');
    expect(normalizeTemplateStatus(undefined)).toBe('PENDING');
  });
});
