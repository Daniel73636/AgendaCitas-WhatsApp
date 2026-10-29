import { absMinToIso, addDaysStr, localDateOf, localMinutesOfDay, toAbsMin, zonedToAbsMin } from './time';

export const REMINDER_KINDS = ['confirm', 'r24', 'r6', 'r2', 'review'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export interface ReminderPolicy {
  confirm: boolean;
  r24: boolean;
  r6: boolean;
  r2: boolean;
  review: boolean;
  /** Ventana horaria permitida (hora local). */
  windowStartHour: number;
  windowEndHour: number;
  /** Minutos despues del fin de la cita para pedir resena. */
  reviewDelayMin: number;
}

export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  confirm: true,
  r24: true,
  r6: false,
  r2: true,
  review: true,
  windowStartHour: 7,
  windowEndHour: 21,
  reviewDelayMin: 120,
};

/** jobId determinista: apt:{id}:confirm | r24 | r6 | r2 | review */
export const reminderJobKey = (appointmentId: string, kind: ReminderKind): string => `apt:${appointmentId}:${kind}`;

/**
 * Si el instante cae fuera de [windowStartHour, windowEndHour) hora local,
 * se mueve al borde permitido mas cercano (el del mismo dia local).
 */
export function clampToSendWindow(absMin: number, tz: string, startHour = 7, endHour = 21): number {
  const mod = localMinutesOfDay(absMin, tz);
  const date = localDateOf(absMin, tz);
  if (mod < startHour * 60) return zonedToAbsMin(date, startHour * 60, tz);
  if (mod >= endHour * 60) {
    // el borde mas cercano es el cierre de la ventana del mismo dia (21:00)
    return zonedToAbsMin(date, endHour * 60, tz);
  }
  return absMin;
}

export interface ReminderJobPlan {
  kind: ReminderKind;
  jobKey: string;
  runAt: string;
}

/**
 * Linea de tiempo de recordatorios. Solo incluye trabajos futuros (el de confirmacion es inmediato).
 * Reprogramar = descartar los pendientes y llamar de nuevo a esta misma funcion.
 */
export function buildReminderTimeline(args: {
  appointmentId: string;
  startsAt: string;
  endsAt: string;
  now: string;
  timezone: string;
  policy?: Partial<ReminderPolicy>;
}): ReminderJobPlan[] {
  const p = { ...DEFAULT_REMINDER_POLICY, ...args.policy };
  const now = toAbsMin(args.now);
  const start = toAbsMin(args.startsAt);
  const end = toAbsMin(args.endsAt);
  const plans: ReminderJobPlan[] = [];
  const push = (kind: ReminderKind, at: number, clamp: boolean) => {
    const runAt = clamp ? clampToSendWindow(at, args.timezone, p.windowStartHour, p.windowEndHour) : at;
    plans.push({ kind, jobKey: reminderJobKey(args.appointmentId, kind), runAt: absMinToIso(runAt) });
  };
  if (p.confirm) push('confirm', now, false);
  const offsets: Array<[ReminderKind, number]> = [
    ['r24', start - 24 * 60],
    ['r6', start - 6 * 60],
    ['r2', start - 2 * 60],
  ];
  for (const [kind, at] of offsets) {
    if (!p[kind]) continue;
    const runAt = clampToSendWindow(at, args.timezone, p.windowStartHour, p.windowEndHour);
    // omitir si ya paso o si cae despues del inicio de la cita
    if (runAt <= now || runAt >= start) continue;
    push(kind, at, true);
  }
  if (p.review) push('review', end + p.reviewDelayMin, true);
  return plans;
}

/** Siguiente fecha local (utilidad de pruebas / UI). */
export const nextLocalDate = (absMin: number, tz: string): string => addDaysStr(localDateOf(absMin, tz), 1);
