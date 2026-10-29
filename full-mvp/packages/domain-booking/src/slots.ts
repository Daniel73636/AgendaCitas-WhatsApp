import {
  type Interval,
  mergeIntervals,
  overlapMinutes,
  subtractIntervals,
} from './intervals';
import {
  absMinToIso,
  addDaysStr,
  localDateOf,
  localTimeLabel,
  parseHm,
  toAbsMin,
  weekdayOf,
  zonedToAbsMin,
} from './time';

// ---------------------------------------------------------------------------
// Tipos publicos
// ---------------------------------------------------------------------------

/** Bloque semanal de trabajo. `weekday` 0=domingo..6=sabado; hora local "HH:MM" (end puede ser "24:00"). */
export interface WorkBlock {
  weekday: number;
  start: string;
  end: string;
}

/** Intervalo absoluto en ISO 8601 (UTC). */
export interface TimeInterval {
  start: string;
  end: string;
}

export interface ServiceInput {
  id: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
}

export interface StaffAvailability {
  id: string;
  schedule: WorkBlock[];
  /** Vacaciones, permisos, festivos, bloqueos (restan disponibilidad). */
  timeOff: TimeInterval[];
  /** Aperturas especiales (suman disponibilidad). */
  extraOpenings?: TimeInterval[];
  /** Rangos ocupados (campo `occupied` de citas activas, ya con colchones). */
  busy: TimeInterval[];
  /** Mayor = preferido cuando la regla de reparto es "preference". */
  priority?: number;
  /** serviceId -> duracion propia de este profesional. */
  durationOverrides?: Record<string, number>;
}

export type AssignmentRule = 'least_loaded' | 'preference';

export interface AvailabilityRules {
  /** Antelacion minima en minutos (ahora + X). */
  minNoticeMin: number;
  /** Antelacion maxima en dias. */
  maxAdvanceDays: number;
  /** Paso de la grilla en minutos (5, 10, 15, 30...). */
  stepMin: number;
  assignment: AssignmentRule;
}

export interface AvailabilityInput {
  /** Instante actual ISO (inyectado para que la funcion sea pura/determinista). */
  now: string;
  /** Zona IANA de la sede. */
  timezone: string;
  /** Rango inclusivo de fechas locales YYYY-MM-DD. */
  fromDate: string;
  toDate: string;
  /** Servicios a realizar en cadena secuencial con un mismo profesional. */
  services: ServiceInput[];
  /** Profesionales candidatos (si el cliente eligio uno concreto, solo ese). */
  staff: StaffAvailability[];
  rules: AvailabilityRules;
}

export interface Slot {
  /** Fecha local YYYY-MM-DD de inicio. */
  date: string;
  /** Inicio visible para el cliente (ISO UTC). */
  start: string;
  /** Fin visible (ISO UTC). */
  end: string;
  /** Rango ocupado incluyendo colchones (ISO UTC). */
  occupiedStart: string;
  occupiedEnd: string;
  /** Profesional asignado por defecto. */
  staffId: string;
  /** Todos los profesionales libres en ese inicio. */
  staffIds: string[];
  /** Hora local "HH:mm" lista para mostrar. */
  label: string;
}

export const DEFAULT_RULES: AvailabilityRules = {
  minNoticeMin: 60,
  maxAdvanceDays: 60,
  stepMin: 15,
  assignment: 'least_loaded',
};

// ---------------------------------------------------------------------------
// Cadena de servicios
// ---------------------------------------------------------------------------

export interface ServiceChain {
  /** Duracion visible total (servicios + colchones intermedios). */
  visibleMin: number;
  beforeMin: number;
  afterMin: number;
  /** Duracion ocupada total = before + visible + after. */
  occupiedMin: number;
}

/**
 * Duracion total de una cita = suma de servicios + colchones.
 * El colchon "antes" es el del primer servicio, el "despues" el del ultimo;
 * los colchones intermedios (after[i] + before[i+1]) se suman a la duracion visible.
 */
