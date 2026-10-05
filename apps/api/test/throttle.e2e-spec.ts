import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils';

describe('throttling detrás del proxy de Next', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.THROTTLE_LIMIT = '2';
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    process.env.THROTTLE_LIMIT = '1000';
  });

  const login = (ip: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'nadie@a.com', password: 'mala1234' });

  it('limita por IP del cliente, no a todos los usuarios juntos', async () => {
    await login('1.1.1.1').expect(401);
    await login('1.1.1.1').expect(401);
    await login('1.1.1.1').expect(429);
    await login('2.2.2.2').expect(401);
  });
});
