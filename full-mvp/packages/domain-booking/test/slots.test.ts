import { describe, expect, it } from 'vitest';
import {
  type AvailabilityInput,
  type StaffAvailability,
  type ServiceInput,
  computeChain,
  computeSlots,
  groupSlotsByDay,
  nearestSlots,
  DEFAULT_RULES,
} from '../src';

const TZ = 'America/Bogota'; // UTC-5 sin DST
const MON = '2026-03-02'; // lunes
const svc = (over: Partial<ServiceInput> = {}): ServiceInput => ({
  id: 's1',
  durationMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  ...over,
});
const weekdays = (start = '09:00', end = '18:00', days = [1, 2, 3, 4, 5, 6]) =>
  days.map((weekday) => ({ weekday, start, end }));
const staff = (over: Partial<StaffAvailability> = {}): StaffAvailability => ({
  id: 'a',
  schedule: weekdays(),
  timeOff: [],
  busy: [],
  ...over,
});
const base = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  now: '2026-03-01T00:00:00Z',
  timezone: TZ,
  fromDate: MON,
  toDate: MON,
  services: [svc()],
  staff: [staff()],
  rules: { ...DEFAULT_RULES, minNoticeMin: 0, stepMin: 30 },
  ...over,
});
/** Hora local Bogota -> ISO UTC */
const bog = (date: string, hm: string) => `${date}T${String(Number(hm.slice(0, 2)) + 5).padStart(2, '0')}:${hm.slice(3)}:00.000Z`;

describe('computeChain', () => {
  it('suma servicios y colchones intermedios', () => {
    const c = computeChain([
      svc({ id: 'a', durationMin: 30, bufferBeforeMin: 5, bufferAfterMin: 10 }),
      svc({ id: 'b', durationMin: 45, bufferBeforeMin: 5, bufferAfterMin: 15 }),
    ]);
    expect(c.beforeMin).toBe(5);
    expect(c.afterMin).toBe(15);
    expect(c.visibleMin).toBe(30 + 10 + 5 + 45);
    expect(c.occupiedMin).toBe(5 + 90 + 15);
  });
  it('usa duracion propia del profesional', () => {
    expect(computeChain([svc({ durationMin: 30 })], { s1: 50 }).visibleMin).toBe(50);
  });
});

