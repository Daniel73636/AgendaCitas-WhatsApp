import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, isMockOtp, parseConfig } from '../src/common/config';
import { SLUG, type TestCtx, startTestApp } from './helpers';

const prodEnv = {
  NODE_ENV: 'production',
  AUTH_SECRET: 'a'.repeat(48),
  FIELD_ENCRYPTION_KEY: 'b'.repeat(48),
  INTERNAL_JOBS_SECRET: 'c'.repeat(24),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-token-largo-123',
  CORS_ORIGINS: 'https://reservas.ejemplo.com',
  DATABASE_URL: 'postgres://u:p@db:5432/agenda',
  PUBLIC_WEB_URL: 'https://reservas.ejemplo.com',
};

describe('validacion de entorno (zod)', () => {
  it('desarrollo: arranca sin .env con valores seguros por defecto y avisos', () => {
    const c = parseConfig({});
    expect(c.demoMode).toBe(false);
    expect(c.paymentsProvider).toBe('none');
    expect(c.autoSeed).toBe(false);
    expect(isMockOtp(c)).toBe(false); // OTP_MODE=mock pero sin DEMO_MODE => NO hay codigo 123456
    expect(c.warnings.length).toBeGreaterThan(0);
  });

  it('DEMO_MODE=true habilita OTP de demostracion y semilla', () => {
    const c = parseConfig({ DEMO_MODE: 'true' });
    expect(c.demoMode).toBe(true);
    expect(c.paymentsProvider).toBe('mock');
    expect(c.autoSeed).toBe(true);
    expect(isMockOtp(c)).toBe(true);
    expect(isMockOtp(parseConfig({ DEMO_MODE: 'true', OTP_MODE: 'real' }))).toBe(false);
    const ignored = parseConfig({ PAYMENTS_PROVIDER: 'mock' });
    expect(ignored.paymentsProvider).toBe('none');
    expect(ignored.warnings.some((w) => w.includes('PAYMENTS_PROVIDER'))).toBe(true);
    expect(() => parseConfig({ ...prodEnv, PAYMENTS_PROVIDER: 'wompi' })).toThrow(/wompi/);
  });

  it('produccion valida: sin demo, sin semilla', () => {
    const c = parseConfig(prodEnv);
    expect(c.isProduction).toBe(true);
    expect(c.autoSeed).toBe(false);
    expect(c.corsOrigins).toEqual(['https://reservas.ejemplo.com']);
    expect(c.trustProxy).toBe(false);
  });

  it('produccion: reporta TODOS los problemas juntos y en espanol', () => {
    let err: ConfigError | undefined;
    try {
      parseConfig({ NODE_ENV: 'production', DEMO_MODE: 'true', AUTH_SECRET: 'corto' });
    } catch (e) {
      err = e as ConfigError;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const text = err!.problems.join('\n');
    expect(text).toContain('AUTH_SECRET');
    expect(text).toContain('FIELD_ENCRYPTION_KEY');
    expect(text).toContain('CORS_ORIGINS');
    expect(text).toContain('DATABASE_URL');
    expect(text).toContain('DEMO_MODE');
  });

  it('produccion rechaza los secretos de ejemplo', () => {
    expect(() => parseConfig({ ...prodEnv, AUTH_SECRET: 'dev-secret-cambia-esto-en-produccion-32chars' })).toThrow(/AUTH_SECRET/);
    expect(() => parseConfig({ ...prodEnv, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });

  it('WHATSAPP_MODE=cloud exige credenciales y app secret', () => {
    expect(() => parseConfig({ WHATSAPP_MODE: 'cloud' })).toThrow(/WHATSAPP_PHONE_NUMBER_ID[\s\S]*WHATSAPP_ACCESS_TOKEN[\s\S]*WHATSAPP_APP_SECRET/);
    const c = parseConfig({ WHATSAPP_MODE: 'cloud', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_APP_SECRET: 's' });
    expect(c.whatsappMode).toBe('cloud');
  });

  it('valores mal formados dan un mensaje claro', () => {
    expect(() => parseConfig({ API_PORT: 'abc' })).toThrow(/API_PORT/);
    expect(() => parseConfig({ DEMO_MODE: 'quiza' })).toThrow(/DEMO_MODE/);
    expect(() => parseConfig({ OTP_MODE: 'otro' })).toThrow(/OTP_MODE/);
  });
});

describe('API: salud, correlacion, errores en espanol y cabeceras', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await startTestApp({ corsOrigins: ['https://reservas.ejemplo.com'] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('/health responde ok y /ready comprueba la base de datos', async () => {
    const h = await t.call('GET', '/health');
    expect(h.status).toBe(200);
    expect(h.json.ok).toBe(true);
    const legacy = await t.call('GET', '/v1/health');
    expect(legacy.status).toBe(200);
    const r = await t.call('GET', '/ready');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, status: 'ready', checks: { database: 'ok' } });
  });

  it('/ready devuelve 503 si la base no responde', async () => {
    const { DB_HANDLE } = await import('../src/core/db.provider');
    const handle = t.app.get(DB_HANDLE);
    const original = handle.db.execute;
    (handle.db as any).execute = () => Promise.reject(new Error('caida'));
    try {
      const r = await t.call('GET', '/ready');
      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({ ok: false, checks: { database: 'fail' } });
    } finally {
      (handle.db as any).execute = original;
    }
  });

  it('cada respuesta trae X-Request-Id; se respeta uno valido y se reemplaza uno malicioso', async () => {
    const a = await t.call('GET', '/health');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await t.call('GET', '/health', { headers: { 'x-request-id': 'mi-correlacion-123' } });
    expect(b.headers['x-request-id']).toBe('mi-correlacion-123');
    const c = await t.call('GET', '/health', { headers: { 'x-request-id': 'x\r\nSet-Cookie: a=b' } });
    expect(c.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('los errores son estructurados, en espanol e incluyen correlationId', async () => {
    const nf = await t.call('GET', '/v1/ruta-que-no-existe', { headers: { 'x-request-id': 'corr-404-abcdef' } });
    expect(nf.status).toBe(404);
    expect(nf.json.error.code).toBe('NOT_FOUND');
    expect(nf.json.error.message).not.toMatch(/Cannot GET/);
    expect(nf.json.error.correlationId).toBe('corr-404-abcdef');

    const unauth = await t.call('GET', '/v1/customers');
    expect(unauth.status).toBe(401);
    expect(unauth.json.error.message).toMatch(/Sesion invalida/);

    const bad = await t.call('POST', '/v1/auth/login', { body: { email: 'no-es-correo' } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('VALIDATION_ERROR');
    expect(bad.json.error.message).toMatch(/email: Correo electronico invalido/);
    expect(bad.json.error.message).toMatch(/password: Este campo es obligatorio/);
  });

  it('JSON malformado -> 400 en espanol (antes 500)', async () => {
    const r = await t.call('POST', '/v1/auth/login', { body: '{"email": ' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('VALIDATION_ERROR');
    expect(r.json.error.message).toMatch(/JSON valido/);
  });

  it('cuerpo demasiado grande -> 413 en espanol', async () => {
    const r = await t.call('POST', '/v1/auth/login', { body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(1_200_000) }) });
    expect(r.status).toBe(413);
    expect(r.json.error.message).toMatch(/demasiado grande/);
  });

  it('cabeceras de seguridad en todas las respuestas', async () => {
    const r = await t.call('GET', `/v1/public/${SLUG}`);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('CORS: solo los origenes de la lista blanca reciben cabeceras', async () => {
    const ok = await t.call('GET', '/health', { headers: { origin: 'https://reservas.ejemplo.com' } });
    expect(ok.headers['access-control-allow-origin']).toBe('https://reservas.ejemplo.com');
    const evil = await t.call('GET', '/health', { headers: { origin: 'https://malo.example.net' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await t.call('OPTIONS', '/v1/auth/login', {
      headers: { origin: 'https://malo.example.net', 'access-control-request-method': 'POST' },
    });
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
  });
});
