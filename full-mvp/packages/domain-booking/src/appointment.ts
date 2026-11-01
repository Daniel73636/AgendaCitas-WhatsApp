export const APPOINTMENT_STATUSES = [
  'held',
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'no_show',
  'canceled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Estados que bloquean agenda (coinciden con el WHERE de la restriccion EXCLUDE). */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['held', 'pending', 'confirmed', 'in_progress'];
export const isActiveStatus = (s: AppointmentStatus): boolean => ACTIVE_STATUSES.includes(s);

const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  held: ['pending', 'confirmed', 'canceled'],
  pending: ['confirmed', 'canceled', 'no_show'],
  confirmed: ['in_progress', 'completed', 'no_show', 'canceled'],
  in_progress: ['completed', 'canceled'],
  completed: [],
  no_show: [],
  canceled: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: AppointmentStatus): readonly AppointmentStatus[] {
  return TRANSITIONS[from];
}

export const STATUS_LABELS_ES: Record<AppointmentStatus, string> = {
  held: 'Reservada (temporal)',
  pending: 'Pendiente de pago',
  confirmed: 'Confirmada',
  in_progress: 'En curso',
  completed: 'Completada',
  no_show: 'No asistió',
  canceled: 'Cancelada',
};

export function isHoldExpired(holdExpiresAtIso: string | null | undefined, nowIso: string): boolean {
  if (!holdExpiresAtIso) return false;
  return Date.parse(holdExpiresAtIso) <= Date.parse(nowIso);
}

// ---- Dinero (SIEMPRE enteros en centavos) ----

export function sumCents(values: readonly number[]): number {
  let t = 0;
  for (const v of values) {
    if (!Number.isInteger(v)) throw new Error(`Monto no entero: ${v}`);
    t += v;
  }
  return t;
}

/** Porcentaje (0-100, admite decimales de hasta 2 posiciones) con redondeo half-up en enteros. */
export function percentOfCents(cents: number, pct: number): number {
  if (!Number.isInteger(cents)) throw new Error('cents debe ser entero');
  const bp = Math.round(pct * 100); // puntos basicos
  return Math.floor((cents * bp + 5000) / 10000);
}

/** Solo para presentacion: formatea centavos como moneda. */
export function formatMoney(cents: number, currency = 'COP', locale = 'es-CO'): string {
  const zeroDecimal = currency === 'COP' || currency === 'CLP' || currency === 'JPY';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: zeroDecimal ? 0 : 2,
  }).format(cents / 100);
}

// ---- Politicas de cancelacion / reprogramacion / anticipo ----

export interface CancellationPolicy {
  /** Horas minimas antes de la cita para que el CLIENTE pueda cancelar por enlace. */
  cancelMinHours: number;
  /** Horas minimas para reprogramar por enlace. */
  rescheduleMinHours: number;
  /** Con al menos estas horas de antelacion se devuelve el 100% del anticipo. */
  fullRefundHours: number;
  /** Con al menos estas horas (y menos de fullRefundHours) se devuelve partialRefundPct. */
  partialRefundHours: number;
  partialRefundPct: number;
}

export const DEFAULT_POLICY: CancellationPolicy = {
  cancelMinHours: 4,
  rescheduleMinHours: 4,
  fullRefundHours: 24,
  partialRefundHours: 6,
  partialRefundPct: 50,
};

export interface PolicyDecision {
  allowed: boolean;
  hoursBefore: number;
  reason?: string;
}

export const hoursUntil = (startsAtIso: string, nowIso: string): number =>
  (Date.parse(startsAtIso) - Date.parse(nowIso)) / 3_600_000;

export function canCustomerCancel(startsAtIso: string, nowIso: string, p: CancellationPolicy): PolicyDecision {
  const h = hoursUntil(startsAtIso, nowIso);
  if (h <= 0) return { allowed: false, hoursBefore: h, reason: 'La cita ya comenzo o paso.' };
  if (h < p.cancelMinHours)
    return { allowed: false, hoursBefore: h, reason: `Solo se puede cancelar con ${p.cancelMinHours} h de antelacion. Contacta al negocio.` };
  return { allowed: true, hoursBefore: h };
}

export function canCustomerReschedule(startsAtIso: string, nowIso: string, p: CancellationPolicy): PolicyDecision {
  const h = hoursUntil(startsAtIso, nowIso);
  if (h <= 0) return { allowed: false, hoursBefore: h, reason: 'La cita ya comenzo o paso.' };
  if (h < p.rescheduleMinHours)
    return { allowed: false, hoursBefore: h, reason: `Solo se puede reprogramar con ${p.rescheduleMinHours} h de antelacion. Contacta al negocio.` };
  return { allowed: true, hoursBefore: h };
}

export interface RefundResult {
  refundCents: number;
  retainedCents: number;
}

/** Devolucion total, parcial o perdida del anticipo segun la hora de cancelacion. */
export function computeDepositRefund(depositPaidCents: number, hoursBefore: number, p: CancellationPolicy): RefundResult {
  if (depositPaidCents <= 0) return { refundCents: 0, retainedCents: 0 };
  let refund = 0;
  if (hoursBefore >= p.fullRefundHours) refund = depositPaidCents;
  else if (hoursBefore >= p.partialRefundHours) refund = percentOfCents(depositPaidCents, p.partialRefundPct);
  return { refundCents: refund, retainedCents: depositPaidCents - refund };
}

/**
 * Anticipo requerido: el mayor entre la suma de anticipos de los servicios y,
 * si el cliente tiene >= `noShowThreshold` inasistencias, un porcentaje del total.
 */
export function requiredDepositCents(args: {
  serviceDepositsCents: number[];
  totalCents: number;
  customerNoShows: number;
  noShowThreshold?: number;
  riskDepositPct?: number;
}): number {
  const base = sumCents(args.serviceDepositsCents);
  const risk =
    args.customerNoShows >= (args.noShowThreshold ?? 2)
      ? percentOfCents(args.totalCents, args.riskDepositPct ?? 30)
      : 0;
  return Math.min(args.totalCents, Math.max(base, risk));
}
