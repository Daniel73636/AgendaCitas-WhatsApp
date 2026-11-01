import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, appointments, eq, messageLog, uuidv7 } from '@agenda/db';
import { DB_HANDLE } from '../src/core/db.provider';
import { EventsService } from '../src/core/events.service';
import { signToken } from '../src/common/tokens';
import { type TenantFixture, createSecondTenant } from './fixtures';
import { SLUG, type TestCtx, isoDate, startTestApp } from './helpers';

/**
 * Aislamiento entre negocios: el negocio B nunca ve ni modifica datos del negocio A (belleza-demo),
 * ni al reves, por ninguna ruta privada ni publica.
 */
let t: TestCtx;
let handle: DbHandle;
let a: string; // token owner de A
let b: string; // token owner de B
let fx: TenantFixture;
// recursos de A
let aService: any;
let aStaff: any;
let aCustomer: any;
let aApt: { id: string; tenantId: string; customerId: string | null };
let aOffId: string;

const phone = () => '+57313' + String(Math.floor(1000000 + Math.random() * 8999999));
const call = (m: string, u: string, token: string, body?: unknown, headers?: Record<string, string>) =>
  t.call(m, u, { token, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });

beforeAll(async () => {
  t = await startTestApp();
  handle = t.app.get(DB_HANDLE);
  a = await t.login();
  fx = await createSecondTenant(handle);
  const lb = await t.call('POST', '/v1/auth/login', { body: { email: fx.email, password: fx.password } });
  expect(lb.status).toBe(200);
  b = lb.json.token;

  aService = (await call('GET', '/v1/services', a)).json[0];
  aStaff = (await call('GET', '/v1/staff', a)).json[0];
  aCustomer = (await call('GET', '/v1/customers', a)).json[0];
  const aTenantId = (await call('GET', '/v1/auth/me', a)).json.tenant.id;
  const [apt] = await handle.db.select().from(appointments).where(eq(appointments.tenantId, aTenantId)).limit(1);
  aApt = apt!;
  const off = await call('POST', '/v1/time-off', a, { staffId: aStaff.id, startsAt: new Date(Date.now() + 40 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 41 * 86_400_000).toISOString(), reason: 'Vacaciones A' });
  expect(off.status).toBe(201);
  aOffId = off.json.id;
});

afterAll(async () => {
  await t.close();
});

describe('aislamiento: listados', () => {
  it('B solo ve sus propios datos en todos los listados', async () => {
    const svc = (await call('GET', '/v1/services', b)).json;
    expect(svc.map((s: any) => s.id)).toEqual([fx.serviceId]);
    const stf = (await call('GET', '/v1/staff', b)).json;
    expect(stf.map((s: any) => s.id)).toEqual([fx.staffId]);
    const cus = (await call('GET', '/v1/customers', b)).json;
    expect(cus.map((c: any) => c.id)).toEqual([fx.customerId]);
    const from = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const apts = (await call('GET', `/v1/appointments?from=${from}&to=${to}`, b)).json;
    expect(apts.map((x: any) => x.id)).toEqual([fx.appointmentId]);
    expect((await call('GET', '/v1/time-off', b)).json).toEqual([]);
    expect((await call('GET', '/v1/schedules', b)).json.every((s: any) => s.staffId === fx.staffId)).toBe(true);
    expect((await call('GET', '/v1/waitlist', b)).json).toEqual([]);
    expect((await call('GET', '/v1/messages', b)).json).toEqual([]);
  });

  it('los reportes de B solo cuentan sus citas', async () => {
    const s = await call('GET', `/v1/reports/summary?from=${isoDate(-60)}&to=${isoDate(90)}`, b);
    expect(s.status).toBe(200);
    expect(s.json.totals.appointments).toBe(1);
    const sa = await call('GET', `/v1/reports/summary?from=${isoDate(-60)}&to=${isoDate(90)}`, a);
    expect(sa.json.totals.appointments).toBeGreaterThan(50);
  });

  it('A tampoco ve nada de B', async () => {
    expect((await call('GET', '/v1/customers', a)).json.map((c: any) => c.id)).not.toContain(fx.customerId);
    expect((await call('GET', '/v1/services', a)).json.map((s: any) => s.id)).not.toContain(fx.serviceId);
    expect((await call('GET', '/v1/staff', a)).json.map((s: any) => s.id)).not.toContain(fx.staffId);
    expect((await call('GET', `/v1/appointments/${fx.appointmentId}`, a)).status).toBe(404);
  });

  it('mensajes: B no ve conversaciones ni hilos de A', async () => {
    const [m] = await handle.db.select().from(messageLog).where(eq(messageLog.tenantId, aApt.tenantId)).limit(1);
    expect(m).toBeTruthy();
    expect((await call('GET', `/v1/messages/thread?phone=${encodeURIComponent(m!.phoneE164)}`, b)).json).toEqual([]);
    expect((await call('GET', `/v1/appointments/${aApt.id}/messages`, b)).json).toEqual([]);
  });
});

