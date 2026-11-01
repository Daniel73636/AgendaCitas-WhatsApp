import { Inject, Injectable } from '@nestjs/common';
import { type AppointmentDto, PRIVACY_POLICY_VERSION } from '@agenda/contracts';
import {
  type Db,
  type DbHandle,
  and,
  appointmentItems,
  appointments,
  customers,
  eq,
  inArray,
  isExclusionViolation,
  isUniqueViolation,
  staff,
  staffServices,
  uuidv7,
} from '@agenda/db';
import { type ServiceChain, absMinToIso, computeChain, toAbsMin } from '@agenda/domain-booking';
import { CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { isoOf } from '../../common/format';
import { signAppointmentToken } from '../../common/tokens';
import { DB_HANDLE } from '../../core/db.provider';
import type { ServiceRow } from '../availability/availability.service';

export type AptRow = typeof appointments.$inferSelect;
export type ItemRow = typeof appointmentItems.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type StaffRowT = typeof staff.$inferSelect;

export interface PricedItem {
  service: ServiceRow;
  durationMin: number;
  priceCents: number;
}

export interface TimePlan {
  startsAt: Date;
  endsAt: Date;
  occupiedStart: Date;
  occupiedEnd: Date;
  totalCents: number;
  chain: ServiceChain;
}

export interface InsertAppointmentArgs {
  tenantId: string;
  customerId: string | null;
  staffId: string;
  status: AptRow['status'];
  plan: TimePlan;
  items: PricedItem[];
  source: string;
  depositRequiredCents?: number;
  holdExpiresAt?: Date | null;
  notes?: string | null;
  consentWhatsapp?: boolean;
  createdBy?: string | null;
  rescheduledFrom?: string | null;
  now: Date;
}

/** Utilidades transaccionales compartidas por citas, lista de espera y recordatorios. */
@Injectable()
export class BookingCoreService {
  constructor(
    @Inject(DB_HANDLE) readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Ley 1581: exige (si esta configurado) la autorizacion de tratamiento de datos y devuelve lo que se registra. */
  privacy(accepted: boolean | undefined, now: Date): { at: Date; version: string } | undefined {
    if (accepted) return { at: now, version: PRIVACY_POLICY_VERSION };
    if (this.config.privacyConsentRequired) {
      throw new AppError('VALIDATION_ERROR', 'Debes aceptar la politica de tratamiento de datos personales para continuar.');
    }
    return undefined;
  }

  token(appointmentId: string): string {
    return signAppointmentToken(appointmentId, this.config.authSecret);
  }

  /** Precio y duracion de cada servicio con las sobreescrituras del profesional. */
  async priceFor(db: Db, tenantId: string, staffId: string, svcs: ServiceRow[]): Promise<PricedItem[]> {
    const links = await db
      .select()
      .from(staffServices)
      .where(and(eq(staffServices.tenantId, tenantId), eq(staffServices.staffId, staffId), inArray(staffServices.serviceId, svcs.map((s) => s.id))));
    const byId = new Map(links.map((l) => [l.serviceId, l]));
    return svcs.map((service) => {
      const l = byId.get(service.id);
      if (!l) throw new AppError('SLOT_UNAVAILABLE', `El profesional no realiza "${service.name}".`);
      return { service, durationMin: l.durationMinOverride ?? service.durationMin, priceCents: l.priceCentsOverride ?? service.priceCents };
    });
  }

  plan(items: PricedItem[], startsAtIso: string): TimePlan {
    const chain = computeChain(
      items.map((i) => ({ id: i.service.id, durationMin: i.durationMin, bufferBeforeMin: i.service.bufferBeforeMin, bufferAfterMin: i.service.bufferAfterMin })),
    );
    const start = toAbsMin(startsAtIso);
    return {
      startsAt: new Date(absMinToIso(start)),
      endsAt: new Date(absMinToIso(start + chain.visibleMin)),
      occupiedStart: new Date(absMinToIso(start - chain.beforeMin)),
      occupiedEnd: new Date(absMinToIso(start + chain.visibleMin + chain.afterMin)),
      totalCents: items.reduce((a, i) => a + i.priceCents, 0),
      chain,
    };
  }

  /** INSERT con la restriccion EXCLUDE como unico arbitro de solapes. */
  async insertAppointment(db: Db, a: InsertAppointmentArgs): Promise<AptRow> {
    const id = uuidv7();
    const [row] = await db
      .insert(appointments)
      .values({
        id,
        tenantId: a.tenantId,
        customerId: a.customerId,
        staffId: a.staffId,
        status: a.status,
        occupiedStart: a.plan.occupiedStart,
        occupiedEnd: a.plan.occupiedEnd,
        startsAt: a.plan.startsAt,
        endsAt: a.plan.endsAt,
        source: a.source,
        totalCents: a.plan.totalCents,
        depositRequiredCents: a.depositRequiredCents ?? 0,
        holdExpiresAt: a.holdExpiresAt ?? null,
        notes: a.notes ?? null,
        consentWhatsapp: a.consentWhatsapp ?? false,
        createdBy: a.createdBy ?? null,
        rescheduledFrom: a.rescheduledFrom ?? null,
        createdAt: a.now,
        updatedAt: a.now,
      })
      .returning();
    await db.insert(appointmentItems).values(
      a.items.map((i, idx) => ({
        id: uuidv7(), tenantId: a.tenantId, appointmentId: id, serviceId: i.service.id, nameSnapshot: i.service.name,
        durationMin: i.durationMin, priceCents: i.priceCents, position: idx,
      })),
    );
    return row!;
  }

  /** Traduce 23P01 (EXCLUDE) a SLOT_TAKEN; el resto se relanza. */
  throwIfSlotTaken(e: unknown, alternatives?: unknown): never {
    if (isExclusionViolation(e)) {
      throw new AppError('SLOT_TAKEN', 'Ese horario acaba de ser tomado. Elige otro.', alternatives ? { alternatives } : {});
    }
    throw e;
  }

  async upsertCustomer(
    db: Db,
    tenantId: string,
    d: { fullName: string; phone: string; email?: string | null | undefined; consent?: boolean | undefined; privacy?: { at: Date; version: string } | undefined; now: Date },
  ): Promise<CustomerRow> {
    const find = async () => {
      const [c] = await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.phoneE164, d.phone))).limit(1);
      return c;
    };
    const existing = await find();
    if (existing) {
      const patch: Partial<typeof customers.$inferInsert> = {};
      if (d.consent && !existing.consentWhatsapp) patch.consentWhatsapp = true;
      if (d.privacy) { patch.privacyAcceptedAt = d.privacy.at; patch.privacyPolicyVersion = d.privacy.version; }
      if (d.email && !existing.email) patch.email = d.email;
      if (existing.deletedAt) patch.deletedAt = null;
      if (Object.keys(patch).length) {
        const [u] = await db.update(customers).set({ ...patch, updatedAt: d.now }).where(eq(customers.id, existing.id)).returning();
        return u!;
      }
      return existing;
    }
    try {
      const [c] = await db
        .insert(customers)
        .values({
          id: uuidv7(), tenantId, fullName: d.fullName, phoneE164: d.phone, email: d.email || null, consentWhatsapp: d.consent ?? false,
          privacyAcceptedAt: d.privacy?.at ?? null, privacyPolicyVersion: d.privacy?.version ?? null,
          createdAt: d.now, updatedAt: d.now,
        })
        .returning();
      return c!;
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await find();
        if (again) return again;
      }
      throw e;
    }
  }

  async hydrate(tenantId: string, rows: AptRow[], currency = 'COP'): Promise<AppointmentDto[]> {
    if (rows.length === 0) return [];
    const { db } = this.handle;
    const ids = rows.map((r) => r.id);
    const [items, staffRows, custRows] = await Promise.all([
      db.select().from(appointmentItems).where(and(eq(appointmentItems.tenantId, tenantId), inArray(appointmentItems.appointmentId, ids))),
      db.select().from(staff).where(and(eq(staff.tenantId, tenantId), inArray(staff.id, [...new Set(rows.map((r) => r.staffId))]))),
      (() => {
        const cids = [...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x))];
        return cids.length ? db.select().from(customers).where(and(eq(customers.tenantId, tenantId), inArray(customers.id, cids))) : Promise.resolve([] as CustomerRow[]);
      })(),
    ]);
    const staffBy = new Map(staffRows.map((s) => [s.id, s]));
    const custBy = new Map(custRows.map((c) => [c.id, c]));
    return rows.map((r) => {
      const c = r.customerId ? custBy.get(r.customerId) : undefined;
      const s = staffBy.get(r.staffId);
      return {
        id: r.id,
        status: r.status as AppointmentDto['status'],
        version: r.version,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        occupiedStart: r.occupiedStart.toISOString(),
        occupiedEnd: r.occupiedEnd.toISOString(),
        staffId: r.staffId,
        staffName: s?.displayName ?? '—',
        staffColor: s?.color ?? '#7c3aed',
        customerId: r.customerId,
        customerName: c?.fullName ?? null,
        customerPhone: c?.phoneE164 ?? null,
        customerNoShows: c?.noShowCount ?? 0,
        source: r.source,
        totalCents: r.totalCents,
        depositRequiredCents: r.depositRequiredCents,
        depositPaidCents: r.depositPaidCents,
        paidCents: r.paidCents,
        paymentMethod: r.paymentMethod,
        holdExpiresAt: isoOf(r.holdExpiresAt),
        notes: r.notes,
        items: items
          .filter((i) => i.appointmentId === r.id)
          .sort((a, b) => a.position - b.position)
          .map((i) => ({ id: i.id, serviceId: i.serviceId, name: i.nameSnapshot, durationMin: i.durationMin, priceCents: i.priceCents })),
        confirmedByCustomer: r.confirmedByCustomer,
        createdAt: r.createdAt.toISOString(),
        checkedInAt: isoOf(r.checkedInAt),
        completedAt: isoOf(r.completedAt),
        canceledAt: isoOf(r.canceledAt),
        cancelReason: r.cancelReason,
        refundedCents: r.refundedCents,
        currency,
      };
    });
  }
}