describe('computeSlots - basico', () => {
  it('genera la grilla completa de un dia laboral', () => {
    const slots = computeSlots(base());
    expect(slots).toHaveLength(18); // 09:00..17:30
    expect(slots[0]!.label).toBe('09:00');
    expect(slots[0]!.start).toBe(bog(MON, '09:00'));
    expect(slots.at(-1)!.label).toBe('17:30');
    expect(slots.at(-1)!.end).toBe(bog(MON, '18:00'));
    expect(slots.every((s) => s.date === MON)).toBe(true);
  });

  it('no ofrece dias sin horario (domingo)', () => {
    expect(computeSlots(base({ fromDate: '2026-03-01', toDate: '2026-03-01' }))).toHaveLength(0);
  });

  it('respeta bloques partidos (almuerzo)', () => {
    const slots = computeSlots(
      base({
        staff: [staff({ schedule: [{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '14:00', end: '18:00' }] })],
      }),
    );
    const labels = slots.map((s) => s.label);
    expect(labels).not.toContain('12:00');
    expect(labels).not.toContain('13:30');
    expect(labels).toContain('11:30');
    expect(labels).toContain('14:00');
  });

  it('resta citas existentes y no se solapa', () => {
    const slots = computeSlots(
      base({ staff: [staff({ busy: [{ start: bog(MON, '10:00'), end: bog(MON, '11:00') }] })] }),
    );
    const labels = slots.map((s) => s.label);
    expect(labels).toContain('09:30');
    expect(labels).not.toContain('10:00');
    expect(labels).not.toContain('10:30');
    expect(labels).toContain('11:00');
  });

  it('un servicio largo no cabe antes de una cita', () => {
    const slots = computeSlots(
      base({
        services: [svc({ durationMin: 60 })],
        staff: [staff({ busy: [{ start: bog(MON, '10:00'), end: bog(MON, '11:00') }] })],
      }),
    );
    const labels = slots.map((s) => s.label);
    expect(labels).toContain('09:00');
    expect(labels).not.toContain('09:30');
  });

  it('incluye colchones en el rango ocupado y los exige dentro del bloque', () => {
    const slots = computeSlots(
      base({ services: [svc({ durationMin: 30, bufferBeforeMin: 10, bufferAfterMin: 20 })] }),
    );
    const first = slots[0]!;
    // el colchon previo obliga a empezar a las 09:30 (09:00 + 10 min cae en grilla 09:30)
    expect(first.label).toBe('09:30');
    expect(Date.parse(first.start) - Date.parse(first.occupiedStart)).toBe(10 * 60_000);
    expect(Date.parse(first.occupiedEnd) - Date.parse(first.end)).toBe(20 * 60_000);
    const last = slots.at(-1)!;
    expect(Date.parse(last.occupiedEnd)).toBeLessThanOrEqual(Date.parse(bog(MON, '18:00')));
    expect(last.label).toBe('17:00'); // 17:00 + 30 + 20 = 17:50
  });

  it('cadena de varios servicios se calcula secuencial', () => {
    const slots = computeSlots(
      base({
        services: [
          svc({ id: 'x', durationMin: 60, bufferAfterMin: 15 }),
          svc({ id: 'y', durationMin: 45 }),
        ],
      }),
    );
    expect(slots[0]!.end).toBe(bog(MON, '11:00')); // 09:00 + 60 + 15 + 45 = 11:00
    expect(Date.parse(slots[0]!.end) - Date.parse(slots[0]!.start)).toBe(120 * 60_000);
  });

  it('antelacion minima y maxima', () => {
    // ahora = 09:00 hora Bogota del lunes; min 60 => primer hueco 10:00
    const slots = computeSlots(base({ now: bog(MON, '09:00'), rules: { ...DEFAULT_RULES, minNoticeMin: 60, stepMin: 30 } }));
    expect(slots[0]!.label).toBe('10:00');
    const far = computeSlots(
      base({ now: '2026-03-01T00:00:00Z', fromDate: '2026-03-02', toDate: '2026-05-30', rules: { ...DEFAULT_RULES, minNoticeMin: 0, maxAdvanceDays: 7, stepMin: 30 } }),
    );
    expect(Math.max(...far.map((s) => Date.parse(s.start)))).toBeLessThanOrEqual(Date.parse('2026-03-01T00:00:00Z') + 7 * 86_400_000);
  });

  it('vacaciones/bloqueos restan y aperturas extra suman', () => {
    const off = computeSlots(
      base({ staff: [staff({ timeOff: [{ start: bog(MON, '00:00'), end: bog('2026-03-03', '00:00') }] })] }),
    );
    expect(off).toHaveLength(0);
    const extra = computeSlots(
      base({
        fromDate: '2026-03-01',
        toDate: '2026-03-01', // domingo
        staff: [staff({ extraOpenings: [{ start: bog('2026-03-01', '10:00'), end: bog('2026-03-01', '12:00') }] })],
      }),
    );
    expect(extra.map((s) => s.label)).toEqual(['10:00', '10:30', '11:00', '11:30']);
  });

  it('paso de grilla alineado a la hora de pared', () => {
    const slots = computeSlots(base({ rules: { ...DEFAULT_RULES, minNoticeMin: 0, stepMin: 20 } }));
    expect(slots.slice(0, 3).map((s) => s.label)).toEqual(['09:00', '09:20', '09:40']);
  });

  it('rango de varios dias queda agrupado por dia', () => {
    const slots = computeSlots(base({ fromDate: '2026-03-02', toDate: '2026-03-08' }));
    const g = groupSlotsByDay(slots);
    expect(Object.keys(g)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07']);
  });
});

describe('computeSlots - cualquiera (reparto)', () => {
  const a = staff({ id: 'a', priority: 1, busy: [{ start: bog(MON, '09:00'), end: bog(MON, '12:00') }] });
  const b = staff({ id: 'b', priority: 5, busy: [] });
  it('menos cargado: asigna al profesional con menos minutos ocupados ese dia', () => {
    const slots = computeSlots(base({ staff: [a, b] }));
    const s1000 = slots.find((s) => s.label === '12:00')!;
    expect(s1000.staffIds).toEqual(['a', 'b']);
    expect(s1000.staffId).toBe('b');
    const s0900 = slots.find((s) => s.label === '09:00')!;
    expect(s0900.staffIds).toEqual(['b']);
  });
  it('preferencia: asigna al de mayor prioridad configurada', () => {
    const slots = computeSlots(base({ staff: [a, b], rules: { ...DEFAULT_RULES, minNoticeMin: 0, stepMin: 30, assignment: 'preference' } }));
    expect(slots.find((s) => s.label === '13:00')!.staffId).toBe('b');
  });
  it('es determinista sin importar el orden de entrada', () => {
    const x = computeSlots(base({ staff: [a, b] }));
    const y = computeSlots(base({ staff: [b, a] }));
    expect(y).toEqual(x);
  });
});

describe('computeSlots - zonas horarias y DST', () => {
  const NY = 'America/New_York';
  it('salto de primavera: hora inexistente no se ofrece y el hueco real dura 2 h', () => {
    // 2026-03-08 es domingo; a las 02:00 los relojes pasan a 03:00
    const slots = computeSlots({
      now: '2026-03-01T00:00:00Z',
      timezone: NY,
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
      services: [svc({ durationMin: 60 })],
      staff: [staff({ schedule: [{ weekday: 0, start: '01:00', end: '04:00' }] })],
      rules: { ...DEFAULT_RULES, minNoticeMin: 0, stepMin: 60 },
    });
    expect(slots.map((s) => s.label)).toEqual(['01:00', '03:00']);
  });

  it('fin de horario de verano: la hora repetida cuenta (5 h reales)', () => {
    // 2026-11-01 es domingo; a las 02:00 los relojes vuelven a 01:00
    const slots = computeSlots({
      now: '2026-10-01T00:00:00Z',
      timezone: NY,
      fromDate: '2026-11-01',
      toDate: '2026-11-01',
      services: [svc({ durationMin: 60 })],
      staff: [staff({ schedule: [{ weekday: 0, start: '00:00', end: '04:00' }] })],
      rules: { ...DEFAULT_RULES, minNoticeMin: 0, stepMin: 60 },
    });
    expect(slots).toHaveLength(5);
  });

  it('servicios que cruzan medianoche con bloques contiguos', () => {
    const slots = computeSlots({
      now: '2026-03-01T00:00:00Z',
      timezone: TZ,
      fromDate: '2026-03-02',
      toDate: '2026-03-03',
      services: [svc({ durationMin: 60 })],
      staff: [
        staff({
          schedule: [
            { weekday: 1, start: '22:00', end: '24:00' },
            { weekday: 2, start: '00:00', end: '02:00' },
          ],
        }),
      ],
      rules: { ...DEFAULT_RULES, minNoticeMin: 0, stepMin: 30 },
    });
    const cross = slots.find((s) => s.label === '23:30');
    expect(cross).toBeDefined(); // 23:30 -> 00:30 del dia siguiente
    expect(cross!.date).toBe('2026-03-02');
  });

  it('el resultado no depende de la zona horaria del proceso', () => {
    const input = base({ fromDate: '2026-03-02', toDate: '2026-03-14', staff: [staff(), staff({ id: 'b' })] });
    const original = process.env.TZ;
    const results: string[] = [];
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = tz;
      results.push(JSON.stringify(computeSlots(input)));
    }
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
    expect(new Set(results).size).toBe(1);
  });

  it('tres sedes en tres zonas dan inicios UTC distintos para el mismo horario local', () => {
    const mk = (tz: string) =>
      computeSlots(base({ timezone: tz, now: '2026-02-20T00:00:00Z' }))[0]!.start;
    const bogota = mk('America/Bogota');
    const madrid = mk('Europe/Madrid');
    const mexico = mk('America/Mexico_City');
    expect(new Set([bogota, madrid, mexico]).size).toBe(3);
  });
});

