import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Esquema Drizzle. La fuente de verdad del DDL (incluida la restriccion EXCLUDE gist)
 * son las migraciones SQL en `migrations.ts`; este archivo las espeja para consultas tipadas.
 * Todas las tablas de negocio llevan `tenant_id`. Dinero = bigint en centavos (modo number).
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });
const stamps = () => ({
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  phone: text('phone'),
  currency: text('currency').notNull().default('COP'),
  logoUrl: text('logo_url'),
  coverUrl: text('cover_url'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...stamps(),
});

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  address: text('address'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  timezone: text('timezone').notNull().default('America/Bogota'),
  ...stamps(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull().default('owner'),
    ...stamps(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id'),
    displayName: text('display_name').notNull(),
    bio: text('bio'),
    specialties: text('specialties').array().notNull().default(sql`'{}'::text[]`),
    color: text('color').notNull().default('#7c3aed'),
    photoUrl: text('photo_url'),
    active: boolean('active').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    commissionPct: doublePrecision('commission_pct').notNull().default(0),
    deletedAt: ts('deleted_at'),
    ...stamps(),
  },
  (t) => [index('staff_tenant_idx').on(t.tenantId)],
);

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category'),
    imageUrl: text('image_url'),
    durationMin: integer('duration_min').notNull(),
    bufferBeforeMin: integer('buffer_before_min').notNull().default(0),
    bufferAfterMin: integer('buffer_after_min').notNull().default(0),
    priceCents: money('price_cents').notNull(),
    currency: text('currency').notNull().default('COP'),
    depositCents: money('deposit_cents').notNull().default(0),
    capacity: integer('capacity').notNull().default(1),
    visiblePublic: boolean('visible_public').notNull().default(true),
    active: boolean('active').notNull().default(true),
    deletedAt: ts('deleted_at'),
    ...stamps(),
  },
  (t) => [index('services_tenant_idx').on(t.tenantId)],
);

export const staffServices = pgTable(
  'staff_services',
  {
    staffId: uuid('staff_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    priceCentsOverride: money('price_cents_override'),
    durationMinOverride: integer('duration_min_override'),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.serviceId] })],
);

export const staffSchedules = pgTable(
  'staff_schedules',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    staffId: uuid('staff_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
  },
  (t) => [index('staff_schedules_idx').on(t.tenantId, t.staffId)],
);

export const staffTimeOff = pgTable(
  'staff_time_off',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    staffId: uuid('staff_id'), // NULL = toda la sede
    locationId: uuid('location_id'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    reason: text('reason'),
    isExtraOpening: boolean('is_extra_opening').notNull().default(false),
    ...stamps(),
  },
  (t) => [index('staff_time_off_idx').on(t.tenantId, t.startsAt)],
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    fullName: text('full_name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    email: text('email'),
    birthday: date('birthday', { mode: 'string' }),
    notesEnc: text('notes_enc'), // AES-256-GCM (base64) - cifrado a nivel de campo
    noShowCount: integer('no_show_count').notNull().default(0),
    lateCancelCount: integer('late_cancel_count').notNull().default(0),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    consentWhatsapp: boolean('consent_whatsapp').notNull().default(false),
    mergedInto: uuid('merged_into'),
    /** Ley 1581: cuando y con que version de la politica el titular autorizo el tratamiento de sus datos. */
    privacyAcceptedAt: ts('privacy_accepted_at'),
    privacyPolicyVersion: text('privacy_policy_version'),
    deletedAt: ts('deleted_at'),
    ...stamps(),
  },
  (t) => [uniqueIndex('customers_phone_uq').on(t.tenantId, t.phoneE164)],
);

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    customerId: uuid('customer_id'), // NULL mientras sea un hold anonimo
    staffId: uuid('staff_id').notNull(),
    resourceId: uuid('resource_id'),
    status: text('status').notNull(),
    occupiedStart: ts('occupied_start').notNull(), // incluye colchones
    occupiedEnd: ts('occupied_end').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    source: text('source').notNull(), // web | manual | waitlist | whatsapp
    totalCents: money('total_cents').notNull(),
    depositRequiredCents: money('deposit_required_cents').notNull().default(0),
    depositPaidCents: money('deposit_paid_cents').notNull().default(0),
    paidCents: money('paid_cents').notNull().default(0),
    refundedCents: money('refunded_cents').notNull().default(0),
    paymentMethod: text('payment_method'),
    version: integer('version').notNull().default(1),
    holdExpiresAt: ts('hold_expires_at'),
    notes: text('notes'),
    confirmedByCustomer: boolean('confirmed_by_customer').notNull().default(false),
    consentWhatsapp: boolean('consent_whatsapp').notNull().default(false),
    createdBy: uuid('created_by'),
    checkedInAt: ts('checked_in_at'),
    completedAt: ts('completed_at'),
    canceledAt: ts('canceled_at'),
    cancelReason: text('cancel_reason'),
    rescheduledFrom: uuid('rescheduled_from'),
    ...stamps(),
  },
  (t) => [
    index('appointments_staff_idx').on(t.tenantId, t.staffId, t.startsAt),
    index('appointments_customer_idx').on(t.tenantId, t.customerId, t.startsAt),
    index('appointments_status_idx').on(t.tenantId, t.status, t.startsAt),
  ],
);

