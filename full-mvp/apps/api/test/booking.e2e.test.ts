import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_HANDLE } from '../src/core/db.provider';
import { ClockService } from '../src/core/clock.service';
import { type DbHandle, appointments, eq, isExclusionViolation, reminderJobs, and, inArray, uuidv7, messageLog } from '@agenda/db';
import { SLUG, type TestCtx, isoDate, startTestApp } from './helpers';

let t: TestCtx;
let admin: string;
let svcCorte: any;
let svcColor: any;
let staffCamila: any;
let handle: DbHandle;
let clock: ClockService;

const phone = () => '+57311' + String(Math.floor(1000000 + Math.random() * 8999999));

async function slots(serviceIds: string[], staffId: string, from: number, to: number) {
  const r = await t.call('GET', `/v1/public/${SLUG}/availability?serviceIds=${serviceIds.join(',')}&staffId=${staffId}&from=${isoDate(from)}&to=${isoDate(to)}`);
  expect(r.status).toBe(200);
  return r.json.slots as Array<{ start: string; end: string; staffId: string; staffIds: string[]; date: string }>;
}

async function bookFlow(startsAt: string, serviceIds: string[], staffId = 'any', who = { name: 'Cliente Test', phone: phone() }) {
  const hold = await t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds, staffId, startsAt } });
  if (hold.status !== 201) return { hold, book: undefined as any, phone: who.phone };
  await t.call('POST', `/v1/public/${SLUG}/otp/request`, { body: { phone: who.phone } });
  const ver = await t.call('POST', `/v1/public/${SLUG}/otp/verify`, { body: { phone: who.phone, code: '123456' } });
  const book = await t.call('POST', `/v1/public/${SLUG}/bookings`, {
    body: { holdId: hold.json.holdId, fullName: who.name, phone: who.phone, consentWhatsapp: true, privacyAccepted: true, otpToken: ver.json.otpToken },
  });
  return { hold, book, phone: who.phone };
}

beforeAll(async () => {
  t = await startTestApp();
  admin = await t.login();
  handle = t.app.get(DB_HANDLE);
  clock = t.app.get(ClockService);
  const biz = await t.call('GET', `/v1/public/${SLUG}`);
  svcCorte = biz.json.services.find((s: any) => s.name.startsWith('Corte de cabello'));
  svcColor = biz.json.services.find((s: any) => s.name.startsWith('Coloraci'));
  staffCamila = biz.json.staff.find((s: any) => s.displayName.startsWith('Camila'));
});

afterAll(async () => {
  await t.close();
});

describe('autenticacion y permisos', () => {
  it('rutas privadas exigen sesion', async () => {
    expect((await t.call('GET', '/v1/customers')).status).toBe(401);
    expect((await t.call('GET', '/v1/customers', { token: 'basura' })).status).toBe(401);
  });
  it('login incorrecto -> 401 y correcto -> token', async () => {
    expect((await t.call('POST', '/v1/auth/login', { body: { email: 'admin@belleza-demo.com', password: 'mal' } })).status).toBe(401);
    expect(admin).toBeTruthy();
  });
  it('rol "staff" no puede editar ajustes (403) pero si ver citas', async () => {
    const staffToken = await t.login('recepcion@belleza-demo.com');
    expect((await t.call('PATCH', '/v1/tenant', { token: staffToken, body: { name: 'Hack' } })).status).toBe(403);
    expect((await t.call('GET', '/v1/tenant', { token: staffToken })).status).toBe(200);
  });
});

