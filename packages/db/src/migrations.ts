/**
 * Migraciones SQL versionadas (embebidas como strings para funcionar igual con
 * PostgreSQL real y con PGlite, sin depender del sistema de archivos).
 */
export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    name: '0001_init',
    sql: /* sql */ `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  phone text,
  currency text NOT NULL DEFAULT 'COP',
  logo_url text,
  cover_url text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  address text,
  lat double precision,
  lng double precision,
  timezone text NOT NULL DEFAULT 'America/Bogota',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (email);

CREATE TABLE staff (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  location_id uuid REFERENCES locations(id),
  display_name text NOT NULL,
  bio text,
  specialties text[] NOT NULL DEFAULT '{}'::text[],
  color text NOT NULL DEFAULT '#7c3aed',
  photo_url text,
  active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  commission_pct double precision NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_tenant_idx ON staff (tenant_id);

CREATE TABLE services (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text,
  category text,
  image_url text,
  duration_min integer NOT NULL CHECK (duration_min > 0),
  buffer_before_min integer NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
  buffer_after_min integer NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  currency text NOT NULL DEFAULT 'COP',
  deposit_cents bigint NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  capacity integer NOT NULL DEFAULT 1,
  visible_public boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX services_tenant_idx ON services (tenant_id);

CREATE TABLE staff_services (
  staff_id uuid NOT NULL REFERENCES staff(id),
  service_id uuid NOT NULL REFERENCES services(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  price_cents_override bigint,
  duration_min_override integer,
  PRIMARY KEY (staff_id, service_id)
);

CREATE TABLE staff_schedules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  staff_id uuid NOT NULL REFERENCES staff(id),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX staff_schedules_idx ON staff_schedules (tenant_id, staff_id);

CREATE TABLE staff_time_off (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  staff_id uuid REFERENCES staff(id),
  location_id uuid REFERENCES locations(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  is_extra_opening boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX staff_time_off_idx ON staff_time_off (tenant_id, starts_at);

CREATE TABLE customers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  full_name text NOT NULL,
  phone_e164 text NOT NULL,
  email text,
  birthday date,
  notes_enc text,
  no_show_count integer NOT NULL DEFAULT 0,
  late_cancel_count integer NOT NULL DEFAULT 0,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  consent_whatsapp boolean NOT NULL DEFAULT false,
  merged_into uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_phone_uq ON customers (tenant_id, phone_e164);

CREATE TABLE appointments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_id uuid REFERENCES customers(id),
  staff_id uuid NOT NULL REFERENCES staff(id),
  resource_id uuid,
  status text NOT NULL CHECK (status IN
    ('held','pending','confirmed','in_progress','completed','no_show','canceled')),
  occupied_start timestamptz NOT NULL,
  occupied_end timestamptz NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  source text NOT NULL,
  total_cents bigint NOT NULL,
  deposit_required_cents bigint NOT NULL DEFAULT 0,
  deposit_paid_cents bigint NOT NULL DEFAULT 0,
  paid_cents bigint NOT NULL DEFAULT 0,
  refunded_cents bigint NOT NULL DEFAULT 0,
  payment_method text,
  version integer NOT NULL DEFAULT 1,
  hold_expires_at timestamptz,
  notes text,
  confirmed_by_customer boolean NOT NULL DEFAULT false,
  consent_whatsapp boolean NOT NULL DEFAULT false,
  created_by uuid,
  checked_in_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  rescheduled_from uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (occupied_end > occupied_start),
  CHECK (ends_at > starts_at),
  -- EL SEGURO CONTRA CRUCES, IMPOSIBLE DE SALTARSE (SQLSTATE 23P01):
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    staff_id WITH =,
    tstzrange(occupied_start, occupied_end, '[)') WITH &&
  ) WHERE (status IN ('held','pending','confirmed','in_progress'))
);
CREATE INDEX appointments_staff_idx ON appointments (tenant_id, staff_id, starts_at);
CREATE INDEX appointments_customer_idx ON appointments (tenant_id, customer_id, starts_at DESC);
CREATE INDEX appointments_status_idx ON appointments (tenant_id, status, starts_at);

CREATE TABLE appointment_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  name_snapshot text NOT NULL,
  duration_min integer NOT NULL,
  price_cents bigint NOT NULL,
  position integer NOT NULL DEFAULT 0
);
CREATE INDEX appointment_items_apt_idx ON appointment_items (appointment_id);

CREATE TABLE waitlist_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  service_id uuid NOT NULL REFERENCES services(id),
  staff_id uuid REFERENCES staff(id),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','accepted','expired','canceled')),
  offered_at timestamptz,
  offer_expires_at timestamptz,
  offered_appointment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waitlist_idx ON waitlist_entries (tenant_id, status, created_at);

CREATE TABLE message_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid,
  customer_id uuid,
  phone_e164 text NOT NULL,
  direction text NOT NULL DEFAULT 'out' CHECK (direction IN ('in','out')),
  channel text NOT NULL DEFAULT 'whatsapp',
  template text,
  body text NOT NULL DEFAULT '',
  wa_message_id text,
  status text NOT NULL,
  error_code text,
  read_by_staff boolean NOT NULL DEFAULT true,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_log_phone_idx ON message_log (tenant_id, phone_e164, created_at);
CREATE INDEX message_log_apt_idx ON message_log (tenant_id, appointment_id);

CREATE TABLE reminder_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  job_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('confirm','r24','r6','r2','review')),
  run_at timestamptz NOT NULL,
  appointment_version integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped','canceled','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reminder_jobs_key_uq ON reminder_jobs (job_key);
CREATE INDEX reminder_jobs_due_idx ON reminder_jobs (status, run_at);

CREATE TABLE otp_codes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  phone_e164 text NOT NULL,
  code text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_idx ON otp_codes (tenant_id, phone_e164, created_at);

CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope text NOT NULL,
  key text NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, key)
);
`,
  },
];