export function computeChain(
  services: ServiceInput[],
  overrides?: Record<string, number>,
): ServiceChain {
  if (services.length === 0) throw new Error('Se requiere al menos un servicio');
  let visible = 0;
  services.forEach((s, i) => {
    const dur = overrides?.[s.id] ?? s.durationMin;
    if (!Number.isInteger(dur) || dur <= 0) throw new Error(`Duracion invalida para servicio ${s.id}`);
    visible += dur;
    if (i > 0) visible += services[i - 1]!.bufferAfterMin + s.bufferBeforeMin;
  });
  const beforeMin = services[0]!.bufferBeforeMin;
  const afterMin = services[services.length - 1]!.bufferAfterMin;
  return { visibleMin: visible, beforeMin, afterMin, occupiedMin: beforeMin + visible + afterMin };
}

// ---------------------------------------------------------------------------
// computeSlots
// ---------------------------------------------------------------------------

const toIntervals = (list: TimeInterval[] | undefined): Interval[] =>
  (list ?? []).map((i) => ({ start: toAbsMin(i.start), end: toAbsMin(i.end) }));

/**
 * Calcula huecos libres. PURA y DETERMINISTA: no lee reloj ni zona del servidor.
 *
 * Pasos (ver arquitectura 4.3):
 *  1. Expandir horarios semanales a intervalos absolutos UTC (zona de la sede, DST incluido).
 *  2. Restar bloqueos/vacaciones/citas; sumar aperturas extra.
 *  3. Duracion total = servicios + colchones.
 *  4. Candidatos cada `stepMin` dentro de cada hueco donde quepa todo.
 *  5. Filtrar por antelacion minima/maxima.
 *  6. Con varios profesionales, repartir segun la regla (menos cargado / preferencia).
 *  7. Devolver ordenado por inicio.
 */