describe('flujo publico completo', () => {
  it('hold -> OTP -> reserva -> enlace -> reprogramar -> cancelar', async () => {
    const list = await slots([svcCorte.id], 'any', 2, 6);
    expect(list.length).toBeGreaterThan(10);
    const { hold, book } = await bookFlow(list[0]!.start, [svcCorte.id]);
    expect(hold.status).toBe(201);
    expect(hold.json.totalCents).toBeGreaterThan(0);
    expect(Number.isInteger(hold.json.totalCents)).toBe(true);
    expect(book.status).toBe(201);
    expect(book.json.status).toBe('confirmed');
    const token = book.json.token as string;

    // el hueco ya no se ofrece
    const after = await slots([svcCorte.id], book.json.staffId, 2, 6);
    expect(after.find((s) => s.start === list[0]!.start)).toBeUndefined();

    // reprogramar por enlace
    const target = list.find((s) => s.staffIds.includes(book.json.staffId) && Date.parse(s.start) > Date.parse(list[0]!.end) + 3_600_000)!;
    const re = await t.call('POST', `/v1/public/appointments/${token}/reschedule`, { body: { startsAt: target.start, staffId: book.json.staffId } });
    expect(re.status).toBe(201);
    expect(re.json.startsAt).toBe(target.start);

    // el hueco original vuelve a estar libre
    const freed = await slots([svcCorte.id], book.json.staffId, 2, 6);
    expect(freed.find((s) => s.start === list[0]!.start)).toBeDefined();

    const cancel = await t.call('POST', `/v1/public/appointments/${token}/cancel`, { body: {} });
    expect(cancel.status).toBe(201);
    expect(cancel.json.status).toBe('canceled');
    expect((await t.call('POST', `/v1/public/appointments/${token}/cancel`, { body: {} })).status).toBe(409);
  });

  it('OTP: codigo incorrecto rechazado, demo 123456 aceptado, reserva sin OTP rechazada', async () => {
    const list = await slots([svcCorte.id], 'any', 3, 6);
    const p = phone();
    const hold = await t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [svcCorte.id], staffId: 'any', startsAt: list[3]!.start } });
    expect(hold.status).toBe(201);
    expect((await t.call('POST', `/v1/public/${SLUG}/otp/verify`, { body: { phone: p, code: '999999' } })).json.error.code).toBe('OTP_INVALID');
    const noOtp = await t.call('POST', `/v1/public/${SLUG}/bookings`, { body: { holdId: hold.json.holdId, fullName: 'Sin Otp', phone: p, consentWhatsapp: true, privacyAccepted: true } });
    expect(noOtp.json.error.code).toBe('OTP_REQUIRED');
    const bot = await t.call('POST', `/v1/public/${SLUG}/bookings`, { body: { holdId: hold.json.holdId, fullName: 'Bot', phone: p, consentWhatsapp: true, privacyAccepted: true, otpCode: '123456', website: 'http://spam' } });
    expect(bot.status).toBe(400);
    const good = await t.call('POST', `/v1/public/${SLUG}/bookings`, { body: { holdId: hold.json.holdId, fullName: 'Con Otp', phone: p, consentWhatsapp: true, privacyAccepted: true, otpCode: '123456' } });
    expect(good.status).toBe(201);
  });

  it('Idempotency-Key: reenviar la misma reserva no crea otra cita', async () => {
    const list = await slots([svcCorte.id], 'any', 4, 7);
    const p = phone();
    const hold = await t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [svcCorte.id], staffId: 'any', startsAt: list[8]!.start }, headers: { 'idempotency-key': 'h1' } });
    const hold2 = await t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [svcCorte.id], staffId: 'any', startsAt: list[8]!.start }, headers: { 'idempotency-key': 'h1' } });
    expect(hold2.json.holdId).toBe(hold.json.holdId);
    const body = { holdId: hold.json.holdId, fullName: 'Doble Clic', phone: p, consentWhatsapp: true, privacyAccepted: true, otpCode: '123456' };
    const [a, b] = await Promise.all([
      t.call('POST', `/v1/public/${SLUG}/bookings`, { body, headers: { 'idempotency-key': 'b1' } }),
      t.call('POST', `/v1/public/${SLUG}/bookings`, { body, headers: { 'idempotency-key': 'b1' } }),
    ]);
    expect(a.json.id).toBe(b.json.id);
    const mine = await handle.db.select().from(appointments).where(eq(appointments.id, a.json.id));
    expect(mine).toHaveLength(1);
  });

  it('un hold que vence libera el hueco (expiracion perezosa)', async () => {
    const list = await slots([svcCorte.id], staffCamila.id, 5, 9);
    const hold = await t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [svcCorte.id], staffId: staffCamila.id, startsAt: list[10]!.start } });
    expect(hold.status).toBe(201);
    const during = await slots([svcCorte.id], staffCamila.id, 5, 9);
    expect(during.find((s) => s.start === list[10]!.start)).toBeUndefined();
    clock.advance(6 * 60_000); // pasan 6 minutos > 5 de hold
    const afterExpiry = await slots([svcCorte.id], staffCamila.id, 5, 9);
    clock.set(null);
    expect(afterExpiry.find((s) => s.start === list[10]!.start)).toBeDefined();
    const row = await handle.db.select().from(appointments).where(eq(appointments.id, hold.json.holdId));
    expect(row[0]!.status).toBe('held'); // el reloj real no avanzo: la fila sigue; la disponibilidad ya la ignora
  });

  it('servicio con anticipo -> pending -> pago simulado -> confirmed', async () => {
    const list = await slots([svcColor.id], 'any', 3, 40);
    const { book } = await bookFlow(list[0]!.start, [svcColor.id]);
    expect(book.json.status).toBe('pending');
    expect(book.json.depositRequiredCents).toBe(6_000_000);
    const paid = await t.call('POST', `/v1/public/appointments/${book.json.token}/pay`, { body: {} });
    expect(paid.json.status).toBe('confirmed');
    expect(paid.json.depositPaidCents).toBe(6_000_000);
  });

  it('cancelar dentro de la ventana de politica -> 422 POLICY_VIOLATION', async () => {
    const soon = new Date(Date.now() + 90 * 60_000);
    const m = await t.call('POST', '/v1/appointments', {
      token: admin,
      body: { newCustomer: { fullName: 'Cita Proxima', phone: phone() }, serviceIds: [svcCorte.id], staffId: staffCamila.id, startsAt: soon.toISOString(), ignoreSchedule: true, sendConfirmation: false },
    });
    expect(m.status).toBe(201);
    const pub = await t.call('GET', `/v1/appointments/${m.json.id}`, { token: admin });
    const cancel = await t.call('POST', `/v1/public/appointments/${pub.json.token}/cancel`, { body: {} });
    expect(cancel.status).toBe(422);
    expect(cancel.json.error.code).toBe('POLICY_VIOLATION');
  });
});

