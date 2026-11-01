import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIVACY_POLICY_VERSION } from '@agenda/contracts';
import { type DbHandle, and, appointments, auditLog, customers, eq, messageLog } from '@agenda/db';
import { DB_HANDLE } from '../src/core/db.provider';
import { createSecondTenant } from './fixtures';
import { SLUG, type TestCtx, isoDate, startTestApp } from './helpers';

let t: TestCtx;
let handle: DbHandle;
let owner: string;
let svc: any;
let tenantId: string;
const phone = () => '+57314' + String(Math.floor(1000000 + Math.random() * 8999999));

async function hold(day: number) {
  const slots = (await t.call('GET', `/v1/public/${SLUG}/availability?serviceIds=${svc.id}&staffId=any&from=${isoDate(day)}&to=${isoDate(day + 3)}`)).json.slots;
  const h = await t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [svc.id], staffId: 'any', startsAt: slots[0].start } });
  expect(h.status).toBe(201);
  return h.json.holdId as string;
}

async function book(day: number, p: string, extra: Record<string, unknown> = { privacyAccepted: true }) {
  const holdId = await hold(day);
  return t.call('POST', `/v1/public/${SLUG}/bookings`, { body: { holdId, fullName: 'Titular Prueba', phone: p, email: 'titular@example.com', consentWhatsapp: true, otpCode: '123456', ...extra } });
}

beforeAll(async () => {
  t = await startTestApp();
  handle = t.app.get(DB_HANDLE);
  owner = await t.login();
  svc = (await t.call('GET', `/v1/public/${SLUG}`)).json.services.find((s: any) => s.depositCents === 0);
  tenantId = (await t.call('GET', '/v1/auth/me', { token: owner })).json.tenant.id;
});
afterAll(() => t.close());

describe('Ley 1581: consentimiento de tratamiento de datos', () => {
  it('reservar SIN aceptar la politica de privacidad se rechaza en espanol', async () => {
    const r = await book(2, phone(), {});
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('VALIDATION_ERROR');
    expect(r.json.error.message).toMatch(/politica de tratamiento de datos/);
    const explicit = await book(2, phone(), { privacyAccepted: false });
    expect(explicit.status).toBe(400);
  });

  it('al aceptar se registra fecha y version de la politica en el cliente', async () => {
    const p = phone();
    const before = Date.now();
    const r = await book(3, p);
    expect(r.status).toBe(201);
    const [c] = await handle.db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.phoneE164, p)));
    expect(c!.privacyPolicyVersion).toBe(PRIVACY_POLICY_VERSION);
    expect(c!.privacyAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('con PRIVACY_CONSENT_REQUIRED=false no se exige (compatibilidad)', async () => {
    const t2 = await startTestApp({ privacyConsentRequired: false });
    try {
      const svc2 = (await t2.call('GET', `/v1/public/${SLUG}`)).json.services.find((s: any) => s.depositCents === 0);
      const slots = (await t2.call('GET', `/v1/public/${SLUG}/availability?serviceIds=${svc2.id}&staffId=any&from=${isoDate(2)}&to=${isoDate(4)}`)).json.slots;
      const h = await t2.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [svc2.id], staffId: 'any', startsAt: slots[0].start } });
      const r = await t2.call('POST', `/v1/public/${SLUG}/bookings`, { body: { holdId: h.json.holdId, fullName: 'Sin Flag', phone: phone(), consentWhatsapp: false, otpCode: '123456' } });
      expect(r.status).toBe(201);
    } finally {
      await t2.close();
    }
  });
});

