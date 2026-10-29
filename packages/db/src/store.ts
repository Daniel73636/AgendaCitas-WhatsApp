import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export type Id = string;

export interface Tenant {
  id: Id; name: string; slug: string; timezone: string;
}
export interface Location {
  id: Id; tenantId: Id; name: string; address?: string; timezone: string;
}
export interface Staff {
  id: Id; tenantId: Id; locationId: Id; displayName: string; active: boolean; photoKey?: string;
}
export interface Service {
  id: Id; tenantId: Id; name: string; description?: string;
  durationMin: number; bufferBeforeMin: number; bufferAfterMin: number;
  priceCents: number; currency: string; depositCents: number; capacity: number; visiblePublic: boolean;
}
export interface StaffService { staffId: Id; serviceId: Id }
export interface StaffSchedule {
  id: Id; tenantId: Id; staffId: Id; weekday: number; startTime: string; endTime: string;
}
export interface Customer {
  id: Id; tenantId: Id; fullName: string; phoneE164: string; email?: string;
  noShowCount: number; lateCancelCount: number; tags: string[];
}
export interface Appointment {
  id: Id; tenantId: Id; customerId?: Id; staffId: Id; status: string;
  startsAt: string; endsAt: string; occupiedStart: string; occupiedEnd: string;
  source: string; totalCents: number; depositPaidCents: number; version: number;
  holdExpiresAt?: string; serviceIds: Id[]; nameSnapshots: string[];
}
export interface MessageLog {
  id: Id; tenantId: Id; appointmentId?: Id; channel: string; template?: string;
  status: string; sentAt: string;
}

export interface StoreData {
  tenants: Tenant[];
  locations: Location[];
  staff: Staff[];
  services: Service[];
  staffServices: StaffService[];
  schedules: StaffSchedule[];
  customers: Customer[];
  appointments: Appointment[];
  messages: MessageLog[];
  otps: Record<string, { code: string; expiresAt: number }>;
  events: Array<{ id: string; tenantId: string; type: string; payload: unknown; at: string }>;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.AGENDA_DATA_DIR || path.resolve(HERE, "../../../data");
const DATA_FILE = path.join(DATA_DIR, "agenda-store.json");

function empty(): StoreData {
  return {
    tenants: [], locations: [], staff: [], services: [], staffServices: [],
    schedules: [], customers: [], appointments: [], messages: [], otps: {}, events: [],
  };
}

let mem: StoreData | null = null;

export function loadStore(): StoreData {
  if (mem) return mem;
  try {
    if (fs.existsSync(DATA_FILE)) {
      mem = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as StoreData;
      return mem;
    }
  } catch { /* ignore */ }
  mem = empty();
  return mem;
}

export function saveStore(): void {
  if (!mem) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(mem, null, 2));
}

export function resetStore(data: StoreData): void {
  mem = data;
  saveStore();
}

export function uid(): string {
  return randomUUID();
}