describe('integridad: nada se solapa (EXCLUDE) y concurrencia', () => {
  it('la base rechaza dos citas solapadas del mismo profesional (23P01), incluso saltandose la API', async () => {
    const list = await slots([svcCorte.id], staffCamila.id, 8, 12);
    const { hold } = await bookFlow(list[2]!.start, [svcCorte.id], staffCamila.id);
    const [apt] = await handle.db.select().from(appointments).where(eq(appointments.id, hold.json.holdId));
    let error: unknown;
    try {
      await handle.db.insert(appointments).values({
        id: uuidv7(), tenantId: apt!.tenantId, customerId: null, staffId: apt!.staffId, status: 'confirmed',
        occupiedStart: new Date(apt!.occupiedStart.getTime() + 10 * 60_000), occupiedEnd: new Date(apt!.occupiedEnd.getTime() + 10 * 60_000),
        startsAt: apt!.startsAt, endsAt: apt!.endsAt, source: 'manual', totalCents: 1,
      });
    } catch (e) {
      error = e;
    }
    expect(isExclusionViolation(error)).toBe(true);
    // otro profesional en el mismo horario SI es posible; y citas canceladas no bloquean
    const ok = await handle.db.insert(appointments).values({
      id: uuidv7(), tenantId: apt!.tenantId, customerId: null, staffId: apt!.staffId, status: 'canceled',
      occupiedStart: apt!.occupiedStart, occupiedEnd: apt!.occupiedEnd, startsAt: apt!.startsAt, endsAt: apt!.endsAt, source: 'manual', totalCents: 1,
    }).returning({ id: appointments.id });
    expect(ok).toHaveLength(1);
  });

  it('200 reservas simultaneas sobre 20 huecos: exactamente 20 confirmadas, 0 solapadas, 180 SLOT_TAKEN', async () => {
    const all = await slots([svcCorte.id], staffCamila.id, 9, 30);
    // 20 huecos que no se pisan entre si (servicio 45 min + 5 colchon)
    const chosen: typeof all = [];
    let lastEnd = 0;
    for (const s of all) {
      const st = Date.parse(s.start);
      if (st >= lastEnd + 60 * 60_000) {
        chosen.push(s);
        lastEnd = Date.parse(s.end);
      }
      if (chosen.length === 20) break;
    }
    expect(chosen).toHaveLength(20);
    const requests = chosen.flatMap((s) => Array.from({ length: 10 }, () => s));
    const results = await Promise.all(
      requests.map((s) => t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [svcCorte.id], staffId: staffCamila.id, startsAt: s.start } })),
    );
    const okCount = results.filter((r) => r.status === 201).length;
    const taken = results.filter((r) => r.status === 409 && r.json.error.code === 'SLOT_TAKEN');
    expect(okCount).toBe(20);
    expect(taken).toHaveLength(180);
    expect(taken.every((r) => Array.isArray(r.json.error.alternatives))).toBe(true);
    // ninguna solapada en la base
    const held = await handle.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.staffId, staffCamila.id), inArray(appointments.id, results.filter((r) => r.status === 201).map((r) => r.json.holdId))));
    const sorted = held.sort((a, b) => a.occupiedStart.getTime() - b.occupiedStart.getTime());
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.occupiedStart.getTime()).toBeGreaterThanOrEqual(sorted[i - 1]!.occupiedEnd.getTime());
  });

  it('mover una cita del panel sobre otra ocupada -> 409 SLOT_TAKEN; If-Match viejo -> 412', async () => {
    const list = await slots([svcCorte.id], staffCamila.id, 31, 40);
    const mk = async (s: { start: string }) =>
      (await t.call('POST', '/v1/appointments', { token: admin, body: { newCustomer: { fullName: 'Panel', phone: phone() }, serviceIds: [svcCorte.id], staffId: staffCamila.id, startsAt: s.start, sendConfirmation: false } })).json;
    const a = await mk(list[0]!);
    const b = await mk(list[8]!);
    const clash = await t.call('PATCH', `/v1/appointments/${b.id}`, { token: admin, body: { startsAt: a.startsAt, ignoreSchedule: true }, headers: { 'if-match': String(b.version) } });
    expect(clash.status).toBe(409);
    expect(clash.json.error.code).toBe('SLOT_TAKEN');
    const stale = await t.call('PATCH', `/v1/appointments/${b.id}`, { token: admin, body: { notes: 'nota' }, headers: { 'if-match': '999' } });
    expect(stale.status).toBe(412);
    const okNote = await t.call('PATCH', `/v1/appointments/${b.id}`, { token: admin, body: { notes: 'nota' }, headers: { 'if-match': String(b.version) } });
    expect(okNote.status).toBe(200);
    expect(okNote.json.version).toBe(b.version + 1);
  });
});

