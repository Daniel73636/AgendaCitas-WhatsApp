import { scryptSync, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, eq, loginAttempts, otpCodes, users, verifyPassword } from '@agenda/db';
import type { MockWhatsAppClient } from '@agenda/whatsapp';
import { ClockService } from '../src/core/clock.service';
import { DB_HANDLE } from '../src/core/db.provider';
import { MessagingService } from '../src/core/messaging.service';
import { SLUG, type TestCtx, isoDate, startTestApp } from './helpers';

const ADMIN = 'admin@belleza-demo.com';
const phone = () => '+57312' + String(Math.floor(1000000 + Math.random() * 8999999));
const login = (t: TestCtx, email: string, password: string) => t.call('POST', '/v1/auth/login', { body: { email, password } });

describe('contrasenas: bcrypt y migracion desde scrypt', () => {
  let t: TestCtx;
  let handle: DbHandle;
  beforeAll(async () => {
    t = await startTestApp();
    handle = t.app.get(DB_HANDLE);
  });
  afterAll(() => t.close());

  it('las contrasenas sembradas usan bcrypt (no texto plano ni scrypt)', async () => {
    const [u] = await handle.db.select().from(users).where(eq(users.email, ADMIN));
    expect(u!.passwordHash).toMatch(/^bcrypt-sha256\$\$2[aby]\$\d{2}\$/);
    expect(u!.passwordHash).not.toContain('demo1234');
    expect(await verifyPassword('demo1234', u!.passwordHash)).toBe(true);
    expect(await verifyPassword('otra', u!.passwordHash)).toBe(false);
  });

  it('un hash scrypt antiguo sigue funcionando y se re-hashea a bcrypt tras el login', async () => {
    const salt = randomBytes(16);
    const legacy = `scrypt$${salt.toString('hex')}$${scryptSync('demo1234', salt, 32).toString('hex')}`;
    await handle.db.update(users).set({ passwordHash: legacy }).where(eq(users.email, 'recepcion@belleza-demo.com'));
    expect((await login(t, 'recepcion@belleza-demo.com', 'mala')).status).toBe(401);
    const ok = await login(t, 'recepcion@belleza-demo.com', 'demo1234');
    expect(ok.status).toBe(200);
    const [u] = await handle.db.select().from(users).where(eq(users.email, 'recepcion@belleza-demo.com'));
    expect(u!.passwordHash.startsWith('bcrypt-sha256$')).toBe(true);
    expect((await login(t, 'recepcion@belleza-demo.com', 'demo1234')).status).toBe(200);
  });

  it('contrasenas de mas de 72 bytes no se truncan', async () => {
    const { hashPassword } = await import('@agenda/db');
    const long = 'x'.repeat(100);
    const h = hashPassword(long + 'A');
    expect(await verifyPassword(long + 'A', h)).toBe(true);
    expect(await verifyPassword(long + 'B', h)).toBe(false);
  });
});

