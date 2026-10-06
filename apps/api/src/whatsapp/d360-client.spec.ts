import { D360Client, D360Error } from './d360-client';

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('D360Client', () => {
  const client = new D360Client();
  afterEach(() => jest.restoreAllMocks());

  it('producción: URL, header y cuerpo; devuelve el id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(ok({ messages: [{ id: 'wamid.ABC' }] }));
    const res = await client.send({ apiKey: 'k1', sandbox: false }, { hola: 1 });
    expect(res).toEqual({ waMessageId: 'wamid.ABC' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://waba-v2.360dialog.io/messages');
    expect((init!.headers as Record<string, string>)['D360-API-KEY']).toBe('k1');
    expect(JSON.parse(init!.body as string)).toEqual({ hola: 1 });
  });

  it('sandbox usa su host y /v1; setWebhook llama a /v1/configs/webhook', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => ok({ messages: [{ id: 'm1' }] }, 201));
    await client.send({ apiKey: 'k', sandbox: true }, {});
    await client.setWebhook({ apiKey: 'k', sandbox: true }, 'https://api.test/api/webhooks/wa/t');
    expect(fetchMock.mock.calls[0][0]).toBe('https://waba-sandbox.360dialog.io/v1/messages');
    expect(fetchMock.mock.calls[1][0]).toBe('https://waba-sandbox.360dialog.io/v1/configs/webhook');
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ url: 'https://api.test/api/webhooks/wa/t' });
  });

  it('errores: 401 no reintentable, 503 y red caída sí; respuesta sin id es error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(ok({ error: { message: 'Invalid key' } }, 401));
    await expect(client.send({ apiKey: 'k', sandbox: false }, {})).rejects.toMatchObject({ status: 401, retryable: false, message: 'Invalid key' });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(ok({}, 503));
    await expect(client.send({ apiKey: 'k', sandbox: false }, {})).rejects.toMatchObject({ status: 503, retryable: true });
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client.send({ apiKey: 'k', sandbox: false }, {})).rejects.toBeInstanceOf(D360Error);
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(ok({ messages: [] }));
    await expect(client.send({ apiKey: 'k', sandbox: false }, {})).rejects.toMatchObject({ retryable: true });
  });

  it('crea y lista plantillas con la key del canal (producción)', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(async () => ok({ id: 't1', status: 'submitted' }, 201))
      .mockImplementationOnce(async () => ok({ waba_templates: [{ name: 'a', status: 'approved' }] }));
    await client.createTemplate({ apiKey: 'k', sandbox: false }, { name: 'a' });
    const list = await client.listTemplates({ apiKey: 'k', sandbox: false });
    expect(fetchMock.mock.calls[0][0]).toBe('https://waba-v2.360dialog.io/v1/configs/templates');
    expect(fetchMock.mock.calls[0][1]!.method).toBe('POST');
    expect(fetchMock.mock.calls[1][0]).toBe('https://waba-v2.360dialog.io/v1/configs/templates');
    expect(fetchMock.mock.calls[1][1]!.method).toBe('GET');
    expect(list).toEqual([{ name: 'a', status: 'approved' }]);
  });

  it('genera la key de un canal con la Partner API (x-api-key)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ok({ id: 'x', api_key: 'chan-key', address: '+51987654321' }, 201));
    const res = await client.createChannelApiKey({ partnerId: 'P1', apiKey: 'pk' }, 'ch_9');
    expect(res).toEqual({ apiKey: 'chan-key', address: '+51987654321' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hub.360dialog.io/api/v2/partners/P1/channels/ch_9/api_keys');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('pk');
    expect((init!.headers as Record<string, string>)['D360-API-KEY']).toBeUndefined();
  });

  it('Partner API sin api_key en la respuesta es error', async () => {
    jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ok({}, 201));
    await expect(client.createChannelApiKey({ partnerId: 'P1', apiKey: 'pk' }, 'c')).rejects.toBeInstanceOf(D360Error);
  });
});