describe('estados del panel', () => {
  it('check-in -> completar con cobro; no-show suma al cliente; transiciones invalidas -> 409', async () => {
    const list = await slots([svcCorte.id], staffCamila.id, 41, 50);
    const mk = async (s: { start: string }, name: string) =>
      (await t.call('POST', '/v1/appointments', { token: admin, body: { newCustomer: { fullName: name, phone: phone() }, serviceIds: [svcCorte.id], staffId: staffCamila.id, startsAt: s.start, sendConfirmation: false } })).json;
    const a = await mk(list[0]!, 'Cobro Uno');
    expect((await t.call('POST', `/v1/appointments/${a.id}/check-in`, { token: admin })).json.status).toBe('in_progress');
    const done = await t.call('POST', `/v1/appointments/${a.id}/complete`, { token: admin, body: { paymentMethod: 'card' } });
    expect(done.json.status).toBe('completed');
    expect(done.json.paidCents).toBe(a.totalCents);
    expect(Number.isInteger(done.json.paidCents)).toBe(true);
    expect((await t.call('POST', `/v1/appointments/${a.id}/cancel`, { token: admin, body: {} })).json.error.code).toBe('INVALID_TRANSITION');

    const b = await mk(list[8]!, 'Faltador');
    const ns = await t.call('POST', `/v1/appointments/${b.id}/no-show`, { token: admin });
    expect(ns.json.status).toBe('no_show');
    const cust = await t.call('GET', `/v1/customers/${b.customerId}`, { token: admin });
    expect(cust.json.noShowCount).toBe(1);
  });

  it('busqueda difusa de clientes tolera tildes y errores de tipeo', async () => {
    const r = await t.call('GET', '/v1/customers?q=gomes', { token: admin });
    expect(r.json.map((c: any) => c.fullName)).toContain('Laura Gomez');
    const phoneSearch = await t.call('GET', '/v1/customers?q=3004445566', { token: admin });
    expect(phoneSearch.json[0].fullName).toBe('Juan Pablo Torres');
    expect(phoneSearch.json[0].notes).toContain('Solicitar anticipo'); // notas cifradas en BD, descifradas en la API
  });
});

