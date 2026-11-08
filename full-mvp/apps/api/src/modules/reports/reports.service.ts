import { Inject, Injectable } from '@nestjs/common';
import type { NoShowReport, OccupancyReport, ReportSummary, RevenueReport } from '@agenda/contracts';
import {
  type DbHandle,
  and,
  appointmentItems,
  appointments,
  customers,
  eq,
  gte,
  inArray,
  like,
  lt,
  messageLog,
  staff,
  staffSchedules,
  staffTimeOff,
  isNull,
  sql,
} from '@agenda/db';
import {
  type Interval,
  addDaysStr,
  localDateOf,
  localMinutesOfDay,
  overlapMinutes,
  parseHm,
  percentOfCents,
  subtractIntervals,
  weekdayOf,
  zonedToAbsMin,
} from '@agenda/domain-booking';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { type TenantContext, TenantContextService } from '../../core/tenant-context.service';

export interface RangeQ {
  from?: string | undefined;
  to?: string | undefined;
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
  ) {}

  private range(ctx: TenantContext, q: RangeQ) {
    const today = localDateOf(Math.floor(this.clock.now().getTime() / 60000), ctx.tz);
    const to = q.to ?? today;
    const from = q.from ?? addDaysStr(to, -29);
    return { from, to, fromAbs: zonedToAbsMin(from, 0, ctx.tz), toAbs: zonedToAbsMin(addDaysStr(to, 1), 0, ctx.tz) };
  }

  private async load(ctx: TenantContext, r: ReturnType<ReportsService['range']>) {
    const { db } = this.handle;
    const rows = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, ctx.tenant.id),
          gte(appointments.startsAt, new Date(r.fromAbs * 60000)),
          lt(appointments.startsAt, new Date(r.toAbs * 60000)),
          inArray(appointments.status, ['pending', 'confirmed', 'in_progress', 'completed', 'no_show', 'canceled']),
          sql`${appointments.cancelReason} IS DISTINCT FROM 'hold_expired'`,
        ),
      );
    return rows;
  }

  /** Minutos disponibles por profesional y buckets (weekday,hour) segun horario semanal menos excepciones. */
  private async availability(ctx: TenantContext, r: ReturnType<ReportsService['range']>) {
    const { db } = this.handle;
    const tenantId = ctx.tenant.id;
    const staffRows = await db.select().from(staff).where(and(eq(staff.tenantId, tenantId), isNull(staff.deletedAt)));
    const scheds = await db.select().from(staffSchedules).where(eq(staffSchedules.tenantId, tenantId));
    const offs = await db.select().from(staffTimeOff).where(and(eq(staffTimeOff.tenantId, tenantId), eq(staffTimeOff.isExtraOpening, false)));
    const perStaff = new Map<string, number>();
    const heat: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (let date = r.from; date <= r.to; date = addDaysStr(date, 1)) {
      const wd = weekdayOf(date);
      for (const s of staffRows) {
        const blocks = scheds.filter((b) => b.staffId === s.id && b.weekday === wd);
        const base: Interval[] = blocks.map((b) => ({ start: zonedToAbsMin(date, parseHm(b.startTime), ctx.tz), end: zonedToAbsMin(date, parseHm(b.endTime), ctx.tz) }));
        const blockIv: Interval[] = offs
          .filter((o) => o.staffId === null || o.staffId === s.id)
          .map((o) => ({ start: Math.floor(o.startsAt.getTime() / 60000), end: Math.floor(o.endsAt.getTime() / 60000) }));
        const free = subtractIntervals(base, blockIv);
        const dayStart = zonedToAbsMin(date, 0, ctx.tz);
        let total = 0;
        for (const f of free) {
          total += f.end - f.start;
          for (let h = 0; h < 24; h++) {
            const m = overlapMinutes([f], dayStart + h * 60, dayStart + (h + 1) * 60);
            if (m > 0 && !s.deletedAt) heat[wd]![h]! += m;
          }
        }
        perStaff.set(s.id, (perStaff.get(s.id) ?? 0) + total);
      }
    }
    return { staffRows, perStaff, heat };
  }

  async summary(tenantId: string, q: RangeQ): Promise<ReportSummary> {
    const ctx = await this.tenants.byId(tenantId);
    const r = this.range(ctx, q);
    const { db } = this.handle;
    const rows = await this.load(ctx, r);
    const completed = rows.filter((x) => x.status === 'completed');
    const noShow = rows.filter((x) => x.status === 'no_show');
    const canceled = rows.filter((x) => x.status === 'canceled');
    const upcoming = rows.filter((x) => ['pending', 'confirmed', 'in_progress'].includes(x.status));
    const retained = [...noShow, ...canceled].reduce((a, x) => a + Math.max(0, x.depositPaidCents - x.refundedCents), 0);
    const revenue = completed.reduce((a, x) => a + x.paidCents, 0) + retained;
    const avgTicket = completed.length ? Math.round(completed.reduce((a, x) => a + x.paidCents, 0) / completed.length) : 0;
    const avail = await this.availability(ctx, r);
    const availableMin = [...avail.perStaff.values()].reduce((a, b) => a + b, 0);
    const bookedMin = rows
      .filter((x) => x.status !== 'canceled')
      .reduce((a, x) => a + Math.round((x.endsAt.getTime() - x.startsAt.getTime()) / 60000), 0);
    const newCust = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), gte(customers.createdAt, new Date(r.fromAbs * 60000)), lt(customers.createdAt, new Date(r.toAbs * 60000))));
    const reminders = await db
      .select({ appointmentId: messageLog.appointmentId })
      .from(messageLog)
      .where(
        and(
          eq(messageLog.tenantId, tenantId),
          eq(messageLog.direction, 'out'),
          like(messageLog.template, 'appointment_reminder%'),
          eq(messageLog.status, 'sent'),
          gte(messageLog.createdAt, new Date(r.fromAbs * 60000)),
          lt(messageLog.createdAt, new Date(r.toAbs * 60000)),
        ),
      );
    const remindedApts = new Set(reminders.map((x) => x.appointmentId).filter(Boolean)).size;
    const assumption = ctx.settings.estimatedNoShowReduction;
    const avoided = Math.round(remindedApts * assumption);
    return {
      range: { from: r.from, to: r.to },
      totals: { appointments: rows.length, completed: completed.length, noShow: noShow.length, canceled: canceled.length, upcoming: upcoming.length },
      noShowRate: completed.length + noShow.length ? noShow.length / (completed.length + noShow.length) : 0,
      revenueCents: revenue,
      avgTicketCents: avgTicket,
      occupancyPct: availableMin ? Math.min(100, Math.round((bookedMin / availableMin) * 100)) : 0,
      newCustomers: newCust.length,
      impact: {
        remindersSent: reminders.length, appointmentsReminded: remindedApts, estimatedNoShowsAvoided: avoided,
        estimatedRecoveredCents: avoided * avgTicket, assumption,
      },
    };
  }

  async noShows(tenantId: string, q: RangeQ): Promise<NoShowReport> {
    const ctx = await this.tenants.byId(tenantId);
    const r = this.range(ctx, q);
    const rows = (await this.load(ctx, r)).filter((x) => x.status !== 'canceled');
    const ns = rows.filter((x) => x.status === 'no_show');
    const custIds = [...new Set(ns.map((x) => x.customerId).filter((x): x is string => !!x))];
    const custs = custIds.length ? await this.handle.db.select().from(customers).where(inArray(customers.id, custIds)) : [];
    const byCust = new Map<string, number>();
    for (const x of ns) if (x.customerId) byCust.set(x.customerId, (byCust.get(x.customerId) ?? 0) + 1);
    const wd = Array.from({ length: 7 }, (_, weekday) => ({ weekday, noShows: 0, total: 0 }));
    for (const x of rows) {
      const d = weekdayOf(localDateOf(Math.floor(x.startsAt.getTime() / 60000), ctx.tz));
      wd[d]!.total++;
      if (x.status === 'no_show') wd[d]!.noShows++;
    }
    const staffRows = await this.handle.db.select().from(staff).where(eq(staff.tenantId, tenantId));
    return {
      byCustomer: [...byCust.entries()]
        .map(([id, n]) => ({ customerId: id, name: custs.find((c) => c.id === id)?.fullName ?? '—', phone: custs.find((c) => c.id === id)?.phoneE164 ?? '', noShows: n }))
        .sort((a, b) => b.noShows - a.noShows)
        .slice(0, 10),
      byWeekday: wd,
      byStaff: staffRows.map((s) => ({ staffId: s.id, name: s.displayName, noShows: ns.filter((x) => x.staffId === s.id).length, total: rows.filter((x) => x.staffId === s.id).length })),
    };
  }

  async occupancy(tenantId: string, q: RangeQ): Promise<OccupancyReport> {
    const ctx = await this.tenants.byId(tenantId);
    const r = this.range(ctx, q);
    const rows = (await this.load(ctx, r)).filter((x) => !['canceled'].includes(x.status));
    const av = await this.availability(ctx, r);
    const booked: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    const bookedByStaff = new Map<string, number>();
    for (const x of rows) {
      const s = Math.floor(x.startsAt.getTime() / 60000);
      const e = Math.floor(x.endsAt.getTime() / 60000);
      bookedByStaff.set(x.staffId, (bookedByStaff.get(x.staffId) ?? 0) + (e - s));
      for (let t = s; t < e; t += 15) {
        const d = weekdayOf(localDateOf(t, ctx.tz));
        const h = Math.floor(localMinutesOfDay(t, ctx.tz) / 60);
        booked[d]![h]! += Math.min(15, e - t);
      }
    }
    return {
      heatmap: av.heat.map((row, d) => row.map((avail, h) => (avail > 0 ? Math.min(1, booked[d]![h]! / avail) : 0))),
      byStaff: av.staffRows.map((s) => {
        const availableMin = av.perStaff.get(s.id) ?? 0;
        const bookedMin = bookedByStaff.get(s.id) ?? 0;
        return { staffId: s.id, name: s.displayName, bookedMin, availableMin, pct: availableMin ? Math.min(100, Math.round((bookedMin / availableMin) * 100)) : 0 };
      }),
    };
  }

  async revenue(tenantId: string, q: RangeQ): Promise<RevenueReport> {
    const ctx = await this.tenants.byId(tenantId);
    const r = this.range(ctx, q);
    const rows = await this.load(ctx, r);
    const paying = rows
      .map((x) => ({ x, cents: x.status === 'completed' ? x.paidCents : x.status === 'no_show' || x.status === 'canceled' ? Math.max(0, x.depositPaidCents - x.refundedCents) : 0 }))
      .filter((p) => p.cents > 0);
    const byDay = new Map<string, { cents: number; count: number }>();
    for (const p of paying) {
      const d = localDateOf(Math.floor(p.x.startsAt.getTime() / 60000), ctx.tz);
      const cur = byDay.get(d) ?? { cents: 0, count: 0 };
      cur.cents += p.cents;
      cur.count++;
      byDay.set(d, cur);
    }
    const days: RevenueReport['byDay'] = [];
    for (let d = r.from; d <= r.to; d = addDaysStr(d, 1)) days.push({ date: d, cents: byDay.get(d)?.cents ?? 0, count: byDay.get(d)?.count ?? 0 });
    const completedIds = rows.filter((x) => x.status === 'completed').map((x) => x.id);
    const items = completedIds.length ? await this.handle.db.select().from(appointmentItems).where(inArray(appointmentItems.appointmentId, completedIds)) : [];
    const bySvc = new Map<string, { name: string; cents: number; count: number }>();
    for (const i of items) {
      const cur = bySvc.get(i.serviceId) ?? { name: i.nameSnapshot, cents: 0, count: 0 };
      cur.cents += i.priceCents;
      cur.count++;
      bySvc.set(i.serviceId, cur);
    }
    const staffRows = await this.handle.db.select().from(staff).where(eq(staff.tenantId, tenantId));
    return {
      byDay: days,
      byService: [...bySvc.entries()].map(([serviceId, v]) => ({ serviceId, ...v })).sort((a, b) => b.cents - a.cents),
      byStaff: staffRows
        .map((s) => {
          const mine = paying.filter((p) => p.x.staffId === s.id);
          const cents = mine.reduce((a, p) => a + p.cents, 0);
          return { staffId: s.id, name: s.displayName, cents, count: mine.length, commissionCents: percentOfCents(cents, s.commissionPct) };
        })
        .sort((a, b) => b.cents - a.cents),
      totalCents: paying.reduce((a, p) => a + p.cents, 0),
    };
  }
}
