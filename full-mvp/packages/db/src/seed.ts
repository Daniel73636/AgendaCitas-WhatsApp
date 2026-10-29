import { defaultTenantSettings } from '@agenda/contracts';
import {
  type ServiceInput,
  DEFAULT_REMINDER_POLICY,
  absMinToIso,
  addDaysStr,
  buildReminderTimeline,
  computeChain,
  localDateOf,
  parseHm,
  weekdayOf,
  zonedToAbsMin,
} from '@agenda/domain-booking';
import { renderTemplate } from '@agenda/whatsapp';
import { eq, sql } from 'drizzle-orm';
import { type Db, isExclusionViolation } from './client';
import { encryptField, hashPassword, uuidv7 } from './crypto';
import * as t from './schema';

export const DEMO_SLUG = 'belleza-demo';
export const DEMO_ADMIN_EMAIL = 'admin@belleza-demo.com';
export const DEMO_ADMIN_PASSWORD = 'demo1234';
const TZ = 'America/Bogota';
const peso = (n: number) => n * 100; // pesos -> centavos enteros

export async function isSeeded(db: Db): Promise<boolean> {
  const rows = await db.select({ id: t.tenants.id }).from(t.tenants).where(eq(t.tenants.slug, DEMO_SLUG)).limit(1);
  return rows.length > 0;
}

