import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import type { AppConfig } from './common/config';
import { genReqId, isOriginAllowed, registerHttpHooks } from './common/http-hardening';
import { registerRawBodyCapture } from './common/raw-body';

/** Oculta el listado de rutas de arranque; deja los logs utiles (BD, WhatsApp, planificador). */
class QuietLogger extends ConsoleLogger {
  private static readonly NOISY = new Set(['RouterExplorer', 'RoutesResolver', 'InstanceLoader', 'NestFactory', 'NestApplication']);
  override log(message: unknown, ...rest: unknown[]) {
    const ctx = rest[rest.length - 1];
    if (typeof ctx === 'string' && QuietLogger.NOISY.has(ctx)) return;
    super.log(message, ...rest);
  }
}

export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    new FastifyAdapter({ trustProxy: config.trustProxy, bodyLimit: 1_048_576, genReqId, requestIdHeader: false }),
    { logger: config.logger ? new QuietLogger() : ['error', 'warn'], abortOnError: false },
  );
  app.enableCors({
    origin: (origin, cb) => cb(null, isOriginAllowed(origin, config)),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'If-Match', 'Last-Event-ID', 'X-Request-Id'],
    exposedHeaders: ['ETag', 'X-Request-Id', 'Retry-After', 'Content-Disposition'],
    maxAge: 600,
  });
  const fastify = app.getHttpAdapter().getInstance();
  registerHttpHooks(fastify, config);
  registerRawBodyCapture(fastify, ['/v1/webhooks/whatsapp']);
  app.enableShutdownHooks();
  await app.init();
  await fastify.ready();
  return app;
}
