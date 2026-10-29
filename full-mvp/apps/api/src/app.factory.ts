import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import type { AppConfig } from './common/config';

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
    new FastifyAdapter({ trustProxy: true, bodyLimit: 1_048_576 }),
    { logger: config.logger ? new QuietLogger() : ['error', 'warn'], abortOnError: false },
  );
  app.enableCors({
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'If-Match', 'Last-Event-ID'],
    exposedHeaders: ['ETag'],
  });
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
