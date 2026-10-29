import { Inject, Injectable } from '@nestjs/common';
import type { AvailabilityResponse, SlotDto } from '@agenda/contracts';
import {
  type DbHandle,
  and,
  appointments,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  services,
  staff,
  staffSchedules,
  staffServices,
  staffTimeOff,
  sql,
} from '@agenda/db';
import {
  ACTIVE_STATUSES,
  type Slot,
  type StaffAvailability,
  addDaysStr,
  computeChain,
  computeSlots,
  zonedToAbsMin,
} from '@agenda/domain-booking';
import { AppError } from '../../common/errors';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import type { TenantContext } from '../../core/tenant-context.service';

export type ServiceRow = typeof services.$inferSelect;
export type StaffRow = typeof staff.$inferSelect;

export interface AvailabilityParams {
  serviceIds: string[];
  staffId: string | 'any';
  from: string;
  to: string;
  ignoreRules?: boolean | undefined;
  excludeAppointmentId?: string | undefined;
  publicOnly?: boolean | undefined;
}

export interface AvailabilityResult {
  slots: Slot[];
  services: ServiceRow[];
  staff: StaffRow[];
  overrides: Map<string, { priceCentsOverride: number | null; durationMinOverride: number | null }>; // key staffId|serviceId
}

export const toSlotDto = (s: Slot): SlotDto => ({
  date: s.date, start: s.start, end: s.end, staffId: s.staffId, staffIds: s.staffIds, label: s.label,
});