describe('recordatorios con reloj simulado', () => {
  it('confirmar crea la secuencia exacta; reprogramar la reemplaza; cancelar deja cero pendientes', async () => {
    const list = await slots([svcCorte.id], staffCamila.id, 12, 20);
    const { book } = await bookFlow(list[0]!.start, [svcCorte.id], staffCamila.id);
    const id = book.json.id as string;
    const keys = async () =>
      (await handle.db.select().from(reminderJobs).where(and(eq(reminderJobs.appointmentId, id), eq(reminderJobs.status, 'pending')))).sort((a, b) => a.runAt.getTime() - b.runAt.getTime());

    // inmediato: confirmacion enviada (outbox procesado); pendientes: r24 y r2 (r6 desactivado por politica)
    await new Promise((r) => setTimeout(r, 300));
    const pending = await keys();
    expect(pending.map((j) => j.jobKey)).toEqual([`apt:${id}:r24`, `apt:${id}:r2`]);
    const msgs = await t.call('GET', `/v1/appointments/${id}/messages`, { token: admin });
    expect(msgs.json.filter((m: any) => m.template === 'appointment_confirmation')).toHaveLength(1);

    // reprogramar: mismos jobKeys, nuevas fechas, sin segunda confirmacion
    const target = list.find((s) => Date.parse(s.start) > Date.parse(list[0]!.start) + 2 * 86_400_000)!;
    const re = await t.call('POST', `/v1/public/appointments/${book.json.token}/reschedule`, { body: { startsAt: target.start, staffId: staffCamila.id } });
    expect(re.status).toBe(201);
    const afterMove = await keys();
    expect(afterMove.map((j) => j.jobKey)).toEqual([`apt:${id}:r24`, `apt:${id}:r2`]);
    expect(afterMove[0]!.runAt.getTime()).toBeGreaterThan(pending[0]!.runAt.getTime());
    expect(afterMove[0]!.appointmentVersion).toBeGreaterThan(pending[0]!.appointmentVersion);

    // avanzar el reloj hasta r24 y disparar el barrido
    clock.set(new Date(afterMove[0]!.runAt.getTime() + 60_000));
    const tick = await t.app.get((await import('../src/modules/reminders/jobs.service')).JobsService).tick();
    clock.set(null);
    expect(tick.reminders.sent).toBeGreaterThanOrEqual(1);
    const log = await handle.db.select().from(messageLog).where(eq(messageLog.appointmentId, id));
    expect(log.some((m) => m.template === 'appointment_reminder_24h' && m.status === 'sent')).toBe(true);

    // cancelar: cero pendientes
    const cancel = await t.call('POST', `/v1/appointments/${id}/cancel`, { token: admin, body: {} });
    expect(cancel.json.status).toBe('canceled');
    expect(await keys()).toHaveLength(0);
  });

  it('un recordatorio con version obsoleta no se envia', async () => {
    const list = await slots([svcCorte.id], staffCamila.id, 21, 30);
    const { book } = await bookFlow(list[0]!.start, [svcCorte.id], staffCamila.id);
    const id = book.json.id as string;
    // manipular la version "por fuera" para simular una carrera: el handler debe omitir
    await handle.db.update(appointments).set({ version: 99 }).where(eq(appointments.id, id));
    const [job] = await handle.db.select().from(reminderJobs).where(and(eq(reminderJobs.appointmentId, id), eq(reminderJobs.kind, 'r24')));
    clock.set(new Date(job!.runAt.getTime() + 1000));
    await t.app.get((await import('../src/modules/reminders/reminders.service')).RemindersService).processDue(5000);
    clock.set(null);
    const [after] = await handle.db.select().from(reminderJobs).where(eq(reminderJobs.id, job!.id));
    expect(after!.status).toBe('skipped');
    expect(after!.lastError).toContain('version');
  });
});

