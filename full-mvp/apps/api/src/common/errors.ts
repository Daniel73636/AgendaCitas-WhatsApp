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
  ACCOUNT_LOCKED: 423,
  HAS_FUTURE_APPOINTMENTS: 409,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** Error de negocio con codigo estable (consumible por el frontend). */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly extra: { details?: unknown; alternatives?: unknown; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

/** Mensajes en espanol para errores de plataforma (Nest/Fastify) segun el estado HTTP. */
const HTTP_MESSAGES: Record<number, string> = {
  400: 'La solicitud no es valida.',
  401: 'Sesion invalida o expirada. Inicia sesion de nuevo.',
  403: 'No tienes permiso para esta accion.',
  404: 'No encontramos lo que buscas.',
  405: 'Metodo no permitido para esta ruta.',
  406: 'Formato de respuesta no soportado.',
  408: 'La solicitud tardo demasiado. Intenta de nuevo.',
  409: 'La operacion entra en conflicto con el estado actual.',
  413: 'El contenido enviado es demasiado grande.',
  415: 'Tipo de contenido no soportado. Usa application/json.',
  422: 'No pudimos procesar los datos enviados.',
  429: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.',
  503: 'El servicio no esta disponible por ahora. Intenta de nuevo en un momento.',
};

const CODE_BY_STATUS = (status: number): ApiErrorCode =>
  status === 401 ? 'UNAUTHORIZED'
  : status === 403 ? 'FORBIDDEN'
  : status === 404 ? 'NOT_FOUND'
  : status === 429 ? 'RATE_LIMITED'
  : status === 503 ? 'SERVICE_UNAVAILABLE'
  : status === 409 ? 'CONFLICT'
  : status >= 400 && status < 500 ? 'VALIDATION_ERROR'
  : 'INTERNAL';

/** Errores de Fastify (JSON mal formado, cuerpo muy grande...) traen `statusCode` y `code` FST_ERR_*. */
const fastifyStatus = (e: unknown): number | undefined => {
  const s = (e as { statusCode?: unknown } | null)?.statusCode;
  const code = (e as { code?: unknown } | null)?.code;
  return typeof s === 'number' && s >= 400 && s < 600 && typeof code === 'string' && code.startsWith('FST_') ? s : undefined;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const reply = http.getResponse();
    const request = http.getRequest<{ id?: string; method?: string; url?: string }>();
    const correlationId = request?.id;
    let status = 500;
    let body: ApiErrorBody;
    if (exception instanceof AppError) {
      status = exception.status;
      body = { error: { code: exception.code, message: exception.message, ...(exception.extra as object) } } as ApiErrorBody;
      if (exception.extra.retryAfterSec) reply.header?.('Retry-After', String(exception.extra.retryAfterSec));
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
      // La aplicacion lanza AppError; las HttpException son de la plataforma (en ingles): se traducen por estado.
      const raw = exception.message;
      const message = /not valid JSON|Unexpected token|JSON/i.test(raw) && status === 400 ? 'El cuerpo de la solicitud no es un JSON valido.' : (HTTP_MESSAGES[status] ?? HTTP_MESSAGES[400]!);
      body = { error: { code: CODE_BY_STATUS(status), message } };
    } else if (fastifyStatus(exception) !== undefined) {
      status = fastifyStatus(exception)!;
      const code = (exception as { code: string }).code;
      const message = code === 'FST_ERR_CTP_INVALID_JSON_BODY' || code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || code === 'FST_ERR_CTP_INVALID_CONTENT_LENGTH'
        ? 'El cuerpo de la solicitud no es un JSON valido.'
        : (HTTP_MESSAGES[status] ?? HTTP_MESSAGES[400]!);
      body = { error: { code: CODE_BY_STATUS(status), message } };
    } else {
      this.logger.error(`[${correlationId ?? '-'}] ${request?.method ?? ''} ${(request?.url ?? '').split('?')[0]} -> ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`);
      body = { error: { code: 'INTERNAL', message: 'Ocurrio un error interno. Si persiste, comparte este codigo de referencia con soporte.' } };
    }
    if (correlationId) body.error.correlationId = correlationId;
    reply.status(status).send(body);
  }
}
