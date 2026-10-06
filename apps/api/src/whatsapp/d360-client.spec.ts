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
});
