import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory';
import { type AppConfig, loadConfig } from '../src/common/config';

// bcrypt barato en pruebas (costo 4); en produccion el costo por defecto es 12
process.env.BCRYPT_ROUNDS ??= '4';

export interface TestCtx {
  app: NestFastifyApplication;
  config: AppConfig;
  call: (method: string, url: string, opts?: { body?: unknown; token?: string; headers?: Record<string, string> }) => Promise<{ status: number; json: any; headers: Record<string, any> }>;
  login: (email?: string) => Promise<string>;
  close: () => Promise<void>;
}

/** Levanta la API completa en memoria (PGlite con EXCLUDE real), sin red ni planificador embebido. */
export async function startTestApp(overrides: Partial<AppConfig> = {}): Promise<TestCtx> {
  const config = loadConfig({
    // TEST_DATABASE_URL permite correr toda la suite contra PostgreSQL real (docker) en lugar de PGlite
    databaseUrl: process.env.TEST_DATABASE_URL || undefined, pgliteDir: undefined, autoSeed: true, embeddedWorker: false, rateLimit: false, logger: false,
    demoMode: true, otpMode: 'mock', otpMockCode: '123456', whatsappMode: 'mock', port: 0,
    ...overrides,
  });
  const app = await createApp(config);
  const fastify = app.getHttpAdapter().getInstance();
  const call: TestCtx['call'] = async (method, url, opts = {}) => {
    const res = await fastify.inject({
      method: method as 'GET',
      url,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.headers ?? {}),
      },
      ...(opts.body !== undefined ? { payload: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) } : {}),
    });
    let json: any;
    try { json = res.json(); } catch { json = res.body; }
    return { status: res.statusCode, json, headers: res.headers };
  };
  const login: TestCtx['login'] = async (email = 'admin@belleza-demo.com') => {
    const r = await call('POST', '/v1/auth/login', { body: { email, password: 'demo1234' } });
    return r.json.token as string;
  };
  return { app, config, call, login, close: () => app.close() };
}

export const SLUG = 'belleza-demo';
export const isoDate = (offsetDays: number, from = new Date()) => new Date(from.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
