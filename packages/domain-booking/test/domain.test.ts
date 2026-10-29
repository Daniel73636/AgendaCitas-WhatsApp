import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  buildReminderTimeline,
  canCustomerCancel,
  canCustomerReschedule,
  canTransition,
  clampToSendWindow,
  computeDepositRefund,
  DEFAULT_POLICY,
  isHoldExpired,
  localDateOf,
  localTimeLabel,
  percentOfCents,
  requiredDepositCents,
  sumCents,
  toAbsMin,
  zonedToAbsMin,
  formatMoney,
} from '../src';

const TZ = 'America/Bogota';

describe('time', () => {
  it('ida y vuelta hora de pared <-> UTC', () => {
    const abs = zonedToAbsMin('2026-03-02', 9 * 60 + 30, TZ);
    expect(new Date(abs * 60_000).toISOString()).toBe('2026-03-02T14:30:00.000Z');
    expect(localDateOf(abs, TZ)).toBe('2026-03-02');
    expect(localTimeLabel(abs, TZ)).toBe('09:30');
  });
  it('una hora que cae en el dia anterior UTC mantiene su fecha local', () => {
    const abs = toAbsMin('2026-03-03T03:30:00Z'); // 22:30 del 2 en Bogota
    expect(localDateOf(abs, TZ)).toBe('2026-03-02');
  });
});

describe('estados', () => {
  it('transiciones validas e invalidas', () => {
    expect(canTransition('held', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('completed', 'canceled')).toBe(false);
    expect(canTransition('canceled', 'confirmed')).toBe(false);
    expect(canTransition('no_show', 'completed')).toBe(false);
  });
  it('hold vencido', () => {
    expect(isHoldExpired('2026-03-02T10:00:00Z', '2026-03-02T10:00:01Z')).toBe(true);
    expect(isHoldExpired('2026-03-02T10:05:00Z', '2026-03-02T10:00:01Z')).toBe(false);
    expect(isHoldExpired(null, '2026-03-02T10:00:01Z')).toBe(false);
  });
});

describe('dinero en centavos enteros', () => {
  it('sumas y porcentajes sin flotantes', () => {
    expect(sumCents([4500000, 3000000, 1])).toBe(7500001);
    expect(percentOfCents(10000, 33.33)).toBe(3333);
    expect(percentOfCents(999, 50)).toBe(500);
    expect(() => sumCents([1.5])).toThrow();
  });
  it('formatea COP sin decimales', () => {
    expect(formatMoney(4500000, 'COP')).toContain('45.000');
  });
  it('anticipo requerido: servicios o riesgo por inasistencias', () => {
    expect(requiredDepositCents({ serviceDepositsCents: [0, 0], totalCents: 100000, customerNoShows: 0 })).toBe(0);
    expect(requiredDepositCents({ serviceDepositsCents: [5000], totalCents: 100000, customerNoShows: 0 })).toBe(5000);
    expect(requiredDepositCents({ serviceDepositsCents: [5000], totalCents: 100000, customerNoShows: 2 })).toBe(30000);
    expect(requiredDepositCents({ serviceDepositsCents: [500000], totalCents: 100000, customerNoShows: 0 })).toBe(100000);
  });
});

describe('politicas', () => {
  const now = '2026-03-02T12:00:00Z';
  it('cancelar con antelacion suficiente', () => {
    expect(canCustomerCancel('2026-03-03T12:00:00Z', now, DEFAULT_POLICY).allowed).toBe(true);
    expect(canCustomerCancel('2026-03-02T14:00:00Z', now, DEFAULT_POLICY).allowed).toBe(false);
    expect(canCustomerCancel('2026-03-02T11:00:00Z', now, DEFAULT_POLICY).allowed).toBe(false);
    expect(canCustomerReschedule('2026-03-02T13:00:00Z', now, DEFAULT_POLICY).allowed).toBe(false);
  });
  it('devolucion total, parcial o perdida del anticipo', () => {
    expect(computeDepositRefund(100000, 48, DEFAULT_POLICY)).toEqual({ refundCents: 100000, retainedCents: 0 });
    expect(computeDepositRefund(100001, 10, DEFAULT_POLICY)).toEqual({ refundCents: 50001, retainedCents: 50000 });
    expect(computeDepositRefund(100000, 2, DEFAULT_POLICY)).toEqual({ refundCents: 0, retainedCents: 100000 });
    expect(computeDepositRefund(0, 100, DEFAULT_POLICY)).toEqual({ refundCents: 0, retainedCents: 0 });
  });
});

describe('recordatorios', () => {
  const now = '2026-03-02T12:00:00Z';
  it('timeline completa para una cita lejana', () => {
    const startsAt = '2026-03-05T19:00:00Z'; // 14:00 Bogota
    const endsAt = '2026-03-05T19:45:00Z';
    const plan = buildReminderTimeline({ appointmentId: 'X', startsAt, endsAt, now, timezone: TZ });
    expect(plan.map((p) => p.kind)).toEqual(['confirm', 'r24', 'r2', 'review']);
    expect(plan.map((p) => p.jobKey)).toEqual(['apt:X:confirm', 'apt:X:r24', 'apt:X:r2', 'apt:X:review']);
    expect(plan[1]!.runAt).toBe('2026-03-04T19:00:00.000Z');
    expect(plan[2]!.runAt).toBe('2026-03-05T17:00:00.000Z');
  });
  it('omite recordatorios que ya pasaron', () => {
    const plan = buildReminderTimeline({
      appointmentId: 'Y',
      startsAt: '2026-03-02T15:00:00Z', // 3 h despues
      endsAt: '2026-03-02T15:30:00Z',
      now,
      timezone: TZ,
    });
    expect(plan.map((p) => p.kind)).toEqual(['confirm', 'r2', 'review']);
  });
  it('ventana 7:00-21:00: mueve al borde permitido', () => {
    const early = zonedToAbsMin('2026-03-03', 4 * 60, TZ);
    expect(localTimeLabel(clampToSendWindow(early, TZ), TZ)).toBe('07:00');
    const late = zonedToAbsMin('2026-03-03', 23 * 60, TZ);
    expect(localTimeLabel(clampToSendWindow(late, TZ), TZ)).toBe('21:00');
    const ok = zonedToAbsMin('2026-03-03', 10 * 60, TZ);
    expect(clampToSendWindow(ok, TZ)).toBe(ok);
  });
  it('reprogramar reemplaza: misma funcion, mismos jobKeys deterministas', () => {
    const a = buildReminderTimeline({ appointmentId: 'Z', startsAt: '2026-03-06T19:00:00Z', endsAt: '2026-03-06T19:30:00Z', now, timezone: TZ });
    const b = buildReminderTimeline({ appointmentId: 'Z', startsAt: '2026-03-07T19:00:00Z', endsAt: '2026-03-07T19:30:00Z', now, timezone: TZ });
    expect(a.map((x) => x.jobKey)).toEqual(b.map((x) => x.jobKey));
    expect(a[1]!.runAt).not.toBe(b[1]!.runAt);
  });
});

describe('ics', () => {
  it('genera VEVENT valido', () => {
    const ics = buildIcs(
      { uid: 'abc', title: 'Corte, peinado', startsAt: '2026-03-05T19:00:00Z', endsAt: '2026-03-05T19:45:00Z', location: 'Calle 1; Bogota' },
      '2026-03-01T00:00:00Z',
    );
    expect(ics).toContain('DTSTART:20260305T190000Z');
    expect(ics).toContain('SUMMARY:Corte\\, peinado');
    expect(ics).toContain('LOCATION:Calle 1\\; Bogota');
  });
});
