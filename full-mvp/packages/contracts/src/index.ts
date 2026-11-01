import { z } from 'zod';
import { APPOINTMENT_STATUSES } from '@agenda/domain-booking';
import { esErrorMap } from './zod-es';

// Mensajes de validacion en espanol (los mensajes propios de cada esquema tienen prioridad).
z.setErrorMap(esErrorMap);
export { esErrorMap };

/** Version vigente de la politica de privacidad (se guarda con el consentimiento del cliente). */
export const PRIVACY_POLICY_VERSION = '2026-11-01';

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------
export const uuid = z.string().uuid();
export const isoDateTime = z.string().datetime({ offset: true });
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use el formato YYYY-MM-DD');
export const hm = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, 'Use el formato HH:MM');
/** Dinero SIEMPRE en centavos enteros. */
export const cents = z.number().int().min(0).max(100_000_000_000);
export const phoneE164 = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-().]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Celular invalido. Use formato internacional, ej: +573001234567'));

export const appointmentStatus = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatusT = z.infer<typeof appointmentStatus>;

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const loginInput = z.object({ email: z.string().email(), password: z.string().min(1) });
export type LoginInput = z.infer<typeof loginInput>;
export interface AuthSession {
  token: string;
  user: { id: string; name: string; email: string; role: 'owner' | 'staff' };
  tenant: { id: string; slug: string; name: string; timezone: string; currency: string };
}

// ---------------------------------------------------------------------------
// Ajustes del negocio (JSON en tenants.settings)
// ---------------------------------------------------------------------------
export const tenantSettings = z.object({
  minNoticeMin: z.number().int().min(0).max(60 * 24 * 30).default(60),
  maxAdvanceDays: z.number().int().min(1).max(365).default(60),
  stepMin: z.number().int().min(5).max(120).default(15),
  assignment: z.enum(['least_loaded', 'preference']).default('least_loaded'),
  holdMinutes: z.number().int().min(1).max(30).default(5),
  cancelMinHours: z.number().int().min(0).max(240).default(4),
  rescheduleMinHours: z.number().int().min(0).max(240).default(4),
  fullRefundHours: z.number().int().min(0).max(720).default(24),
  partialRefundHours: z.number().int().min(0).max(720).default(6),
  partialRefundPct: z.number().min(0).max(100).default(50),
  requireDepositForServices: z.boolean().default(true),
  depositOnRepeatNoShow: z.boolean().default(true),
  noShowThreshold: z.number().int().min(1).max(20).default(2),
  riskDepositPct: z.number().min(1).max(100).default(30),
  reminders: z
    .object({
      confirm: z.boolean().default(true),
      r24: z.boolean().default(true),
      r6: z.boolean().default(false),
      r2: z.boolean().default(true),
      review: z.boolean().default(true),
    })
    .default({}),
  reviewUrl: z.string().url().optional().or(z.literal('')),
  estimatedNoShowReduction: z.number().min(0).max(1).default(0.06),
  onboardingDismissed: z.boolean().default(false),
  /** Color de marca de la página pública (#rrggbb). */
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Usa un color hexadecimal, por ejemplo #7c3aed').default('#7c3aed'),
});
export type TenantSettings = z.infer<typeof tenantSettings>;
export const defaultTenantSettings = (): TenantSettings => tenantSettings.parse({});

export const tenantUpdate = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  timezone: z.string().min(3).optional(),
  settings: tenantSettings.partial().optional(),
  logoUrl: z.union([z.string().url().max(500), z.literal('')]).nullable().optional(),
  coverUrl: z.union([z.string().url().max(500), z.literal('')]).nullable().optional(),
});
export type TenantUpdate = z.infer<typeof tenantUpdate>;

// ---------------------------------------------------------------------------
// Catalogo / equipo
// ---------------------------------------------------------------------------
export interface ServiceDto {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  priceCents: number;
  currency: string;
  depositCents: number;
  capacity: number;
  visiblePublic: boolean;
  active: boolean;
  category: string | null;
  imageUrl: string | null;
  staffIds: string[];
}

export const serviceInput = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(600).nullable().optional(),
  durationMin: z.number().int().min(5).max(600),
  bufferBeforeMin: z.number().int().min(0).max(120).default(0),
  bufferAfterMin: z.number().int().min(0).max(120).default(0),
  priceCents: cents,
  depositCents: cents.default(0),
  capacity: z.number().int().min(1).max(50).default(1),
  visiblePublic: z.boolean().default(true),
  active: z.boolean().default(true),
  category: z.string().max(60).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  staffIds: z.array(uuid).optional(),
});
export type ServiceInputT = z.infer<typeof serviceInput>;
export const servicePatch = serviceInput.partial();