/** PRNG determinista (mulberry32) para que la semilla sea reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedOptions {
  now?: Date;
  fieldKey?: string;
  publicWebUrl?: string;
  log?: (m: string) => void;
}

export async function seedDemo(db: Db, opts: SeedOptions = {}): Promise<{ tenantId: string; appointments: number }> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const fieldKey = opts.fieldKey ?? process.env.FIELD_ENCRYPTION_KEY ?? 'dev-field-key-cambia-esto-en-produccion';
  const web = opts.publicWebUrl ?? process.env.PUBLIC_WEB_URL ?? 'http://localhost:3100';
  const rand = rng(20260301);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

  // --- Tenant / sede / usuarios -------------------------------------------------
  const tenantId = uuidv7();
  await db.insert(t.tenants).values({
    id: tenantId,
    slug: DEMO_SLUG,
    name: 'Belleza Demo',
    description:
      'Salon de belleza y bienestar en Chapinero. Cortes, color, unas y masajes con profesionales certificados. Reserva en linea en menos de un minuto.',
    phone: '+573001234567',
    currency: 'COP',
    settings: defaultTenantSettings() as unknown as Record<string, unknown>,
  });
  const locationId = uuidv7();
  await db.insert(t.locations).values({
    id: locationId,
    tenantId,
    name: 'Sede Chapinero',
    address: 'Calle 63 #10-20, Chapinero, Bogota',
    lat: 4.6486,
    lng: -74.0628,
    timezone: TZ,
  });
  await db.insert(t.users).values([
    { id: uuidv7(), tenantId, email: DEMO_ADMIN_EMAIL, passwordHash: hashPassword(DEMO_ADMIN_PASSWORD), name: 'Admin Belleza Demo', role: 'owner' },
    { id: uuidv7(), tenantId, email: 'recepcion@belleza-demo.com', passwordHash: hashPassword(DEMO_ADMIN_PASSWORD), name: 'Recepcion', role: 'staff' },
  ]);

  // --- Equipo --------------------------------------------------------------------
  const staffRows = [
    { key: 'camila', displayName: 'Camila Rojas', bio: 'Estilista senior con 10 anos de experiencia en corte y color.', specialties: ['Corte', 'Color', 'Peinados'], color: '#db2777', priority: 3, commissionPct: 40 },
    { key: 'andres', displayName: 'Andres Pardo', bio: 'Barbero y estilista. Especialista en cortes masculinos y barba.', specialties: ['Barberia', 'Corte', 'Barba'], color: '#2563eb', priority: 2, commissionPct: 35 },
    { key: 'valentina', displayName: 'Valentina Cruz', bio: 'Manicurista y terapeuta de masajes relajantes.', specialties: ['Unas', 'Masajes'], color: '#059669', priority: 1, commissionPct: 35 },
  ].map((s) => ({ ...s, id: uuidv7() }));
  await db.insert(t.staff).values(
    staffRows.map((s) => ({
      id: s.id, tenantId, locationId, displayName: s.displayName, bio: s.bio, specialties: s.specialties,
      color: s.color, priority: s.priority, commissionPct: s.commissionPct, active: true,
    })),
  );
  const S = Object.fromEntries(staffRows.map((s) => [s.key, s])) as Record<'camila' | 'andres' | 'valentina', (typeof staffRows)[number]>;

  // --- Servicios ------------------------------------------------------------------
  const svcRows = [
    { key: 'corte', name: 'Corte de cabello', description: 'Lavado, corte y secado con asesoria de imagen.', category: 'Cabello', durationMin: 45, before: 0, after: 5, price: peso(55000), deposit: 0 },
    { key: 'barba', name: 'Corte y barba', description: 'Corte clasico o moderno con perfilado de barba y toalla caliente.', category: 'Barberia', durationMin: 40, before: 0, after: 5, price: peso(38000), deposit: 0 },
    { key: 'manicure', name: 'Manicure semipermanente', description: 'Limpieza, forma, esmaltado semipermanente y masaje de manos.', category: 'Unas', durationMin: 60, before: 0, after: 0, price: peso(45000), deposit: 0 },
    { key: 'color', name: 'Coloracion completa', description: 'Diagnostico, tinte o mechas, tratamiento y peinado final.', category: 'Cabello', durationMin: 150, before: 0, after: 10, price: peso(220000), deposit: peso(60000) },
    { key: 'masaje', name: 'Masaje relajante', description: 'Masaje de espalda y cuello con aceites esenciales (60 min).', category: 'Bienestar', durationMin: 60, before: 5, after: 10, price: peso(90000), deposit: 0 },
  ].map((s) => ({ ...s, id: uuidv7() }));
  await db.insert(t.services).values(
    svcRows.map((s) => ({
      id: s.id, tenantId, name: s.name, description: s.description, category: s.category,
      durationMin: s.durationMin, bufferBeforeMin: s.before, bufferAfterMin: s.after,
      priceCents: s.price, currency: 'COP', depositCents: s.deposit, visiblePublic: true, active: true,
    })),
  );
  const V = Object.fromEntries(svcRows.map((s) => [s.key, s])) as Record<'corte' | 'barba' | 'manicure' | 'color' | 'masaje', (typeof svcRows)[number]>;

  const link: Array<{ staff: keyof typeof S; svc: keyof typeof V; price?: number; dur?: number }> = [
    { staff: 'camila', svc: 'corte' }, { staff: 'camila', svc: 'barba' }, { staff: 'camila', svc: 'color' },
    { staff: 'andres', svc: 'corte', price: peso(50000) }, { staff: 'andres', svc: 'barba' }, { staff: 'andres', svc: 'color', dur: 180 },
    { staff: 'valentina', svc: 'manicure' }, { staff: 'valentina', svc: 'masaje' },
  ];
  await db.insert(t.staffServices).values(
    link.map((l) => ({
      tenantId, staffId: S[l.staff].id, serviceId: V[l.svc].id,
      priceCentsOverride: l.price ?? null, durationMinOverride: l.dur ?? null,
    })),
  );
  const staffServicesMap = (staffKey: keyof typeof S) => link.filter((l) => l.staff === staffKey);

  // --- Horarios Lun-Sab ----------------------------------------------------------
  type Block = { weekday: number; start: string; end: string };
  const schedules: Record<keyof typeof S, Block[]> = {
    camila: [
      ...[1, 2, 3, 4, 5].flatMap((d) => [{ weekday: d, start: '09:00', end: '13:00' }, { weekday: d, start: '14:00', end: '19:00' }]),
      { weekday: 6, start: '09:00', end: '15:00' },
    ],
    andres: [
      ...[2, 3, 4, 5].flatMap((d) => [{ weekday: d, start: '10:00', end: '13:00' }, { weekday: d, start: '14:00', end: '20:00' }]),
      { weekday: 6, start: '09:00', end: '16:00' },
    ],
    valentina: [
      ...[1, 2, 3, 4, 5].flatMap((d) => [{ weekday: d, start: '09:00', end: '13:00' }, { weekday: d, start: '14:00', end: '18:00' }]),
      { weekday: 6, start: '09:00', end: '14:00' },
    ],
  };
  await db.insert(t.staffSchedules).values(
    (Object.keys(schedules) as Array<keyof typeof S>).flatMap((k) =>
      schedules[k].map((b) => ({ id: uuidv7(), tenantId, staffId: S[k].id, weekday: b.weekday, startTime: b.start, endTime: b.end })),
    ),
  );

  // Excepciones: permiso de Andres en 3 dias y festivo de toda la sede en 3 semanas
  const today = localDateOf(Math.floor(now.getTime() / 60000), TZ);
  const d3 = addDaysStr(today, 3);
  const at = (date: string, mins: number) => new Date(absMinToIso(zonedToAbsMin(date, mins, TZ)));
  await db.insert(t.staffTimeOff).values([
    { id: uuidv7(), tenantId, staffId: S.andres.id, startsAt: at(d3, 14 * 60), endsAt: at(d3, 16 * 60), reason: 'Cita medica', isExtraOpening: false },
    { id: uuidv7(), tenantId, staffId: null, locationId, startsAt: at(addDaysStr(today, 21), 0), endsAt: at(addDaysStr(today, 22), 0), reason: 'Festivo - sede cerrada', isExtraOpening: false },
  ]);

  // --- Clientes ------------------------------------------------------------------
  const custData = [
    ['Laura Gomez', '+573001112233', 'laura.gomez@example.com', '1992-04-12', 'Prefiere agua sin gas. Alergica al amoniaco.', ['vip']],
    ['Carlos Mendez', '+573002223344', null, '1988-11-02', null, []],
    ['Sofia Ramirez', '+573003334455', 'sofia.r@example.com', '1995-07-28', 'Le gusta el cafe con leche.', []],
    ['Juan Pablo Torres', '+573004445566', null, null, 'Ha faltado a citas anteriores. Solicitar anticipo.', ['riesgo']],
    ['Maria Fernanda Lopez', '+573005556677', 'mafe.lopez@example.com', '1990-01-19', null, ['vip']],
    ['Daniela Ortiz', '+573006667788', null, '1998-09-05', null, []],
    ['Felipe Castano', '+573007778899', 'felipe.c@example.com', null, null, []],
    ['Ana Lucia Vargas', '+573008889900', null, '1985-12-24', 'Cliente desde 2021.', []],
  ] as const;
  const custRows = custData.map((c) => ({ id: uuidv7(), c }));
  await db.insert(t.customers).values(
    custRows.map(({ id, c }) => ({
      id, tenantId, fullName: c[0], phoneE164: c[1], email: c[2], birthday: c[3],
      notesEnc: c[4] ? encryptField(c[4], fieldKey) : null, tags: [...c[5]], consentWhatsapp: true,
    })),
  );
  const customerIds = custRows.map((r) => r.id);
  const riskyCustomer = customerIds[3]!;

  // --- Citas: relleno determinista por dia/profesional ---------------------------
  const svcInput = (l: (typeof link)[number]): ServiceInput => ({
    id: V[l.svc].id, durationMin: l.dur ?? V[l.svc].durationMin, bufferBeforeMin: V[l.svc].before, bufferAfterMin: V[l.svc].after,
  });
  let created = 0;
  const futureApts: Array<{ id: string; startsAt: string; endsAt: string; customerId: string; serviceName: string; staffName: string; phone: string; name: string }> = [];

  for (let off = -14; off <= 10; off++) {
    const date = addDaysStr(today, off);
    const wd = weekdayOf(date);
    if (wd === 0 || date === addDaysStr(today, 21)) continue;
    const density = off < 0 ? 0.6 : off <= 2 ? 0.8 : 0.4;
    for (const key of ['camila', 'andres', 'valentina'] as const) {
      for (const b of schedules[key].filter((x) => x.weekday === wd)) {
        let cursor = parseHm(b.start);
        const end = parseHm(b.end);
        while (cursor < end) {
          if (rand() > density) { cursor += pick([15, 30, 45, 60]); continue; }
          const l = pick(staffServicesMap(key));
          const si = svcInput(l);
          const chain = computeChain([si]);
          if (cursor + chain.occupiedMin > end) break;
          if (key === 'andres' && date === d3 && cursor < 16 * 60 && cursor + chain.occupiedMin > 14 * 60) { cursor += 30; continue; }
          const startAbs = zonedToAbsMin(date, cursor, TZ);
          const startsAt = absMinToIso(startAbs);
          const endsAt = absMinToIso(startAbs + chain.visibleMin);
          const isPast = Date.parse(endsAt) < now.getTime();
          const isOngoing = !isPast && Date.parse(startsAt) <= now.getTime();
          const r = rand();
          const price = l.price ?? V[l.svc].price;
          const deposit = V[l.svc].deposit;
          let status: 'completed' | 'no_show' | 'canceled' | 'confirmed' | 'pending' | 'in_progress';
          if (isPast) status = r < 0.82 ? 'completed' : r < 0.91 ? 'no_show' : 'canceled';
          else if (isOngoing) status = 'in_progress';
          else status = deposit > 0 && r > 0.8 ? 'pending' : 'confirmed'; // pendiente = esperando el anticipo
          const customerId = status === 'no_show' && rand() < 0.7 ? riskyCustomer : pick(customerIds);
          const depositPaid = deposit > 0 && (status === 'completed' || status === 'confirmed' || status === 'in_progress') ? deposit : 0;
          const id = uuidv7();
          try {
            await db.insert(t.appointments).values({
              id, tenantId, customerId, staffId: S[key].id, status,
              occupiedStart: new Date(absMinToIso(startAbs - chain.beforeMin)),
              occupiedEnd: new Date(absMinToIso(startAbs + chain.visibleMin + chain.afterMin)),
              startsAt: new Date(startsAt), endsAt: new Date(endsAt),
              source: pick(['web', 'web', 'manual', 'whatsapp']),
              totalCents: price, depositRequiredCents: deposit, depositPaidCents: depositPaid,
              paidCents: status === 'completed' ? price : 0,
              paymentMethod: status === 'completed' ? pick(['cash', 'card', 'transfer']) : null,
              confirmedByCustomer: status === 'confirmed' ? rand() < 0.6 : status === 'completed',
              consentWhatsapp: true, version: 1,
              completedAt: status === 'completed' ? new Date(endsAt) : null,
              canceledAt: status === 'canceled' ? new Date(startAbs * 60000 - 86_400_000) : null,
              cancelReason: status === 'canceled' ? 'Cancelada por el cliente' : null,
              checkedInAt: status === 'in_progress' || status === 'completed' ? new Date(startsAt) : null,
              createdAt: new Date(Math.min(now.getTime(), startAbs * 60000 - 3 * 86_400_000)),
            });
            await db.insert(t.appointmentItems).values({
              id: uuidv7(), tenantId, appointmentId: id, serviceId: V[l.svc].id,
              nameSnapshot: V[l.svc].name, durationMin: si.durationMin, priceCents: price, position: 0,
            });
            created++;
            if (isPast && status !== 'canceled' && rand() < 0.85) {
              // historial: recordatorio enviado un dia antes (alimenta el "ImpactBanner")
              const cust = custRows.find((c) => c.id === customerId)!.c;
              const sent = new Date(startAbs * 60000 - 24 * 3_600_000);
              await db.insert(t.messageLog).values({
                id: uuidv7(), tenantId, appointmentId: id, customerId, phoneE164: cust[1], direction: 'out', template: 'appointment_reminder_24h',
                body: renderTemplate('appointment_reminder_24h', { name: cust[0].split(' ')[0]!, service: V[l.svc].name, date: 'manana', time: '', business: 'Belleza Demo' }).body,
                status: 'sent', sentAt: sent, createdAt: sent,
              });
            }
            if (!isPast && status === 'confirmed') {
              const cust = custRows.find((c) => c.id === customerId)!.c;
              futureApts.push({ id, startsAt, endsAt, customerId, serviceName: V[l.svc].name, staffName: S[key].displayName, phone: cust[1], name: cust[0] });
            }
          } catch (e) {
            if (!isExclusionViolation(e)) throw e;
          }
          cursor += chain.occupiedMin + pick([0, 0, 15, 30, 60]);
        }
      }
    }
  }

  // Recalcular contadores reales por cliente
  await db.execute(sql`
    UPDATE customers c SET
      no_show_count = (SELECT count(*) FROM appointments a WHERE a.customer_id = c.id AND a.status = 'no_show'),
      late_cancel_count = (SELECT count(*) FROM appointments a WHERE a.customer_id = c.id AND a.status = 'canceled')
    WHERE c.tenant_id = ${tenantId}`);
  await db.execute(sql`UPDATE customers SET no_show_count = GREATEST(no_show_count, 2) WHERE id = ${riskyCustomer}`);

  // --- Mensajes y recordatorios para citas futuras -------------------------------
  const reminderFlags = defaultTenantSettings().reminders;
  let msgs = 0;
  for (const a of futureApts) {
    const when = new Date(a.startsAt);
    const dateLabel = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(when);
    const timeLabel = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(when);
    const rendered = renderTemplate('appointment_confirmation', {
      name: a.name.split(' ')[0]!, service: a.serviceName, date: dateLabel, time: timeLabel, staff: a.staffName,
      business: 'Belleza Demo', link: `${web}/${DEMO_SLUG}`,
    });
    await db.insert(t.messageLog).values({
      id: uuidv7(), tenantId, appointmentId: a.id, customerId: a.customerId, phoneE164: a.phone, direction: 'out',
      template: 'appointment_confirmation', body: rendered.body, status: 'delivered', waMessageId: `seed.${msgs}`,
      sentAt: now, deliveredAt: now, createdAt: new Date(now.getTime() - 3_600_000 * ((msgs % 20) + 1)),
    });
    msgs++;
    const plan = buildReminderTimeline({
      appointmentId: a.id, startsAt: a.startsAt, endsAt: a.endsAt, now: nowIso, timezone: TZ,
      policy: { ...DEFAULT_REMINDER_POLICY, ...reminderFlags },
    });
    for (const p of plan) {
      await db.insert(t.reminderJobs).values({
        id: uuidv7(), tenantId, appointmentId: a.id, jobKey: p.jobKey, kind: p.kind, runAt: new Date(p.runAt),
        appointmentVersion: 1, status: p.kind === 'confirm' ? 'sent' : 'pending', processedAt: p.kind === 'confirm' ? now : null,
      });
    }
  }
  // Conversaciones entrantes de ejemplo (sin leer)
  const inbound: Array<[number, string, number]> = [
    [4, 'Hola, ¿tienen cupo para manana en la tarde para un corte?', 25],
    [0, 'Buenas, ¿pueden agregar un manicure a mi cita del viernes?', 70],
    [1, 'Gracias por el recordatorio, ahi estare!', 180],
  ];
  for (const [ci, body, minAgo] of inbound) {
    const c = custRows[ci]!;
    await db.insert(t.messageLog).values({
      id: uuidv7(), tenantId, customerId: c.id, phoneE164: c.c[1], direction: 'in', template: null, body, status: 'received',
      readByStaff: false, createdAt: new Date(now.getTime() - minAgo * 60_000), sentAt: new Date(now.getTime() - minAgo * 60_000),
    });
  }

  // --- Lista de espera -----------------------------------------------------------
  const tomorrow = addDaysStr(today, 1);
  await db.insert(t.waitlistEntries).values({
    id: uuidv7(), tenantId, customerId: customerIds[7]!, serviceId: V.corte.id, staffId: null,
    windowStart: at(tomorrow, 9 * 60), windowEnd: at(tomorrow, 19 * 60), status: 'waiting',
  });

  log(`Semilla lista: ${created} citas (${futureApts.length} futuras con recordatorios programados).`);
  return { tenantId, appointments: created };
}
