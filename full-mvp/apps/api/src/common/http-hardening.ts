import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config';

/** Instancia de Fastify que usa Nest (evita desajustes de tipos entre versiones de fastify). */
export type FastifyLike = ReturnType<ReturnType<NestFastifyApplication['getHttpAdapter']>['getInstance']>;

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/** Usa el X-Request-Id entrante si es seguro (evita inyeccion en logs); si no, genera uno. */
export function genReqId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const h = req.headers['x-request-id'];
  const v = Array.isArray(h) ? h[0] : h;
  return v && REQUEST_ID_RE.test(v) ? v : randomUUID();
}

/** Origen permitido segun la lista blanca. Sin lista (solo desarrollo) acepta cualquiera. */
export function isOriginAllowed(origin: string | undefined, config: Pick<AppConfig, 'corsOrigins' | 'isProduction'>): boolean {
  if (!origin) return true; // peticiones sin Origin (curl, servidor a servidor): CORS no aplica
  if (config.corsOrigins.length === 0) return !config.isProduction;
  return config.corsOrigins.includes(origin.replace(/\/$/, ''));
}

/** Cabeceras de seguridad de la API (responde JSON: no debe poder incrustarse ni interpretarse como HTML). */
export function securityHeaders(config: Pick<AppConfig, 'isProduction'>): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
    ...(config.isProduction ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}),
  };
}

/** Registra ids de correlacion, cabeceras de seguridad y log de acceso estructurado. */
export function registerHttpHooks(fastify: FastifyLike, config: AppConfig): void {
  const headers = securityHeaders(config);
  const log = new Logger('HTTP');

  fastify.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
  });

  fastify.addHook('onSend', async (_req, reply, payload) => {
    for (const [k, v] of Object.entries(headers)) reply.header(k, v);
    if (!reply.hasHeader('cache-control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  if (config.logger) {
    fastify.addHook('onResponse', async (req, reply) => {
      const path = req.url.split('?')[0]; // nunca registrar query (puede traer ?token= del SSE)
      if (path === '/health' || path === '/ready' || path === '/v1/health') return;
      log.log(
        JSON.stringify({ msg: 'request', id: req.id, method: req.method, path, status: reply.statusCode, ms: Math.round(reply.elapsedTime) }),
      );
    });
  }
}
