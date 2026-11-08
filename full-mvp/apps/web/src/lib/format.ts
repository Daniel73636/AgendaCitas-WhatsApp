import {
  type AppointmentStatus,
  STATUS_LABELS_ES,
  addDaysStr,
  formatMoney,
  localDateOf,
  localMinutesOfDay,
  toAbsMin,
  weekdayOf,
  zonedToAbsMin,
} from '@agenda/domain-booking';

export const money = (cents: number, currency = 'COP') => formatMoney(cents, currency);

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string, key: string, o: Intl.DateTimeFormatOptions) {
  const k = `${tz}|${key}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('es-CO', { timeZone: tz, ...o });
    cache.set(k, f);
  }
  return f;
}
export const fmtTime = (iso: string, tz: string) => dtf(tz, 't', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
export const fmtTime12 = (iso: string, tz: string) => dtf(tz, 't12', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
export const fmtDateLong = (iso: string, tz: string) => dtf(tz, 'dl', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
export const fmtDateShort = (iso: string, tz: string) => dtf(tz, 'ds', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
export const fmtDateTime = (iso: string, tz: string) => `${fmtDateShort(iso, tz)} · ${fmtTime(iso, tz)}`;

/** Fecha local YYYY-MM-DD de un instante ISO en la zona del negocio. */
export const dayOf = (iso: string, tz: string) => localDateOf(toAbsMin(iso), tz);
export const todayIn = (tz: string) => localDateOf(Math.floor(Date.now() / 60_000), tz);
export const minutesOfDay = (iso: string, tz: string) => localMinutesOfDay(toAbsMin(iso), tz);
export const dayStartIso = (date: string, tz: string) => new Date(zonedToAbsMin(date, 0, tz) * 60_000).toISOString();
export const dayEndIso = (date: string, tz: string) => new Date(zonedToAbsMin(addDaysStr(date, 1), 0, tz) * 60_000).toISOString();
export const isoAt = (date: string, minutes: number, tz: string) => new Date(zonedToAbsMin(date, minutes, tz) * 60_000).toISOString();

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
const WEEKDAYS_LONG = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
export const weekdayShort = (date: string) => WEEKDAYS[weekdayOf(date)]!;
export const weekdayLong = (n: number) => WEEKDAYS_LONG[n]!;
export const weekdayShortN = (n: number) => WEEKDAYS[n]!;
export const dayNumber = (date: string) => Number(date.slice(8));
export const monthLabel = (date: string) =>
  new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date.slice(0, 7)}-01T12:00:00Z`));
export const dateLabelFromStr = (date: string) =>
  new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
export const mondayOf = (date: string) => addDaysStr(date, -((weekdayOf(date) + 6) % 7));

export const durationLabel = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);

export const hm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** Entrada de usuario en unidades de moneda ("45000" o "45.000") a centavos enteros, sin flotantes. */
export function toCents(input: string): number {
  const clean = input.replace(/[^\d,.-]/g, '');
  if (!clean) return 0;
  // formato es-CO: puntos de miles, coma decimal
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/\./g, '');
  const [whole = '0', frac = ''] = normalized.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}
export const fromCents = (cents: number): string => String(Math.floor(cents / 100));

export const STATUS_META: Record<AppointmentStatus, { label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'; bg: string; border: string }> = {
  held: { label: STATUS_LABELS_ES.held, tone: 'neutral', bg: 'bg-slate-100', border: 'border-slate-400' },
  pending: { label: 'Pendiente de pago', tone: 'warning', bg: 'bg-amber-50', border: 'border-amber-400' },
  confirmed: { label: 'Confirmada', tone: 'success', bg: 'bg-emerald-50', border: 'border-emerald-500' },
  in_progress: { label: 'En curso', tone: 'info', bg: 'bg-sky-50', border: 'border-sky-500' },
  completed: { label: 'Completada', tone: 'primary', bg: 'bg-violet-50', border: 'border-violet-400' },
  no_show: { label: 'No asistio', tone: 'danger', bg: 'bg-red-50', border: 'border-red-400' },
  canceled: { label: 'Cancelada', tone: 'neutral', bg: 'bg-zinc-100', border: 'border-zinc-300' },
};

export const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
export const waLink = (phone: string, text?: string) => `https://wa.me/${phone.replace('+', '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** Paises frecuentes para el selector de celular. */
export const COUNTRIES = [
  { code: '+57', label: 'Colombia', flag: 'CO' },
  { code: '+52', label: 'Mexico', flag: 'MX' },
  { code: '+51', label: 'Peru', flag: 'PE' },
  { code: '+56', label: 'Chile', flag: 'CL' },
  { code: '+54', label: 'Argentina', flag: 'AR' },
  { code: '+593', label: 'Ecuador', flag: 'EC' },
  { code: '+58', label: 'Venezuela', flag: 'VE' },
  { code: '+34', label: 'Espana', flag: 'ES' },
  { code: '+1', label: 'EE. UU.', flag: 'US' },
] as const;