export interface StaffDto {
  id: string;
  displayName: string;
  bio: string | null;
  specialties: string[];
  color: string;
  photoUrl: string | null;
  active: boolean;
  priority: number;
  commissionPct: number;
  serviceIds: string[];
  serviceOverrides: Array<{ serviceId: string; priceCentsOverride: number | null; durationMinOverride: number | null }>;
}

export const staffInput = z.object({
  displayName: z.string().min(2).max(80),
  bio: z.string().max(500).nullable().optional(),
  specialties: z.array(z.string().max(40)).max(10).default([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7c3aed'),
  photoUrl: z.string().max(500).nullable().optional(),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(0),
  commissionPct: z.number().min(0).max(100).default(0),
  services: z
    .array(
      z.object({
        serviceId: uuid,
        priceCentsOverride: cents.nullable().optional(),
        durationMinOverride: z.number().int().min(5).max(600).nullable().optional(),
      }),
    )
    .optional(),
});
export type StaffInputT = z.infer<typeof staffInput>;
export const staffPatch = staffInput.partial().extend({
  /** Al desactivar con citas futuras: reasignar automaticamente cuando sea posible. */
  reassign: z.boolean().optional(),
});

export const workBlockInput = z
  .object({ weekday: z.number().int().min(0).max(6), start: hm, end: hm })
  .refine((b) => b.end > b.start, { message: 'La hora final debe ser mayor que la inicial' });
export const scheduleInput = z.object({ blocks: z.array(workBlockInput).max(60) });
export type ScheduleInput = z.infer<typeof scheduleInput>;

export interface TimeOffDto {
  id: string;
  staffId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  isExtraOpening: boolean;
}
export const timeOffInput = z
  .object({
    staffId: uuid.nullable().optional(),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    reason: z.string().max(200).nullable().optional(),
    isExtraOpening: z.boolean().default(false),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: 'El fin debe ser posterior al inicio' });

// ---------------------------------------------------------------------------
// Publico
// ---------------------------------------------------------------------------
/** Recordatorios que el negocio tiene activos (para explicárselos a quien reserva). */
export interface PublicReminderFlags {
  confirm: boolean;
  r24: boolean;
  r6: boolean;
  r2: boolean;
}

export interface PublicBusiness {
  tenant: {
    slug: string;
    name: string;
    description: string | null;
    phone: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    timezone: string;
    currency: string;
    logoUrl: string | null;
    coverUrl: string | null;
    /** Color de marca (#rrggbb) para la página pública. */
    brandColor: string;
  };
  services: ServiceDto[];
  staff: StaffDto[];
  settings: Pick<TenantSettings, 'holdMinutes' | 'cancelMinHours' | 'rescheduleMinHours' | 'maxAdvanceDays'> & {
    reminders: PublicReminderFlags;
  };
  otpMode: 'mock' | 'real';
  /** Pago simulado y copys de demostración solo cuando el servidor está en DEMO_MODE. */
  demoMode: boolean;
}

export const availabilityQuery = z.object({
  serviceIds: z
    .string()
    .min(1)
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(uuid).min(1).max(6)),
  staffId: z.union([uuid, z.literal('any')]).default('any'),
  from: localDate,
  to: localDate.optional(),
  /** Solo panel privado: ignora antelacion minima/maxima. */
  ignoreRules: z.coerce.boolean().optional(),
  /** Excluir una cita del calculo (al reprogramar). */
  excludeAppointmentId: uuid.optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;

export interface SlotDto {
  date: string;
  start: string;
  end: string;
  staffId: string;
  staffIds: string[];
  label: string;
}
export interface AvailabilityResponse {
  timezone: string;
  from: string;
  to: string;
  slots: SlotDto[];
  /** Primera fecha con cupo posterior a `to`, si en el rango no hay ninguno. */
  nextAvailableDate: string | null;
  totalCents: number;
  durationMin: number;
}

export const holdInput = z.object({
  serviceIds: z.array(uuid).min(1).max(6),
  staffId: z.union([uuid, z.literal('any')]).default('any'),
  startsAt: isoDateTime,
});
export type HoldInput = z.infer<typeof holdInput>;
export interface HoldDto {
  holdId: string;
  expiresAt: string;
  startsAt: string;
  endsAt: string;
  staffId: string;
  staffName: string;
  totalCents: number;
  currency: string;
  services: Array<{ id: string; name: string; durationMin: number; priceCents: number }>;
}

export const otpRequestInput = z.object({ phone: phoneE164, holdId: uuid.optional() });
export const otpVerifyInput = z.object({ phone: phoneE164, code: z.string().regex(/^\d{4,8}$/, 'Codigo invalido') });
export interface OtpRequestResult {
  sent: boolean;
  mock: boolean;
  /** Pista solo en modo mock. */
  hint?: string;
  expiresInSec: number;
}
export interface OtpVerifyResult {
  verified: boolean;
  otpToken: string;
}

export const bookingInput = z.object({
  holdId: uuid,
  fullName: z.string().trim().min(2, 'Ingresa tu nombre').max(120),
  phone: phoneE164,
  email: z.string().email().optional().or(z.literal('')),
  notes: z.string().max(500).optional(),
  consentWhatsapp: z.boolean(),
  /** Autorizacion de tratamiento de datos personales (Ley 1581 de 2012); obligatoria salvo PRIVACY_CONSENT_REQUIRED=false. */
  privacyAccepted: z.boolean().optional(),
  otpToken: z.string().optional(),
  otpCode: z.string().regex(/^\d{4,8}$/).optional(),
  /** Campo trampa anti-bots (debe ir vacio). */
  website: z.string().max(0).optional(),
});
export type BookingInput = z.infer<typeof bookingInput>;

export interface PublicAppointmentDto {
  id: string;
  token: string;
  status: AppointmentStatusT;
  startsAt: string;
  endsAt: string;
  staffId: string;
  staffName: string;
  customerName: string | null;
  services: Array<{ id: string; name: string; durationMin: number; priceCents: number }>;
  totalCents: number;
  depositRequiredCents: number;
  depositPaidCents: number;
  currency: string;
  business: { slug: string; name: string; address: string | null; phone: string | null; lat: number | null; lng: number | null; timezone: string };
  policy: { canCancel: boolean; canReschedule: boolean; cancelReason?: string; rescheduleReason?: string; cancelMinHours: number };
  holdExpiresAt: string | null;
  mapsUrl: string | null;
}

export const rescheduleInput = z.object({ startsAt: isoDateTime, staffId: z.union([uuid, z.literal('any')]).default('any') });
export const cancelInput = z.object({ reason: z.string().max(300).optional() });

export const waitlistInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: phoneE164,
  serviceId: uuid,
  staffId: uuid.nullable().optional(),
  windowStart: isoDateTime,
  windowEnd: isoDateTime,
  consentWhatsapp: z.boolean().default(true),
  privacyAccepted: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Citas (panel)
// ---------------------------------------------------------------------------
export interface AppointmentItemDto {
  id: string;
  serviceId: string;
  name: string;
  durationMin: number;
  priceCents: number;
}
export interface AppointmentDto {
  id: string;
  status: AppointmentStatusT;
  version: number;
  startsAt: string;
  endsAt: string;
  occupiedStart: string;
  occupiedEnd: string;
  staffId: string;
  staffName: string;
  staffColor: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerNoShows: number;
  source: string;
  totalCents: number;
  depositRequiredCents: number;
  depositPaidCents: number;
  paidCents: number;
  paymentMethod: string | null;
  holdExpiresAt: string | null;
  notes: string | null;
  items: AppointmentItemDto[];
  confirmedByCustomer: boolean;
  createdAt: string;
  checkedInAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  refundedCents: number;
  currency: string;
  token?: string;
}

export const appointmentsQuery = z.object({
  from: isoDateTime,
  to: isoDateTime,
  staffId: uuid.optional(),
  status: z.string().optional(),
  customerId: uuid.optional(),
});

export const appointmentCreateInput = z.object({
  customerId: uuid.optional(),
  newCustomer: z.object({ fullName: z.string().min(2).max(120), phone: phoneE164, email: z.string().email().optional().or(z.literal('')) }).optional(),
  serviceIds: z.array(uuid).min(1).max(6),
  staffId: uuid,
  startsAt: isoDateTime,
  notes: z.string().max(500).optional(),
  requireDeposit: z.boolean().default(false),
  sendConfirmation: z.boolean().default(true),
  /** Permite fuera de horario laboral (sobrecupo manual) pero NUNCA solapes. */
  ignoreSchedule: z.boolean().default(false),
});
export type AppointmentCreateInput = z.infer<typeof appointmentCreateInput>;

export const appointmentPatchInput = z.object({
  startsAt: isoDateTime.optional(),
  staffId: uuid.optional(),
  status: appointmentStatus.optional(),
  notes: z.string().max(500).nullable().optional(),
  serviceIds: z.array(uuid).min(1).max(6).optional(),
  ignoreSchedule: z.boolean().optional(),
});
export type AppointmentPatchInput = z.infer<typeof appointmentPatchInput>;

export const completeInput = z.object({
  paymentMethod: z.enum(['cash', 'card', 'transfer', 'other']).default('cash'),
  /** Monto cobrado ahora (centavos). Por defecto: total - anticipo. */
  amountCents: cents.optional(),
});
export const cancelAppointmentInput = z.object({ reason: z.string().max(300).optional(), notifyCustomer: z.boolean().default(true) });

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------
export interface CustomerDto {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  noShowCount: number;
  lateCancelCount: number;
  tags: string[];
  consentWhatsapp: boolean;
  visits: number;
  totalSpentCents: number;
  lastVisitAt: string | null;
  createdAt: string;
}
export const customerInput = z.object({
  fullName: z.string().min(2).max(120),
  phone: phoneE164,
  email: z.string().email().nullable().optional().or(z.literal('')),
  birthday: localDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().max(30)).max(15).default([]),
  consentWhatsapp: z.boolean().default(false),
});
export const customerPatch = customerInput.partial();
export const customerMergeInput = z.object({ intoCustomerId: uuid });

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------
export interface MessageDto {
  id: string;
  appointmentId: string | null;
  customerId: string | null;
  phone: string;
  direction: 'in' | 'out';
  channel: string;
  template: string | null;
  body: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
}
export interface ConversationDto {
  phone: string;
  customerId: string | null;
  customerName: string | null;
  lastMessage: string;
  lastAt: string;
  unread: number;
}
export const messageReplyInput = z.object({ phone: phoneE164, body: z.string().min(1).max(1000), appointmentId: uuid.optional() });
export const simulateInboundInput = z.object({ phone: phoneE164, body: z.string().min(1).max(1000), buttonPayload: z.string().optional() });

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------
export interface ReportSummary {
  range: { from: string; to: string };
  totals: { appointments: number; completed: number; noShow: number; canceled: number; upcoming: number };
  noShowRate: number; // 0-1
  revenueCents: number;
  avgTicketCents: number;
  occupancyPct: number;
  newCustomers: number;
  impact: { remindersSent: number; appointmentsReminded: number; estimatedNoShowsAvoided: number; estimatedRecoveredCents: number; assumption: number };
}
export interface NoShowReport {
  byCustomer: Array<{ customerId: string; name: string; phone: string; noShows: number }>;
  byWeekday: Array<{ weekday: number; noShows: number; total: number }>;
  byStaff: Array<{ staffId: string; name: string; noShows: number; total: number }>;
}
export interface OccupancyReport {
  /** matriz [weekday 0-6][hour 0-23] con 0..1 */
  heatmap: number[][];
  byStaff: Array<{ staffId: string; name: string; bookedMin: number; availableMin: number; pct: number }>;
}
export interface RevenueReport {
  byDay: Array<{ date: string; cents: number; count: number }>;
  byService: Array<{ serviceId: string; name: string; cents: number; count: number }>;
  byStaff: Array<{ staffId: string; name: string; cents: number; count: number; commissionCents: number }>;
  totalCents: number;
}

// ---------------------------------------------------------------------------
// Errores y eventos
// ---------------------------------------------------------------------------
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SLOT_TAKEN'
  | 'SLOT_UNAVAILABLE'
  | 'HOLD_EXPIRED'
  | 'VERSION_MISMATCH'
  | 'INVALID_TRANSITION'
  | 'POLICY_VIOLATION'
  | 'OTP_INVALID'
  | 'OTP_REQUIRED'
  | 'RATE_LIMITED'
  | 'ACCOUNT_LOCKED'
  | 'HAS_FUTURE_APPOINTMENTS'
  | 'CONFLICT'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown; alternatives?: SlotDto[]; retryAfterSec?: number; correlationId?: string };
}

export type RealtimeEventType =
  | 'appointment.created'
  | 'appointment.updated'
  | 'appointment.canceled'
  | 'message.received'
  | 'message.sent'
  | 'waitlist.offered'
  | 'hello';
export interface RealtimeEvent {
  id: number;
  type: RealtimeEventType;
  tenantId: string;
  at: string;
  data: Record<string, unknown>;
}

export const DEMO_OTP_CODE = '123456';