describe('aislamiento: acceso directo por id (todo debe ser 404)', () => {
  it('clientes: ver, editar, linea de tiempo, exportar, suprimir, unificar', async () => {
    expect((await call('GET', `/v1/customers/${aCustomer.id}`, b)).status).toBe(404);
    expect((await call('PATCH', `/v1/customers/${aCustomer.id}`, b, { fullName: 'Hackeado' })).status).toBe(404);
    expect((await call('GET', `/v1/customers/${aCustomer.id}/timeline`, b)).status).toBe(404);
    expect((await call('GET', `/v1/customers/${aCustomer.id}/export`, b)).status).toBe(404);
    expect((await call('DELETE', `/v1/customers/${aCustomer.id}?force=true`, b)).status).toBe(404);
    expect((await call('POST', `/v1/customers/${aCustomer.id}/merge`, b, { intoCustomerId: fx.customerId })).status).toBe(404);
    expect((await call('POST', `/v1/customers/${fx.customerId}/merge`, b, { intoCustomerId: aCustomer.id })).status).toBe(404);
    const still = await call('GET', `/v1/customers/${aCustomer.id}`, a);
    expect(still.json.fullName).toBe(aCustomer.fullName);
  });

  it('citas: ver, editar, check-in, no-show, completar, cancelar, anticipo', async () => {
    const id = aApt.id;
    const [snapshot] = await handle.db.select().from(appointments).where(eq(appointments.id, id));
    expect((await call('GET', `/v1/appointments/${id}`, b)).status).toBe(404);
    expect((await call('PATCH', `/v1/appointments/${id}`, b, { notes: 'x' })).status).toBe(404);
    for (const action of ['check-in', 'no-show', 'complete', 'cancel', 'deposit']) {
      expect((await call('POST', `/v1/appointments/${id}/${action}`, b, {})).status).toBe(404);
    }
    const [row] = await handle.db.select().from(appointments).where(eq(appointments.id, id));
    expect(row).toEqual(snapshot); // ni estado, ni notas, ni version cambiaron
  });

  it('servicios, profesionales, horarios y bloqueos de A no se pueden tocar desde B', async () => {
    expect((await call('PATCH', `/v1/services/${aService.id}`, b, { name: 'Hack' })).status).toBe(404);
    expect((await call('DELETE', `/v1/services/${aService.id}`, b)).status).toBe(404);
    expect((await call('PATCH', `/v1/staff/${aStaff.id}`, b, { displayName: 'Hack' })).status).toBe(404);
    expect((await call('PUT', `/v1/schedules/${aStaff.id}`, b, { blocks: [] })).status).toBe(404);
    expect((await call('DELETE', `/v1/time-off/${aOffId}`, b)).status).toBe(404);
    expect((await call('GET', '/v1/services', a)).json.find((s: any) => s.id === aService.id).name).toBe(aService.name);
    expect((await call('GET', '/v1/time-off', a)).json.some((o: any) => o.id === aOffId)).toBe(true);
    expect((await call('GET', '/v1/schedules', a)).json.some((s: any) => s.staffId === aStaff.id)).toBe(true);
  });
});

