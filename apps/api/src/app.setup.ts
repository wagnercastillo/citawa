import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/** Valor de Express "trust proxy": número de saltos (ej. "1") o lista/alias ("loopback"). */
function trustProxySetting(): string | number {
  const value = process.env.TRUST_PROXY ?? 'loopback';
  return /^\d+$/.test(value) ? Number(value) : value;
}

export function configureApp(app: INestApplication): void {
  // El panel llama a la API a través del proxy de Next: req.ip debe ser la IP del cliente, no la del proxy.
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxySetting());
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
}
