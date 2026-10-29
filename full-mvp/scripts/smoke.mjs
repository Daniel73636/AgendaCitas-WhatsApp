#!/usr/bin/env node
/**
 * Prueba de humo contra una API en ejecucion:  node scripts/smoke.mjs [http://localhost:4100]
 * Recorre: negocio publico -> disponibilidad -> hold -> OTP -> reserva -> login -> panel.
 */
const API = process.argv[2] ?? process.env.API_URL ?? 'http://localhost:4100';
const SLUG = 'belleza-demo';
let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✔' : '✘'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};
const j = async (method, path, body, headers = {}) => {
  const res = await fetch(`${API}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
};

const biz = await j('GET', `/v1/public/${SLUG}`);
ok('GET /public/{slug}', biz.status === 200 && biz.json.services.length >= 5, `${biz.json.services?.length} servicios, ${biz.json.staff?.length} profesionales`);
const svc = biz.json.services.find((s) => s.name.startsWith('Corte de cabello'));
const from = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const to = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const av = await j('GET', `/v1/public/${SLUG}/availability?serviceIds=${svc.id}&from=${from}&to=${to}`);
ok('GET availability', av.status === 200 && av.json.slots.length > 0, `${av.json.slots?.length} huecos`);
const slot = av.json.slots[5];
const hold = await j('POST', `/v1/public/${SLUG}/holds`, { serviceIds: [svc.id], staffId: 'any', startsAt: slot.start }, { 'idempotency-key': `smoke-${Date.now()}` });
ok('POST holds', hold.status === 201 || hold.status === 200, hold.json.holdId);
const dup = await j('POST', `/v1/public/${SLUG}/holds`, { serviceIds: [svc.id], staffId: hold.json.staffId, startsAt: slot.start });
ok('hold duplicado -> 409 SLOT_TAKEN (+alternativas)', dup.status === 409 && dup.json.error.code === 'SLOT_TAKEN' && dup.json.error.alternatives?.length > 0);
const phone = '+57300' + String(Math.floor(1000000 + Math.random() * 8999999));
const otp = await j('POST', `/v1/public/${SLUG}/otp/request`, { phone });
ok('POST otp/request (mock)', otp.status === 201 || otp.status === 200, otp.json.hint);
const bad = await j('POST', `/v1/public/${SLUG}/otp/verify`, { phone, code: '000000' });
ok('OTP incorrecto rechazado', bad.status === 422);
const ver = await j('POST', `/v1/public/${SLUG}/otp/verify`, { phone, code: '123456' });
ok('OTP 123456 verificado', ver.json.verified === true);
const book = await j('POST', `/v1/public/${SLUG}/bookings`, { holdId: hold.json.holdId, fullName: 'Cliente Smoke', phone, consentWhatsapp: true, otpToken: ver.json.otpToken }, { 'idempotency-key': 'k-' + hold.json.holdId });
ok('POST bookings', (book.status === 201 || book.status === 200) && ['confirmed', 'pending'].includes(book.json.status), book.json.status);
const book2 = await j('POST', `/v1/public/${SLUG}/bookings`, { holdId: hold.json.holdId, fullName: 'Cliente Smoke', phone, consentWhatsapp: true, otpToken: ver.json.otpToken }, { 'idempotency-key': 'k-' + hold.json.holdId });
ok('Idempotency-Key: segundo envio devuelve la misma cita', book2.json.id === book.json.id);
const tokenView = await j('GET', `/v1/public/appointments/${book.json.token}`);
ok('GET public/appointments/{token}', tokenView.status === 200 && tokenView.json.id === book.json.id);

const login = await j('POST', '/v1/auth/login', { email: 'admin@belleza-demo.com', password: 'demo1234' });
ok('POST auth/login', login.status === 200 && !!login.json.token);
const auth = { authorization: `Bearer ${login.json.token}` };
const noAuth = await j('GET', '/v1/appointments?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z');
ok('GET appointments sin sesion -> 401', noAuth.status === 401);
const list = await j('GET', `/v1/appointments?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 7 * 86_400_000).toISOString()}`, undefined, auth);
ok('GET appointments (panel)', list.status === 200 && list.json.some((a) => a.id === book.json.id), `${list.json.length} citas`);
const sum = await j('GET', '/v1/reports/summary', undefined, auth);
ok('GET reports/summary', sum.status === 200 && sum.json.totals.appointments > 0, `ocupacion ${sum.json.occupancyPct}%`);
const tick = await j('POST', '/v1/internal/jobs/tick', undefined, { 'x-internal-secret': process.env.INTERNAL_JOBS_SECRET ?? 'dev-internal-secret' });
ok('POST internal/jobs/tick', tick.status === 200, JSON.stringify(tick.json));
const msgs = await j('GET', `/v1/appointments/${book.json.id}/messages`, undefined, auth);
ok('Confirmacion de WhatsApp (mock) registrada', msgs.json.some((m) => m.template === 'appointment_confirmation'));
const cancel = await j('POST', `/v1/public/appointments/${book.json.token}/cancel`, {});
ok('Cancelar por enlace', cancel.status === 200 || cancel.status === 201, cancel.json.status);

console.log(failed ? `\n${failed} verificacion(es) fallaron` : '\nTodo OK');
process.exit(failed ? 1 : 0);