describe('lista de espera', () => {
  it('al cancelar una cita se ofrece el hueco (hold de 10 min) a la primera entrada compatible y se acepta', async () => {
    const list = await slots([svcCorte.id], staffCamila.id, 14, 21);
    const target = list[4]!;
    const { book } = await bookFlow(target.start, [svcCorte.id], staffCamila.id);
    const wp = phone();
    const join = await t.call('POST', `/v1/public/${SLUG}/waitlist`, {
      body: { fullName: 'En Espera', phone: wp, serviceId: svcCorte.id, staffId: staffCamila.id, windowStart: new Date(Date.parse(target.start) - 3_600_000).toISOString(), windowEnd: new Date(Date.parse(target.start) + 3_600_000).toISOString(), privacyAccepted: true },
    });
    expect(join.status).toBe(201);
    await t.call('POST', `/v1/appointments/${book.json.id}/cancel`, { token: admin, body: {} });
    const wl = await t.call('GET', '/v1/waitlist', { token: admin });
    const entry = wl.json.find((e: any) => e.id === join.json.id);
    expect(entry.status).toBe('offered');
    const [offered] = await handle.db.select().from(appointments).where(eq(appointments.id, entry.offeredAppointmentId));
    expect(offered!.status).toBe('held');
    expect(offered!.source).toBe('waitlist');
    const token = (await t.call('GET', `/v1/appointments/${offered!.id}`, { token: admin })).json.token;
    const accept = await t.call('POST', `/v1/public/appointments/${token}/accept`, { body: {} });
    expect(accept.json.status).toBe('confirmed');
  });
});