describe('bloqueo de cuenta tras intentos fallidos', () => {
  let t: TestCtx;
  let handle: DbHandle;
  beforeAll(async () => {
    t = await startTestApp({ loginMaxAttempts: 3, loginLockMinutes: 15 });
    handle = t.app.get(DB_HANDLE);
  });
  afterAll(() => t.close());

  it('3 fallos bloquean 15 min, incluso con la contrasena correcta; luego se libera', async () => {
    const email = 'recepcion@belleza-demo.com';
    expect((await login(t, email, 'x1')).status).toBe(401);
    expect((await login(t, email, 'x2')).status).toBe(401);
    const third = await login(t, email, 'x3');
    expect(third.status).toBe(423);
    expect(third.json.error.code).toBe('ACCOUNT_LOCKED');
    expect(third.json.error.retryAfterSec).toBeGreaterThan(0);
    expect(third.headers['retry-after']).toBeDefined();
    // con la contrasena correcta tambien esta bloqueada
    expect((await login(t, email, 'demo1234')).status).toBe(423);
    // otro usuario no se ve afectado
    expect((await login(t, ADMIN, 'demo1234')).status).toBe(200);
    // pasan 16 min
    const clock = t.app.get(ClockService);
    clock.advance(16 * 60_000);
    try {
      expect((await login(t, email, 'demo1234')).status).toBe(200);
    } finally {
      clock.set(null);
    }
    const rows = await handle.db.select().from(loginAttempts).where(eq(loginAttempts.email, email));
    expect(rows).toHaveLength(0); // el contador se reinicia con un login correcto
  });

  it('correos inexistentes se comportan IGUAL (no se puede enumerar cuentas)', async () => {
    const email = 'fantasma@nadie.com';
    const known = await login(t, 'admin@belleza-demo.com', 'mala-1');
    const a = await login(t, email, 'x1');
    expect(a.status).toBe(401);
    expect(a.json.error.message).toBe(known.json.error.message);
    expect((await login(t, email, 'x2')).status).toBe(401);
    const locked = await login(t, email, 'x3');
    expect(locked.status).toBe(423);
    expect(locked.json.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('el correo se normaliza (mayusculas/espacios cuentan como el mismo)', async () => {
    const email = 'otro@nadie.com';
    await login(t, email.toUpperCase(), 'a');
    await login(t, ` ${email} `.trim(), 'b');
    const third = await login(t, email, 'c');
    expect(third.status).toBe(423);
  });
});

describe('limite de tasa del login (por IP)', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await startTestApp({ rateLimit: true, loginMaxAttempts: 1000 });
  });
  afterAll(() => t.close());

  it('11 intentos en un minuto -> 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await login(t, 'nadie@nadie.com', 'x')).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('sin DEMO_MODE: nada de codigos ni simuladores de demostracion', () => {
  let t: TestCtx;
  let handle: DbHandle;
  beforeAll(async () => {
    // Semilla presente (para tener un negocio) pero DEMO_MODE apagado y OTP_MODE=mock configurado
    t = await startTestApp({ demoMode: false, autoSeed: true, otpMode: 'mock' });
    handle = t.app.get(DB_HANDLE);
  });
  afterAll(() => t.close());

  const outbox = () => (t.app.get(MessagingService).client as MockWhatsAppClient).outbox;

  it('el codigo 123456 NO sirve para cualquier celular', async () => {
    const p = phone();
    const r = await t.call('POST', `/v1/public/${SLUG}/otp/verify`, { body: { phone: p, code: '123456' } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('OTP_INVALID');
  });

  it('el OTP es aleatorio, se envia por WhatsApp, se guarda con hash y la respuesta no lo revela', async () => {
    const p = phone();
    const req = await t.call('POST', `/v1/public/${SLUG}/otp/request`, { body: { phone: p } });
    expect(req.status).toBe(201);
    expect(req.json.mock).toBe(false);
    expect(req.json.hint).toBeUndefined();
    const sent = outbox().filter((m) => m.to === p).at(-1)!;
    const code = /\b(\d{6})\b/.exec(sent.body)![1]!;
    const [row] = await handle.db.select().from(otpCodes).where(eq(otpCodes.phoneE164, p));
    expect(row!.code).not.toBe(code);
    expect(row!.code).toMatch(/^[0-9a-f]{64}$/);
    expect((await t.call('POST', `/v1/public/${SLUG}/otp/verify`, { body: { phone: p, code: code === '000000' ? '000001' : '000000' } })).status).toBe(422);
    const ok = await t.call('POST', `/v1/public/${SLUG}/otp/verify`, { body: { phone: p, code } });
    expect(ok.status).toBe(201);
    expect(ok.json.otpToken).toBeTruthy();
    // un codigo no se puede reutilizar
    expect((await t.call('POST', `/v1/public/${SLUG}/otp/verify`, { body: { phone: p, code } })).status).toBe(422);
  });

  it('5 intentos fallidos bloquean el numero 15 min (no se puede pedir otro codigo)', async () => {
    const p = phone();
    await t.call('POST', `/v1/public/${SLUG}/otp/request`, { body: { phone: p } });
    for (let i = 0; i < 5; i++) {
      const r = await t.call('POST', `/v1/public/${SLUG}/otp/verify`, { body: { phone: p, code: '999999' } });
      expect(r.json.error.code).toBe('OTP_INVALID');
    }
    const blocked = await t.call('POST', `/v1/public/${SLUG}/otp/verify`, { body: { phone: p, code: '999999' } });
    expect(blocked.json.error.message).toMatch(/Demasiados intentos/);
    const again = await t.call('POST', `/v1/public/${SLUG}/otp/request`, { body: { phone: p } });
    expect(again.status).toBe(423);
    expect(again.json.error.code).toBe('ACCOUNT_LOCKED');
    // pasados 16 minutos se puede pedir uno nuevo
    const clock = t.app.get(ClockService);
    clock.advance(16 * 60_000);
    try {
      expect((await t.call('POST', `/v1/public/${SLUG}/otp/request`, { body: { phone: p } })).status).toBe(201);
    } finally {
      clock.set(null);
    }
  });

  it('un celular no puede pedir mas de 6 codigos por hora', async () => {
    const p = phone();
    for (let i = 0; i < 6; i++) expect((await t.call('POST', `/v1/public/${SLUG}/otp/request`, { body: { phone: p } })).status).toBe(201);
    expect((await t.call('POST', `/v1/public/${SLUG}/otp/request`, { body: { phone: p } })).status).toBe(429);
  });

  it('el pago simulado y los simuladores de WhatsApp estan apagados', async () => {
    const admin = await t.call('POST', '/v1/auth/login', { body: { email: ADMIN, password: 'demo1234' } });
    const token = admin.json.token as string;
    expect((await t.call('POST', '/v1/messages/simulate-inbound', { token, body: { phone: '+573001112233', body: 'hola' } })).status).toBe(403);
    expect((await t.call('POST', '/v1/webhooks/whatsapp/simulate-button', { token, body: { appointmentId: '00000000-0000-4000-8000-000000000000', action: 'confirm' } })).status).toBe(403);
    expect((await t.call('POST', '/v1/public/appointments/cualquiera.token/pay', { body: {} })).status).toBe(403);
    const cfg = await t.call('GET', '/v1/auth/config');
    expect(cfg.json).toEqual({ demoMode: false });
    const biz = await t.call('GET', `/v1/public/${SLUG}`);
    expect(biz.json.otpMode).toBe('real');
    expect(biz.json.demoMode).toBe(false);
    void isoDate;
  });
});