describe('aislamiento: vinculos cruzados (los ids de otro negocio se rechazan)', () => {
  it('crear profesional con servicios de A -> 404 y no queda profesional huerfano', async () => {
    const before = (await call('GET', '/v1/staff', b)).json.length;
    const r = await call('POST', '/v1/staff', b, { displayName: 'Intruso', services: [{ serviceId: aService.id }] });
    expect(r.status).toBe(404);
    expect((await call('GET', '/v1/staff', b)).json).toHaveLength(before);
  });

  it('editar profesional propio vinculando un servicio de A -> 404', async () => {
    const r = await call('PATCH', `/v1/staff/${fx.staffId}`, b, { services: [{ serviceId: aService.id }] });
    expect(r.status).toBe(404);
  });

  it('crear/editar servicio propio vinculando profesionales de A -> 404', async () => {
    expect((await call('POST', '/v1/services', b, { name: 'Servicio Cruzado', durationMin: 30, priceCents: 1000, staffIds: [aStaff.id] })).status).toBe(404);
    expect((await call('PATCH', `/v1/services/${fx.serviceId}`, b, { staffIds: [aStaff.id] })).status).toBe(404);
  });

  it('bloqueo de agenda con staffId de A -> 404', async () => {
    const r = await call('POST', '/v1/time-off', b, { staffId: aStaff.id, startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 11 * 86_400_000).toISOString() });
    expect(r.status).toBe(404);
  });

  it('responder por WhatsApp con appointmentId de A -> 404', async () => {
    const r = await call('POST', '/v1/messages/reply', b, { phone: phone(), body: 'hola', appointmentId: aApt.id });
    expect(r.status).toBe(404);
  });

  it('cita manual con profesional, servicio o cliente de A -> 404', async () => {
    const startsAt = new Date(Date.now() + 6 * 86_400_000).toISOString();
    const base = { startsAt, sendConfirmation: false, ignoreSchedule: true };
    expect((await call('POST', '/v1/appointments', b, { ...base, newCustomer: { fullName: 'X Y', phone: phone() }, serviceIds: [fx.serviceId], staffId: aStaff.id })).status).toBe(404);
    expect((await call('POST', '/v1/appointments', b, { ...base, newCustomer: { fullName: 'X Y', phone: phone() }, serviceIds: [aService.id], staffId: fx.staffId })).status).toBe(404);
    expect((await call('POST', '/v1/appointments', b, { ...base, customerId: aCustomer.id, serviceIds: [fx.serviceId], staffId: fx.staffId })).status).toBe(404);
  });

  it('disponibilidad privada con servicios de A -> 404', async () => {
    const r = await call('GET', `/v1/availability?serviceIds=${aService.id}&staffId=any&from=${isoDate(3)}`, b);
    expect(r.status).toBe(404);
  });
});

describe('aislamiento: rutas publicas por slug', () => {
  it('la pagina publica de B solo muestra servicios y equipo de B', async () => {
    const biz = await t.call('GET', `/v1/public/${fx.slug}`);
    expect(biz.json.services.map((s: any) => s.id)).toEqual([fx.serviceId]);
    expect(biz.json.staff.map((s: any) => s.id)).toEqual([fx.staffId]);
    expect(biz.json.tenant.name).toBe('Otro Negocio');
  });

  it('disponibilidad, hold y lista de espera de B con ids de A -> 404', async () => {
    expect((await t.call('GET', `/v1/public/${fx.slug}/availability?serviceIds=${aService.id}&staffId=any&from=${isoDate(3)}`)).status).toBe(404);
    expect((await t.call('POST', `/v1/public/${fx.slug}/holds`, { body: { serviceIds: [aService.id], staffId: 'any', startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() } })).status).toBe(404);
    const wl = (staffId: string | null, serviceId: string) =>
      t.call('POST', `/v1/public/${fx.slug}/waitlist`, {
        body: { fullName: 'En Espera', phone: phone(), serviceId, staffId, windowStart: new Date(Date.now() + 86_400_000).toISOString(), windowEnd: new Date(Date.now() + 2 * 86_400_000).toISOString(), privacyAccepted: true },
      });
    expect((await wl(null, aService.id)).status).toBe(404);
    expect((await wl(aStaff.id, fx.serviceId)).status).toBe(404); // staffId ajeno
    expect((await wl(null, fx.serviceId)).status).toBe(201);
  });

  it('un hold de A no se puede confirmar ni liberar usando el slug de B', async () => {
    const list = (await t.call('GET', `/v1/public/${SLUG}/availability?serviceIds=${aService.id}&staffId=any&from=${isoDate(4)}&to=${isoDate(6)}`)).json.slots;
    const hold = await t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [aService.id], staffId: 'any', startsAt: list[0].start } });
    expect(hold.status).toBe(201);
    const p = phone();
    const book = await t.call('POST', `/v1/public/${fx.slug}/bookings`, { body: { holdId: hold.json.holdId, fullName: 'Ladron', phone: p, consentWhatsapp: true, privacyAccepted: true, otpCode: '123456' } });
    expect(book.status).toBe(404);
    expect((await t.call('DELETE', `/v1/public/${fx.slug}/holds/${hold.json.holdId}`)).json.released).toBe(false);
    const [row] = await handle.db.select().from(appointments).where(eq(appointments.id, hold.json.holdId));
    expect(row!.status).toBe('held');
    expect((await t.call('DELETE', `/v1/public/${SLUG}/holds/${hold.json.holdId}`)).json.released).toBe(true);
  });

  it('un token OTP emitido para A no sirve para reservar en B', async () => {
    const p = phone();
    await t.call('POST', `/v1/public/${SLUG}/otp/request`, { body: { phone: p } });
    const ver = await t.call('POST', `/v1/public/${SLUG}/otp/verify`, { body: { phone: p, code: '123456' } });
    expect(ver.status).toBe(201);
    const slots = (await t.call('GET', `/v1/public/${fx.slug}/availability?serviceIds=${fx.serviceId}&staffId=any&from=${isoDate(3)}&to=${isoDate(5)}`)).json.slots;
    expect(slots.length).toBeGreaterThan(0);
    const hold = await t.call('POST', `/v1/public/${fx.slug}/holds`, { body: { serviceIds: [fx.serviceId], staffId: 'any', startsAt: slots[0].start } });
    expect(hold.status).toBe(201);
    const book = await t.call('POST', `/v1/public/${fx.slug}/bookings`, { body: { holdId: hold.json.holdId, fullName: 'Cruce', phone: p, consentWhatsapp: true, privacyAccepted: true, otpToken: ver.json.otpToken } });
    expect(book.status).toBe(422);
    expect(book.json.error.code).toBe('OTP_INVALID');
  });
});