describe('barrido de holds vencidos', () => {
  async function tick(secret?: string) {
    return t.call('POST', '/v1/internal/jobs/tick', {
      ...(secret !== undefined ? { headers: { 'x-internal-secret': secret } } : {}),
    });
  }

  it('rechaza el tick sin el secreto interno y no toca un hold vigente', async () => {
    const list = await slots([svcCorte.id], staffCamila.id, 51, 53);
    const hold = await t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [svcCorte.id], staffId: staffCamila.id, startsAt: list[0]!.start } });
    expect(hold.status).toBe(201);
    expect((await tick()).status).toBe(403);
    expect((await tick('secreto-incorrecto')).status).toBe(403);
    const swept = await tick(t.config.internalSecret);
    expect(swept.status).toBe(200);
    const [row] = await handle.db.select().from(appointments).where(eq(appointments.id, hold.json.holdId));
    expect(row!.status).toBe('held');
    expect(swept.json.holdsReleased).toBe(0);
  });

  it('el tick cancela el hold vencido, suelta la restriccion EXCLUDE y no repite el barrido', async () => {
    const list = await slots([svcCorte.id], staffCamila.id, 54, 56);
    const start = list[1]!.start;
    const hold = await t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [svcCorte.id], staffId: staffCamila.id, startsAt: start } });
    expect(hold.status).toBe(201);
    const during = await slots([svcCorte.id], staffCamila.id, 54, 56);
    expect(during.find((s) => s.start === start)).toBeUndefined();

    clock.advance(6 * 60_000);
    try {
      const swept = await tick(t.config.internalSecret);
      expect(swept.status).toBe(200);
      expect(swept.json.holdsReleased).toBeGreaterThanOrEqual(1);
      const [row] = await handle.db.select().from(appointments).where(eq(appointments.id, hold.json.holdId));
      expect(row!.status).toBe('canceled');
      expect(row!.cancelReason).toBe('hold_expired');

      const again = await tick(t.config.internalSecret);
      expect(again.json.holdsReleased).toBe(0);

      const reclaimed = await t.call('POST', `/v1/public/${SLUG}/holds`, { body: { serviceIds: [svcCorte.id], staffId: staffCamila.id, startsAt: start } });
      expect(reclaimed.status).toBe(201);
      const [fresh] = await handle.db.select().from(appointments).where(eq(appointments.id, reclaimed.json.holdId));
      expect(fresh!.status).toBe('held');
    } finally {
      clock.set(null);
    }
  });

  it('un anticipo vencido se libera; una cita confirmada no', async () => {
    const corte = await slots([svcCorte.id], staffCamila.id, 57, 58);
    const color = await slots([svcColor.id], 'any', 59, 59);
    const confirmed = await bookFlow(corte[0]!.start, [svcCorte.id], staffCamila.id);
    expect(confirmed.book.status).toBe(201);
    expect(confirmed.book.json.status).toBe('confirmed');
    const pending = await bookFlow(color[0]!.start, [svcColor.id]);
    expect(pending.book.json.status).toBe('pending');

    clock.advance(31 * 60_000);
    try {
      const swept = await tick(t.config.internalSecret);
      expect(swept.status).toBe(200);
      expect(swept.json.holdsReleased).toBeGreaterThanOrEqual(1);
      const [kept] = await handle.db.select().from(appointments).where(eq(appointments.id, confirmed.book.json.id));
      const [dropped] = await handle.db.select().from(appointments).where(eq(appointments.id, pending.book.json.id));
      expect(kept!.status).toBe('confirmed');
      expect(dropped!.status).toBe('canceled');
      expect(dropped!.cancelReason).toBe('hold_expired');
    } finally {
      clock.set(null);
    }
  });
});

describe('reportes y panel', () => {
  it('KPIs coherentes y dinero en centavos enteros', async () => {
    const s = await t.call('GET', '/v1/reports/summary', { token: admin });
    expect(s.status).toBe(200);
    expect(s.json.totals.appointments).toBeGreaterThan(50);
    expect(Number.isInteger(s.json.revenueCents)).toBe(true);
    expect(s.json.noShowRate).toBeGreaterThanOrEqual(0);
    const occ = await t.call('GET', '/v1/reports/occupancy', { token: admin });
    expect(occ.json.heatmap).toHaveLength(7);
    const rev = await t.call('GET', '/v1/reports/revenue', { token: admin });
    expect(rev.json.byService.length).toBeGreaterThan(0);
    expect(rev.json.byStaff.every((x: any) => Number.isInteger(x.commissionCents))).toBe(true);
  });

  it('SSE: /v1/events emite appointment.created y reanuda con Last-Event-ID', async () => {
    const events = (t.app as any).get((await import('../src/core/events.service')).EventsService);
    const tenant = (await t.call('GET', '/v1/auth/me', { token: admin })).json.tenant.id;
    const ev = events.emit(tenant, 'appointment.created', { id: 'x' });
    const received: any[] = [];
    const sub = events.stream(tenant, ev.id - 1).subscribe((e: any) => received.push(e));
    sub.unsubscribe();
    expect(received.some((e) => e.type === 'appointment.created' && e.data.data.id === 'x')).toBe(true);
  });
});
