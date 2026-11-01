/**
 * Utilidades de tiempo SIN dependencias y deterministas.
 * Nunca usan la zona horaria del proceso: todo se calcula con Intl y una zona IANA explicita.
 * Representacion interna: "minutos absolutos desde epoch UTC" (enteros).
 */

export const MS_PER_MIN = 60_000;

export const toAbsMin = (d: Date | string | number): number => {
  const ms = d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d);
  if (Number.isNaN(ms)) throw new Error(`Fecha invalida: ${String(d)}`);
  return Math.floor(ms / MS_PER_MIN);
};

export const fromAbsMin = (m: number): Date => new Date(m * MS_PER_MIN);
export const absMinToIso = (m: number): string => fromAbsMin(m).toISOString();

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function getDtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Componentes de pared (hora local) de un instante en la zona dada. */
export function getLocalParts(ms: number, timeZone: string): LocalParts {
  const parts = getDtf(timeZone).formatToParts(new Date(ms));
  const out: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** Desfase (minutos) de la zona respecto a UTC en el instante dado. */
export function tzOffsetMin(ms: number, timeZone: string): number {
  const p = getLocalParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MS_PER_MIN);
}

export function parseDateStr(date: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Fecha local invalida (YYYY-MM-DD): ${date}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function formatDateStr(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Suma dias a una fecha local YYYY-MM-DD (calendario gregoriano puro). */
export function addDaysStr(date: string, days: number): string {
  const { y, m, d } = parseDateStr(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return formatDateStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Dia de la semana 0=domingo..6=sabado de una fecha local YYYY-MM-DD. */
export function weekdayOf(date: string): number {
  const { y, m, d } = parseDateStr(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function diffDaysStr(a: string, b: string): number {
  const pa = parseDateStr(a);
  const pb = parseDateStr(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/**
 * Convierte una hora de pared (fecha local + minutos desde medianoche local) a minutos absolutos UTC.
 * Maneja DST: en huecos (hora inexistente) avanza; en solapes (hora repetida) elige la primera ocurrencia.
 * `minutesOfDay` puede ser >= 1440 (p.ej. 24:00 = medianoche del dia siguiente).
 */
export function zonedToAbsMin(date: string, minutesOfDay: number, timeZone: string): number {
  const { y, m, d } = parseDateStr(date);
  const naiveMs = Date.UTC(y, m - 1, d, 0, minutesOfDay, 0);
  // Prueba con los dos desfases candidatos alrededor del instante (antes y despues de un posible cambio).
  const o1 = tzOffsetMin(naiveMs - 24 * 60 * MS_PER_MIN, timeZone);
  const o2 = tzOffsetMin(naiveMs + 24 * 60 * MS_PER_MIN, timeZone);
  const candidates = Array.from(new Set([o1, o2]));
  const valid: number[] = [];
  for (const off of candidates) {
    const guess = naiveMs - off * MS_PER_MIN;
    if (tzOffsetMin(guess, timeZone) === off) valid.push(guess);
  }
  if (valid.length === 0) {
    // Hora inexistente (salto adelante): usar el desfase previo => avanza.
    const guess = naiveMs - Math.min(o1, o2) * MS_PER_MIN;
    return Math.floor(guess / MS_PER_MIN);
  }
  return Math.floor(Math.min(...valid) / MS_PER_MIN);
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona. */
export function localDateOf(absMin: number, timeZone: string): string {
  const p = getLocalParts(absMin * MS_PER_MIN, timeZone);
  return formatDateStr(p.year, p.month, p.day);
}

/** Minutos desde medianoche local de un instante. */
export function localMinutesOfDay(absMin: number, timeZone: string): number {
  const p = getLocalParts(absMin * MS_PER_MIN, timeZone);
  return p.hour * 60 + p.minute;
}

/** "HH:mm" local. */
export function localTimeLabel(absMin: number, timeZone: string): string {
  const mins = localMinutesOfDay(absMin, timeZone);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** "HH:MM" o "HH:MM:SS" -> minutos del dia. Acepta "24:00". */
export function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hm);
  if (!m) throw new Error(`Hora invalida: ${hm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatHm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** Inicio (UTC, ms) del dia local. */
export function startOfLocalDayAbs(date: string, timeZone: string): number {
  return zonedToAbsMin(date, 0, timeZone);
}