describe('Ley 1581: exportar y suprimir datos del cliente (solo owner)', () => {
  it('el rol staff no puede exportar ni suprimir (403)', async () => {
    const staffTok = await t.login('recepcion@belleza-demo.com');
    const id = (await t.call('GET', '/v1/customers', { token: owner })).json[0].id;
    expect((await t.call('GET', `/v1/customers/${id}/export`, { token: staffTok })).status).toBe(403);
    expect((await t.call('DELETE', `/v1/customers/${id}`, { token: staffTok })).status).toBe(403);
    expect((await t.call('GET', `/v1/customers/${id}/export`)).status).toBe(401);
  });

  it('exportar entrega todos los datos como descarga y deja rastro sin datos personales', async () => {
    const p = phone();
    const apt = await book(4, p);
    const cid = apt.json.customerId ?? (await t.call('GET', `/v1/customers?q=${encodeURIComponent(p)}`, { token: owner })).json[0].id;
    await t.call('POST', '/v1/messages/reply', { token: owner, body: { phone: p, body: 'Hola titular' } });
    const r = await t.call('GET', `/v1/customers/${cid}/export`, { token: owner, headers: { 'x-request-id': 'export-corr-0001' } });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.json.customer).toMatchObject({ fullName: 'Titular Prueba', phone: p, email: 'titular@example.com' });
    expect(r.json.consent).toMatchObject({ whatsapp: true, privacyPolicyVersion: PRIVACY_POLICY_VERSION });
    expect(r.json.appointments).toHaveLength(1);
    expect(r.json.appointments[0].services.length).toBeGreaterThan(0);
    expect(r.json.messages.some((m: any) => m.body === 'Hola titular')).toBe(true);

    const rows = await handle.db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityId, cid), eq(auditLog.action, 'customer.export')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.correlationId).toBe('export-corr-0001');
    expect(rows[0]!.userId).toBeTruthy();
    const dump = JSON.stringify(rows[0]);
    expect(dump).not.toContain(p);
    expect(dump).not.toContain('Titular');
  });

  it('suprimir con citas vigentes -> 409; con force cancela, anonimiza y borra mensajes', async () => {
    const p = phone();
    const apt = await book(5, p);
    const aptId = apt.json.id as string;
    const cid = (await t.call('GET', `/v1/customers?q=${encodeURIComponent(p)}`, { token: owner })).json[0].id as string;
    await t.call('POST', '/v1/messages/reply', { token: owner, body: { phone: p, body: 'mensaje a borrar' } });

    const blocked = await t.call('DELETE', `/v1/customers/${cid}`, { token: owner });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe('HAS_FUTURE_APPOINTMENTS');
    expect((await t.call('GET', `/v1/customers/${cid}`, { token: owner })).status).toBe(200);

    const done = await t.call('DELETE', `/v1/customers/${cid}?force=true`, { token: owner });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ deleted: true, canceledAppointments: 1 });

    // el cliente ya no existe para la API y sus datos personales no quedan en BD
    expect((await t.call('GET', `/v1/customers/${cid}`, { token: owner })).status).toBe(404);
    expect((await t.call('GET', `/v1/customers/${cid}/export`, { token: owner })).status).toBe(404);
    const [c] = await handle.db.select().from(customers).where(eq(customers.id, cid));
    expect(c).toMatchObject({ fullName: 'Cliente eliminado', email: null, notesEnc: null, consentWhatsapp: false, privacyAcceptedAt: null });
    expect(c!.phoneE164).not.toBe(p);
    expect(c!.deletedAt).toBeTruthy();
    expect(JSON.stringify(c)).not.toContain(p);
    const msgs = await handle.db.select().from(messageLog).where(and(eq(messageLog.tenantId, tenantId), eq(messageLog.phoneE164, p)));
    expect(msgs).toHaveLength(0);
    // la cita se conserva (sin datos personales) y quedo cancelada
    const [row] = await handle.db.select().from(appointments).where(eq(appointments.id, aptId));
    expect(row!.status).toBe('canceled');
    expect(row!.notes).toBeNull();
    expect((await t.call('GET', `/v1/customers?q=${encodeURIComponent(p)}`, { token: owner })).json).toEqual([]);

    const audit = await handle.db.select().from(auditLog).where(and(eq(auditLog.entityId, cid), eq(auditLog.action, 'customer.erase')));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain(p);

    // el mismo celular puede volver a reservar como un cliente nuevo
    const again = await book(6, p);
    expect(again.status).toBe(201);
    const fresh = (await t.call('GET', `/v1/customers?q=${encodeURIComponent(p)}`, { token: owner })).json;
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).not.toBe(cid);
  });

  it('otro negocio no puede exportar ni suprimir clientes ajenos', async () => {
    const fx = await createSecondTenant(handle, 'negocio-privacidad');
    const other = (await t.call('POST', '/v1/auth/login', { body: { email: fx.email, password: fx.password } })).json.token;
    const id = (await t.call('GET', '/v1/customers', { token: owner })).json[0].id;
    expect((await t.call('GET', `/v1/customers/${id}/export`, { token: other })).status).toBe(404);
    expect((await t.call('DELETE', `/v1/customers/${id}?force=true`, { token: other })).status).toBe(404);
    expect((await t.call('GET', `/v1/customers/${id}`, { token: owner })).status).toBe(200);
  });
});
