import { parseWebhook } from './parse-webhook';

const cloud = (value: unknown) => ({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value }] }] });

describe('parseWebhook', () => {
  it('texto, botón de plantilla, lista y botón interactivo (formato Cloud)', () => {
    const { messages } = parseWebhook(
      cloud({
        messages: [
          { from: '51987654321', id: 'w1', type: 'text', text: { body: 'hola' } },
          { from: '51987654321', id: 'w2', type: 'button', button: { text: 'Confirmo', payload: 'CONFIRM:x' } },
          { from: '51987654321', id: 'w3', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'PICK:x:y', title: 't' } } },
          { from: '51987654321', id: 'w4', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'CANCEL:x', title: 't' } } },
        ],
      }),
    );
    expect(messages.map((m) => [m.waId, m.type, m.text, m.payload])).toEqual([
      ['w1', 'text', 'hola', null],
      ['w2', 'button', null, 'CONFIRM:x'],
      ['w3', 'interactive', null, 'PICK:x:y'],
      ['w4', 'interactive', null, 'CANCEL:x'],
    ]);
  });

  it('estados en mayúsculas e ignora desconocidos', () => {
    const { statuses } = parseWebhook(cloud({ statuses: [{ id: 'a', status: 'delivered' }, { id: 'b', status: 'read' }, { id: 'c', status: 'deleted' }] }));
    expect(statuses).toEqual([{ waId: 'a', status: 'DELIVERED' }, { waId: 'b', status: 'READ' }]);
  });

  it('acepta el formato v1 (sin entry) y basura', () => {
    expect(parseWebhook({ messages: [{ from: '1', id: 'z', type: 'text', text: { body: 'x' } }] }).messages).toHaveLength(1);
    expect(parseWebhook(null)).toEqual({ messages: [], statuses: [] });
    expect(parseWebhook({ entry: 'nope' })).toEqual({ messages: [], statuses: [] });
  });
});