export const appointmentItems = pgTable('appointment_items', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  appointmentId: uuid('appointment_id').notNull(),
  serviceId: uuid('service_id').notNull(),
  nameSnapshot: text('name_snapshot').notNull(),
  durationMin: integer('duration_min').notNull(),
  priceCents: money('price_cents').notNull(),
  position: integer('position').notNull().default(0),
});

export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    staffId: uuid('staff_id'),
    windowStart: ts('window_start').notNull(),
    windowEnd: ts('window_end').notNull(),
    status: text('status').notNull().default('waiting'), // waiting|offered|accepted|expired|canceled
    offeredAt: ts('offered_at'),
    offerExpiresAt: ts('offer_expires_at'),
    offeredAppointmentId: uuid('offered_appointment_id'),
    ...stamps(),
  },
  (t) => [index('waitlist_idx').on(t.tenantId, t.status, t.createdAt)],
);

export const messageLog = pgTable(
  'message_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    appointmentId: uuid('appointment_id'),
    customerId: uuid('customer_id'),
    phoneE164: text('phone_e164').notNull(),
    direction: text('direction').notNull().default('out'),
    channel: text('channel').notNull().default('whatsapp'),
    template: text('template'),
    body: text('body').notNull().default(''),
    waMessageId: text('wa_message_id'),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    readByStaff: boolean('read_by_staff').notNull().default(true),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('message_log_phone_idx').on(t.tenantId, t.phoneE164, t.createdAt),
    index('message_log_apt_idx').on(t.tenantId, t.appointmentId),
  ],
);

export const reminderJobs = pgTable(
  'reminder_jobs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    appointmentId: uuid('appointment_id').notNull(),
    jobKey: text('job_key').notNull(), // apt:{id}:r24 ...
    kind: text('kind').notNull(),
    runAt: ts('run_at').notNull(),
    appointmentVersion: integer('appointment_version').notNull(),
    status: text('status').notNull().default('pending'), // pending|sent|skipped|canceled|failed
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    processedAt: ts('processed_at'),
    ...stamps(),
  },
  (t) => [uniqueIndex('reminder_jobs_key_uq').on(t.jobKey), index('reminder_jobs_due_idx').on(t.status, t.runAt)],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    phoneE164: text('phone_e164').notNull(),
    code: text('code').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    verifiedAt: ts('verified_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('otp_phone_idx').on(t.tenantId, t.phoneE164, t.createdAt)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    scope: text('scope').notNull(),
    statusCode: integer('status_code').notNull(),
    response: jsonb('response').$type<unknown>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.scope, t.key] })],
);

/** Intentos fallidos de login por correo (existan o no): bloqueo temporal sin permitir enumerar cuentas. */
export const loginAttempts = pgTable('login_attempts', {
  email: text('email').primaryKey(),
  failedCount: integer('failed_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastAttemptAt: ts('last_attempt_at').notNull().defaultNow(),
});

/** Bitacora de acciones sensibles (exportar/suprimir datos personales). No guarda datos personales. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    correlationId: text('correlation_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const schema = {
  tenants,
  locations,
  users,
  staff,
  services,
  staffServices,
  staffSchedules,
  staffTimeOff,
  customers,
  appointments,
  appointmentItems,
  waitlistEntries,
  messageLog,
  reminderJobs,
  otpCodes,
  idempotencyKeys,
  loginAttempts,
  auditLog,
};
