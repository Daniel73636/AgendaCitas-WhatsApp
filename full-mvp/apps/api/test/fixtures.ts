import { defaultTenantSettings } from '@agenda/contracts';
import {
  type DbHandle,
  appointmentItems,
  appointments,
  customers,
  hashPassword,
  locations,
  services,
  staff,
  staffSchedules,
  staffServices,
  tenants,
  users,
  uuidv7,
} from '@agenda/db';

export interface TenantFixture {
  tenantId: string;
  slug: string;
  email: string;
  password: string;
  staffId: string;
  serviceId: string;
  customerId: string;
  customerPhone: string;
  appointmentId: string;
}

/** Crea un SEGUNDO negocio completo (propietario, profesional, servicio, horario, cliente y una cita futura). */
export async function createSecondTenant(handle: DbHandle, slug = 'otro-negocio'): Promise<TenantFixture> {
  const { db } = handle;
  const tenantId = uuidv7();
  const password = 'otro-negocio-1234';
  const email = `owner@${slug}.com`;
  await db.insert(tenants).values({ id: tenantId, slug, name: 'Otro Negocio', currency: 'COP', settings: defaultTenantSettings() as unknown as Record<string, unknown> });
  await db.insert(locations).values({ id: uuidv7(), tenantId, name: 'Sede', address: 'Calle 1 #2-3', timezone: 'America/Bogota' });
  await db.insert(users).values({ id: uuidv7(), tenantId, email, passwordHash: hashPassword(password), name: 'Dueno Otro', role: 'owner' });
  const staffId = uuidv7();
  await db.insert(staff).values({ id: staffId, tenantId, displayName: 'Pro Otro', color: '#112233' });
  const serviceId = uuidv7();
  await db.insert(services).values({ id: serviceId, tenantId, name: 'Servicio Otro', durationMin: 30, priceCents: 5_000_000, depositCents: 0 });
  await db.insert(staffServices).values({ tenantId, staffId, serviceId });
  await db.insert(staffSchedules).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ id: uuidv7(), tenantId, staffId, weekday, startTime: '09:00', endTime: '17:00' })),
  );
  const customerId = uuidv7();
  const customerPhone = '+573009998877';
  await db.insert(customers).values({ id: customerId, tenantId, fullName: 'Cliente Del Otro', phoneE164: customerPhone, consentWhatsapp: true });
  const appointmentId = uuidv7();
  const start = new Date(Date.now() + 5 * 86_400_000);
  start.setUTCHours(15, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60_000);
  await db.insert(appointments).values({
    id: appointmentId, tenantId, customerId, staffId, status: 'confirmed', occupiedStart: start, occupiedEnd: end, startsAt: start, endsAt: end,
    source: 'manual', totalCents: 5_000_000, consentWhatsapp: true,
  });
  await db.insert(appointmentItems).values({ id: uuidv7(), tenantId, appointmentId, serviceId, nameSnapshot: 'Servicio Otro', durationMin: 30, priceCents: 5_000_000, position: 0 });
  return { tenantId, slug, email, password, staffId, serviceId, customerId, customerPhone, appointmentId };
}
