import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiErrorBody, ApiErrorCode } from '@agenda/contracts';
import { ZodError } from 'zod';

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SLOT_TAKEN: 409,
  SLOT_UNAVAILABLE: 409,
  HOLD_EXPIRED: 410,
  VERSION_MISMATCH: 412,
  INVALID_TRANSITION: 409,
  POLICY_VIOLATION: 422,
  OTP_INVALID: 422,
  OTP_REQUIRED: 422,
  RATE_LIMITED: 429,
  HAS_FUTURE_APPOINTMENTS: 409,
  CONFLICT: 409,
  INTERNAL: 500,
};

/** Error de negocio con codigo estable (consumible por el frontend). */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly extra: { details?: unknown; alternatives?: unknown } = {},
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse();
    let status = 500;
    let body: ApiErrorBody;
    if (exception instanceof AppError) {
      status = exception.status;
      body = { error: { code: exception.code, message: exception.message, ...(exception.extra as object) } } as ApiErrorBody;
    } else if (exception instanceof ZodError) {
      status = 400;
      body = {
        error: {
          code: 'VALIDATION_ERROR',
          message: exception.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`).join('; '),
          details: exception.issues,
        },
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message);
      const code: ApiErrorCode = status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL';
      body = { error: { code, message: Array.isArray(message) ? message.join('; ') : message } };
    } else {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
      body = { error: { code: 'INTERNAL', message: 'Error interno del servidor' } };
    }
    reply.status(status).send(body);
  }
}
