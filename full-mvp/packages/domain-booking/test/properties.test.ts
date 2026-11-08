import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type StaffAvailability,
  computeSlots,
  DEFAULT_RULES,
  intervalsOverlap,
  toAbsMin,
  zonedToAbsMin,
  parseHm,
  weekdayOf,
  mergeIntervals,
  subtractIntervals,
} from '../src';

const TZ = 'America/Bogota';
const DATE = '2026-03-04'; // miercoles
const DAY0 = zonedToAbsMin(DATE, 0, TZ);

const busyArb = fc.array(
  fc.record({
    startMin: fc.integer({ min: 0, max: 24 * 60 - 15 }),
    dur: fc.integer({ min: 15, max: 180 }),
  }),
  { maxLength: 12 },
);
const minutesToIso = (abs: number) => new Date(abs * 60_000).toISOString();

function makeStaff(id: string, busy: Array<{ startMin: number; dur: number }>): StaffAvailability {
  return {
    id,
    schedule: [
      { weekday: 3, start: '08:00', end: '12:30' },
      { weekday: 3, start: '14:00', end: '19:00' },
    ],
    timeOff: [],
    busy: busy.map((b) => ({ start: minutesToIso(DAY0 + b.startMin), end: minutesToIso(DAY0 + b.startMin + b.dur) })),
  };
}

const serviceArb = fc.record({
  durationMin: fc.integer({ min: 10, max: 120 }),
  bufferBeforeMin: fc.integer({ min: 0, max: 15 }),
  bufferAfterMin: fc.integer({ min: 0, max: 20 }),
});

describe('propiedades de computeSlots', () => {
  it('ningun hueco se solapa con una cita existente y todo hueco cabe en un bloque de trabajo', () => {
    fc.assert(
      fc.property(busyArb, busyArb, serviceArb, fc.constantFrom(5, 10, 15, 30), (busyA, busyB, service, step) => {
        const team = [makeStaff('a', busyA), makeStaff('b', busyB)];
        const slots = computeSlots({
          now: '2026-03-01T00:00:00Z',
          timezone: TZ,
          fromDate: DATE,
          toDate: DATE,
          services: [{ id: 's', ...service }],
          staff: team,
          rules: { ...DEFAULT_RULES, minNoticeMin: 0, stepMin: step },
        });
        const blocks = [
          [zonedToAbsMin(DATE, parseHm('08:00'), TZ), zonedToAbsMin(DATE, parseHm('12:30'), TZ)],
          [zonedToAbsMin(DATE, parseHm('14:00'), TZ), zonedToAbsMin(DATE, parseHm('19:00'), TZ)],
        ] as const;
        for (const slot of slots) {
          const oS = toAbsMin(slot.occupiedStart);
          const oE = toAbsMin(slot.occupiedEnd);
          // cabe completo en algun bloque
          expect(blocks.some(([s, e]) => oS >= s && oE <= e)).toBe(true);
          // todos los profesionales listados estan realmente libres
          for (const id of slot.staffIds) {
            const st = team.find((t) => t.id === id)!;
            for (const b of st.busy) {
              expect(intervalsOverlap(oS, oE, toAbsMin(b.start), toAbsMin(b.end))).toBe(false);
            }
          }
          // el inicio cae en la grilla
          expect((toAbsMin(slot.start) - DAY0) % step).toBe(0);
        }
        // ordenados y sin duplicados
        const starts = slots.map((s) => s.start);
        expect([...starts].sort()).toEqual(starts);
        expect(new Set(starts).size).toBe(starts.length);
      }),
      { numRuns: 150 },
    );
  });

  it('si se reserva un hueco devuelto, el siguiente calculo ya no lo incluye (ni nada que se solape)', () => {
    fc.assert(
      fc.property(busyArb, serviceArb, fc.nat(), (busy, service, pick) => {
        const input = {
          now: '2026-03-01T00:00:00Z',
          timezone: TZ,
          fromDate: DATE,
          toDate: DATE,
          services: [{ id: 's', ...service }],
          rules: { ...DEFAULT_RULES, minNoticeMin: 0, stepMin: 15 },
        };
        const first = computeSlots({ ...input, staff: [makeStaff('a', busy)] });
        fc.pre(first.length > 0);
        const chosen = first[pick % first.length]!;
        const booked = {
          ...makeStaff('a', busy),
        };
        booked.busy = [...booked.busy, { start: chosen.occupiedStart, end: chosen.occupiedEnd }];
        const second = computeSlots({ ...input, staff: [booked] });
        expect(second.find((s) => s.start === chosen.start)).toBeUndefined();
        for (const s of second) {
          expect(
            intervalsOverlap(toAbsMin(s.occupiedStart), toAbsMin(s.occupiedEnd), toAbsMin(chosen.occupiedStart), toAbsMin(chosen.occupiedEnd)),
          ).toBe(false);
        }
        // y solo desaparecen huecos (monotonia)
        const secondSet = new Set(second.map((s) => s.start));
        for (const s of second) expect(first.some((f) => f.start === s.start)).toBe(true);
        expect(secondSet.size).toBeLessThan(first.length);
      }),
      { numRuns: 100 },
    );
  });
});

describe('intervalos', () => {
  it('subtractIntervals nunca devuelve partes bloqueadas', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 1, max: 200 })), { maxLength: 8 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 1, max: 200 })), { maxLength: 8 }),
        (a, b) => {
          const base = a.map(([s, d]) => ({ start: s, end: s + d }));
          const blocks = b.map(([s, d]) => ({ start: s, end: s + d }));
          const out = subtractIntervals(base, blocks);
          for (const o of out) {
            for (const bl of blocks) expect(intervalsOverlap(o.start, o.end, bl.start, bl.end)).toBe(false);
            expect(mergeIntervals(base).some((m) => o.start >= m.start && o.end <= m.end)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('time', () => {
  it('weekdayOf', () => {
    expect(weekdayOf('2026-03-04')).toBe(3);
    expect(weekdayOf('2026-03-01')).toBe(0);
  });
});