@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(ClockService) private readonly clock: ClockService,
  ) {}

  /** Servicios solicitados (en el orden pedido). Valida que existan y esten activos. */
  async loadServices(tenantId: string, ids: string[], publicOnly = false): Promise<ServiceRow[]> {
    const unique = [...new Set(ids)];
    const rows = await this.handle.db
      .select()
      .from(services)
      .where(and(eq(services.tenantId, tenantId), inArray(services.id, unique), eq(services.active, true), isNull(services.deletedAt)));
    const filtered = publicOnly ? rows.filter((r) => r.visiblePublic) : rows;
    if (filtered.length !== unique.length) throw new AppError('NOT_FOUND', 'Alguno de los servicios ya no esta disponible.');
    const byId = new Map(filtered.map((r) => [r.id, r]));
    return unique.map((id) => byId.get(id)!);
  }

  async compute(ctx: TenantContext, p: AvailabilityParams): Promise<AvailabilityResult> {
    const { db } = this.handle;
    const tenantId = ctx.tenant.id;
    const svcRows = await this.loadServices(tenantId, p.serviceIds, p.publicOnly);

    // Profesionales activos que realizan TODOS los servicios
    const staffRows = await db
      .select()
      .from(staff)
      .where(and(eq(staff.tenantId, tenantId), eq(staff.active, true), isNull(staff.deletedAt)));
    const links = await db
      .select()
      .from(staffServices)
      .where(and(eq(staffServices.tenantId, tenantId), inArray(staffServices.serviceId, svcRows.map((s) => s.id))));
    const overrides = new Map<string, { priceCentsOverride: number | null; durationMinOverride: number | null }>();
    const canDo = new Map<string, Set<string>>();
    for (const l of links) {
      overrides.set(`${l.staffId}|${l.serviceId}`, { priceCentsOverride: l.priceCentsOverride, durationMinOverride: l.durationMinOverride });
      (canDo.get(l.staffId) ?? canDo.set(l.staffId, new Set()).get(l.staffId)!).add(l.serviceId);
    }
    let candidates = staffRows.filter((s) => svcRows.every((sv) => canDo.get(s.id)?.has(sv.id)));
    if (p.staffId !== 'any') {
      candidates = candidates.filter((s) => s.id === p.staffId);
      if (candidates.length === 0) throw new AppError('SLOT_UNAVAILABLE', 'El profesional elegido no realiza todos los servicios seleccionados.');
    }
    if (candidates.length === 0) return { slots: [], services: svcRows, staff: [], overrides };

    const rangeStart = new Date((zonedToAbsMin(p.from, 0, ctx.tz) - 1440) * 60_000);
    const rangeEnd = new Date((zonedToAbsMin(addDaysStr(p.to, 1), 0, ctx.tz) + 1440) * 60_000);
    const ids = candidates.map((c) => c.id);
    const now = this.clock.now();

    const [schedRows, offRows, busyRows] = await Promise.all([
      db.select().from(staffSchedules).where(and(eq(staffSchedules.tenantId, tenantId), inArray(staffSchedules.staffId, ids))),
      db
        .select()
        .from(staffTimeOff)
        .where(
          and(
            eq(staffTimeOff.tenantId, tenantId),
            lt(staffTimeOff.startsAt, rangeEnd),
            gt(staffTimeOff.endsAt, rangeStart),
            or(isNull(staffTimeOff.staffId), inArray(staffTimeOff.staffId, ids)),
          ),
        ),
      db
        .select({
          id: appointments.id, staffId: appointments.staffId, s: appointments.occupiedStart, e: appointments.occupiedEnd,
          status: appointments.status, hold: appointments.holdExpiresAt,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.tenantId, tenantId),
            inArray(appointments.staffId, ids),
            inArray(appointments.status, [...ACTIVE_STATUSES]),
            lt(appointments.occupiedStart, rangeEnd),
            gt(appointments.occupiedEnd, rangeStart),
            sql`NOT (${appointments.holdExpiresAt} IS NOT NULL AND ${appointments.holdExpiresAt} < ${now} AND ${appointments.status} IN ('held','pending'))`,
          ),
        ),
    ]);

    const chainInput = svcRows.map((s) => ({ id: s.id, durationMin: s.durationMin, bufferBeforeMin: s.bufferBeforeMin, bufferAfterMin: s.bufferAfterMin }));
    const team: StaffAvailability[] = candidates.map((c) => {
      const durationOverrides: Record<string, number> = {};
      for (const sv of svcRows) {
        const o = overrides.get(`${c.id}|${sv.id}`)?.durationMinOverride;
        if (o) durationOverrides[sv.id] = o;
      }
      return {
        id: c.id,
        priority: c.priority,
        durationOverrides,
        schedule: schedRows
          .filter((r) => r.staffId === c.id)
          .map((r) => ({ weekday: r.weekday, start: r.startTime.slice(0, 5), end: r.endTime.slice(0, 5) })),
        timeOff: offRows
          .filter((o) => !o.isExtraOpening && (o.staffId === null || o.staffId === c.id))
          .map((o) => ({ start: o.startsAt.toISOString(), end: o.endsAt.toISOString() })),
        extraOpenings: offRows
          .filter((o) => o.isExtraOpening && (o.staffId === null || o.staffId === c.id))
          .map((o) => ({ start: o.startsAt.toISOString(), end: o.endsAt.toISOString() })),
        busy: busyRows
          .filter((b) => b.staffId === c.id && b.id !== p.excludeAppointmentId)
          .map((b) => ({ start: b.s.toISOString(), end: b.e.toISOString() })),
      };
    });

    const s = ctx.settings;
    const slots = computeSlots({
      now: now.toISOString(),
      timezone: ctx.tz,
      fromDate: p.from,
      toDate: p.to,
      services: chainInput,
      staff: team,
      rules: {
        minNoticeMin: p.ignoreRules ? 0 : s.minNoticeMin,
        maxAdvanceDays: p.ignoreRules ? 3650 : s.maxAdvanceDays,
        stepMin: s.stepMin,
        assignment: s.assignment,
      },
    });
    return { slots, services: svcRows, staff: candidates, overrides };
  }

  /** Respuesta publica/panel: huecos + proxima fecha disponible si el rango esta vacio. */
  async availability(ctx: TenantContext, p: AvailabilityParams): Promise<AvailabilityResponse> {
    const maxRange = 62;
    let to = p.to;
    if (to < p.from) to = p.from;
    // limitar rango para proteger el calculo
    const days = Math.round((Date.parse(to) - Date.parse(p.from)) / 86_400_000);
    if (days > maxRange) to = addDaysStr(p.from, maxRange);
    const res = await this.compute(ctx, { ...p, to });
    let nextAvailableDate: string | null = null;
    if (res.slots.length === 0) {
      // buscar la proxima fecha con cupo despues del rango (hasta 60 dias)
      const after = await this.compute(ctx, { ...p, from: addDaysStr(to, 1), to: addDaysStr(to, 60) });
      nextAvailableDate = after.slots[0]?.date ?? null;
    }
    const pricingStaff = p.staffId === 'any' ? null : p.staffId;
    const total = res.services.reduce((acc, sv) => acc + (pricingStaff ? (res.overrides.get(`${pricingStaff}|${sv.id}`)?.priceCentsOverride ?? sv.priceCents) : sv.priceCents), 0);
    const duration = computeChain(
      res.services.map((s) => ({
        id: s.id,
        durationMin: (pricingStaff ? res.overrides.get(`${pricingStaff}|${s.id}`)?.durationMinOverride : null) ?? s.durationMin,
        bufferBeforeMin: s.bufferBeforeMin,
        bufferAfterMin: s.bufferAfterMin,
      })),
    ).visibleMin;
    return {
      timezone: ctx.tz, from: p.from, to, slots: res.slots.map(toSlotDto), nextAvailableDate, totalCents: total, durationMin: duration,
    };
  }
}