describe('aislamiento: sesiones y eventos', () => {
  it('un token con el tenant alterado o firmado con otra clave se rechaza (401)', async () => {
    const [payload] = [JSON.parse(Buffer.from(a.split('.')[0]!, 'base64url').toString())];
    const forged = a.split('.')[0]!.replace(/.*/, Buffer.from(JSON.stringify({ ...payload, tid: fx.tenantId })).toString('base64url')) + '.' + a.split('.')[1];
    expect((await call('GET', '/v1/customers', forged)).status).toBe(401);
    const wrongKey = signToken({ sub: payload.sub, tid: fx.tenantId, role: 'owner' }, 'otra-clave-que-no-es-la-del-servidor-123456', 3600);
    expect((await call('GET', '/v1/customers', wrongKey)).status).toBe(401);
  });

  it('el rol del token no escala: el staff de A no puede ser owner en B', async () => {
    const staffTok = await t.login('recepcion@belleza-demo.com');
    expect((await call('GET', `/v1/customers/${fx.customerId}`, staffTok)).status).toBe(404);
    expect((await call('PATCH', '/v1/tenant', staffTok, { name: 'x' })).status).toBe(403);
  });

  it('el bus SSE solo entrega eventos del propio tenant (y no los reanuda cruzados)', () => {
    const events = t.app.get(EventsService);
    const got: Record<string, string[]> = { a: [], b: [] };
    const subA = events.stream(aApt.tenantId).subscribe((e) => got.a!.push(e.type + ':' + (e.data as any).data?.id));
    const subB = events.stream(fx.tenantId).subscribe((e) => got.b!.push(e.type + ':' + (e.data as any).data?.id));
    const evA = events.emit(aApt.tenantId, 'appointment.created', { id: 'solo-a' });
    events.emit(fx.tenantId, 'appointment.created', { id: 'solo-b' });
    subA.unsubscribe();
    subB.unsubscribe();
    expect(got.a).toContain('appointment.created:solo-a');
    expect(got.a).not.toContain('appointment.created:solo-b');
    expect(got.b).toContain('appointment.created:solo-b');
    expect(got.b).not.toContain('appointment.created:solo-a');
    const replay: string[] = [];
    events.stream(fx.tenantId, evA.id - 1).subscribe((e) => replay.push((e.data as any).data?.id)).unsubscribe();
    expect(replay).not.toContain('solo-a');
  });
});

describe('aislamiento: defensa en la base de datos', () => {
  it('el UPDATE de merge/anulacion siempre acota por tenant (B no altera clientes de A)', async () => {
    const before = await call('GET', `/v1/customers/${aCustomer.id}`, a);
    await call('POST', `/v1/customers/${aCustomer.id}/merge`, b, { intoCustomerId: uuidv7() });
    const after = await call('GET', `/v1/customers/${aCustomer.id}`, a);
    expect(after.status).toBe(200);
    expect(after.json).toEqual(before.json);
  });
});