export function computeSlots(input: AvailabilityInput): Slot[] {
  const { timezone: tz, rules } = input;
  if (rules.stepMin <= 0 || !Number.isInteger(rules.stepMin)) throw new Error('stepMin invalido');
  if (input.services.length === 0 || input.staff.length === 0) return [];

  const nowAbs = toAbsMin(input.now);
  const earliest = nowAbs + rules.minNoticeMin;
  const latest = nowAbs + rules.maxAdvanceDays * 1440;

  // Lista de fechas locales del rango (inclusive)
  const dates: string[] = [];
  for (let d = input.fromDate; d <= input.toDate; d = addDaysStr(d, 1)) {
    dates.push(d);
    if (dates.length > 400) throw new Error('Rango de fechas demasiado grande');
  }
  if (dates.length === 0) return [];

  const zonedCache = new Map<string, number>();
  const zoned = (date: string, mins: number): number => {
    const k = `${date}|${mins}`;
    let v = zonedCache.get(k);
    if (v === undefined) {
      v = zonedToAbsMin(date, mins, tz);
      zonedCache.set(k, v);
    }
    return v;
  };

  // Inicios de dia local (anclas de grilla + carga diaria)
  const rangeStart = zoned(dates[0]!, 0);
  const rangeEnd = zoned(addDaysStr(dates[dates.length - 1]!, 1), 0);

  interface Candidate {
    staffId: string;
    start: number;
    end: number;
    occStart: number;
    occEnd: number;
    date: string;
  }
  const workDates = [addDaysStr(dates[0]!, -1), ...dates];
  const byStart = new Map<number, Candidate[]>();
  // carga de cada profesional por fecha local (minutos ocupados) para "menos cargado"
  const load = new Map<string, number>();

  for (const staff of input.staff) {
    // 1. Horario semanal -> intervalos absolutos
    const work: Interval[] = [];
    for (const date of workDates) {
      const wd = weekdayOf(date);
      for (const b of staff.schedule) {
        if (b.weekday !== wd) continue;
        const s = parseHm(b.start);
        const e = parseHm(b.end);
        if (e <= s) continue;
        work.push({ start: zoned(date, s), end: zoned(date, e) });
      }
    }
    // 2. Sumar aperturas extra, restar bloqueos y citas
    work.push(...toIntervals(staff.extraOpenings));
    const busy = toIntervals(staff.busy);
    const blocks = [...toIntervals(staff.timeOff), ...busy];
    const free = subtractIntervals(work, blocks);

    // carga diaria
    const mergedBusy = mergeIntervals(busy);
    for (const date of dates) {
      load.set(`${staff.id}|${date}`, overlapMinutes(mergedBusy, zoned(date, 0), zoned(addDaysStr(date, 1), 0)));
    }

    // 3. Duracion total para este profesional
    const chain = computeChain(input.services, staff.durationOverrides);

    // 4. Candidatos por hueco
    for (const gap of free) {
      if (gap.end <= rangeStart || gap.start >= rangeEnd) continue;
      const lo = gap.start + chain.beforeMin; // primer inicio visible posible
      const hi = gap.end - chain.afterMin - chain.visibleMin; // ultimo inicio visible posible
      if (hi < lo) continue;
      const firstDate = localDateOf(Math.max(lo, rangeStart), tz);
      for (let date = firstDate; date <= input.toDate; date = addDaysStr(date, 1)) {
        const dayStart = zoned(date, 0);
        const dayEnd = zoned(addDaysStr(date, 1), 0);
        if (dayStart > hi) break;
        const from = Math.max(lo, dayStart, earliest);
        const to = Math.min(hi, dayEnd - 1, latest);
        if (to < from) continue;
        let s = dayStart + Math.ceil((from - dayStart) / rules.stepMin) * rules.stepMin;
        for (; s <= to; s += rules.stepMin) {
          const cand: Candidate = {
            staffId: staff.id,
            start: s,
            end: s + chain.visibleMin,
            occStart: s - chain.beforeMin,
            occEnd: s + chain.visibleMin + chain.afterMin,
            date,
          };
          const arr = byStart.get(s);
          if (arr) arr.push(cand);
          else byStart.set(s, [cand]);
        }
      }
    }
  }

  // 6. Reparto entre profesionales + 7. orden
  const priority = new Map(input.staff.map((s) => [s.id, s.priority ?? 0]));
  const out: Slot[] = [];
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  for (const s of starts) {
    const cands = byStart.get(s)!;
    // dedup por profesional (huecos fusionados no deberian duplicar, pero es barato asegurar)
    const uniq = new Map<string, Candidate>();
    for (const c of cands) if (!uniq.has(c.staffId)) uniq.set(c.staffId, c);
    const list = [...uniq.values()];
    list.sort((a, b) => {
      if (rules.assignment === 'preference') {
        const d = (priority.get(b.staffId) ?? 0) - (priority.get(a.staffId) ?? 0);
        if (d !== 0) return d;
      } else {
        const d = (load.get(`${a.staffId}|${a.date}`) ?? 0) - (load.get(`${b.staffId}|${b.date}`) ?? 0);
        if (d !== 0) return d;
        const p = (priority.get(b.staffId) ?? 0) - (priority.get(a.staffId) ?? 0);
        if (p !== 0) return p;
      }
      return a.staffId < b.staffId ? -1 : a.staffId > b.staffId ? 1 : 0;
    });
    const chosen = list[0]!;
    out.push({
      date: chosen.date,
      start: absMinToIso(chosen.start),
      end: absMinToIso(chosen.end),
      occupiedStart: absMinToIso(chosen.occStart),
      occupiedEnd: absMinToIso(chosen.occEnd),
      staffId: chosen.staffId,
      staffIds: list.map((c) => c.staffId).sort(),
      label: localTimeLabel(chosen.start, tz),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers sobre resultados
// ---------------------------------------------------------------------------

export function groupSlotsByDay(slots: Slot[]): Record<string, Slot[]> {
  const out: Record<string, Slot[]> = {};
  for (const s of slots) (out[s.date] ??= []).push(s);
  return out;
}

/** Los `n` huecos mas cercanos a `targetIso` (para alternativas tras SLOT_TAKEN). */
export function nearestSlots(slots: Slot[], targetIso: string, n = 3): Slot[] {
  const t = Date.parse(targetIso);
  return [...slots]
    .sort((a, b) => Math.abs(Date.parse(a.start) - t) - Math.abs(Date.parse(b.start) - t) || a.start.localeCompare(b.start))
    .slice(0, n)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Franja del dia para agrupar la cuadricula de horas. */
export type DayPart = 'morning' | 'afternoon' | 'evening';
export function dayPartOf(label: string): DayPart {
  const h = Number(label.slice(0, 2));
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

/** Verifica que un inicio concreto sigue ofrecido (y con que profesionales). */
export function findSlot(slots: Slot[], startIso: string, staffId?: string): Slot | undefined {
  const t = Date.parse(startIso);
  return slots.find((s) => Date.parse(s.start) === t && (!staffId || s.staffIds.includes(staffId)));
}
