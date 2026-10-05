import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils';

describe('health', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it('GET /api/health responde ok', () =>
    request(app.getHttpServer()).get('/api/health').expect(200).expect({ ok: true }));

  it('ruta inexistente responde 404 con el formato de error', async () => {
    const res = await request(app.getHttpServer()).get('/api/no-existe').expect(404);
    expect(res.body).toEqual(expect.objectContaining({ statusCode: 404, error: 'NOT_FOUND' }));
  });
});