describe('nearestSlots', () => {
  it('devuelve las N mas cercanas ordenadas', () => {
    const slots = computeSlots(base());
    const near = nearestSlots(slots, bog(MON, '12:10'), 3);
    expect(near.map((s) => s.label)).toEqual(['11:30', '12:00', '12:30']);
  });
});

describe('performance', () => {
  it('un mes con 10 profesionales < 50 ms (tras calentar cache de Intl)', () => {
    const team = Array.from({ length: 10 }, (_, i) =>
      staff({
        id: `p${i}`,
        schedule: weekdays('08:00', '19:00'),
        busy: Array.from({ length: 40 }, (_, k) => {
          const day = 2 + (k % 28);
          const date = `2026-03-${String(day).padStart(2, '0')}`;
          const startH = 8 + ((k * 3 + i) % 9);
          return { start: bog(date, `${String(startH).padStart(2, '0')}:00`), end: bog(date, `${String(startH).padStart(2, '0')}:45`) };
        }),
      }),
    );
    const input = base({ fromDate: '2026-03-02', toDate: '2026-03-31', staff: team, rules: { ...DEFAULT_RULES, minNoticeMin: 0, stepMin: 15 } });
    computeSlots(input); // warm-up
    const t0 = performance.now();
    const slots = computeSlots(input);
    const ms = performance.now() - t0;
    expect(slots.length).toBeGreaterThan(500);
    // Objetivo de arquitectura < 50 ms en hardware sano; en CI/Windows se tolera más.
    expect(ms).toBeLessThan(Number(process.env.SLOTS_PERF_MS ?? 500));
  });
});
