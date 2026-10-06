import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? exception.message);
      res.status(status).json({ statusCode: status, message, error: HttpStatus[status] });
      return;
    }

    if (exception instanceof QueryFailedError && (exception as QueryFailedError & { code?: string }).code === '23P01') {
      res.status(409).json({ statusCode: 409, message: 'Horario ocupado: ya hay otra cita en ese horario', error: 'CONFLICT' });
      return;
    }

    if (exception instanceof QueryFailedError && (exception as QueryFailedError & { code?: string }).code === '23505') {
      res.status(409).json({ statusCode: 409, message: 'Ya existe un registro con esos datos', error: 'CONFLICT' });
      return;
    }

    this.logger.error(exception);
    res.status(500).json({ statusCode: 500, message: 'Error interno del servidor', error: 'INTERNAL_SERVER_ERROR' });
  }
}
