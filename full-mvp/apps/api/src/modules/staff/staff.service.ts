import { Inject, Injectable } from '@nestjs/common';
import type { ScheduleInput, StaffDto, StaffInputT, TimeOffDto } from '@agenda/contracts';
import {
  type DbHandle,
  and,
  appointmentItems,
  appointments,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  services,
  staff,
  staffSchedules,
  staffServices,
  staffTimeOff,
  uuidv7,
} from '@agenda/db';
import { ACTIVE_STATUSES, localDateOf, toAbsMin } from '@agenda/domain-booking';
import { AppError } from '../../common/errors';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { EventsService } from '../../core/events.service';
import { TenantContextService } from '../../core/tenant-context.service';
import { AvailabilityService } from '../availability/availability.service';
import { CatalogService } from '../catalog/catalog.service';

@Injectable()
export class StaffService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  list(tenantId: string): Promise<StaffDto[]> {
    return this.catalog.listStaff(tenantId);
  }

  private async one(tenantId: string, id: string): Promise<StaffDto> {
    const found = (await this.catalog.listStaff(tenantId)).find((s) => s.id === id);
    if (!found) throw new AppError('NOT_FOUND', 'Profesional no encontrado.');
    return found;
  }

  async create(tenantId: string, locationId: string, input: StaffInputT): Promise<StaffDto> {
    const { db } = this.handle;
    const id = uuidv7();
    const now = this.clock.now();
    if (input.services?.length) await this.assertServicesInTenant(tenantId, input.services.map((s) => s.serviceId));
    await db.insert(staff).values({
      id, tenantId, locationId, displayName: input.displayName, bio: input.bio ?? null, specialties: input.specialties, color: input.color,
      photoUrl: input.photoUrl ?? null, active: input.active, priority: input.priority, commissionPct: input.commissionPct, createdAt: now, updatedAt: now,
    });
    if (input.services?.length) await this.setServices(tenantId, id, input.services);
    return this.one(tenantId, id);
  }

  /** Los servicios enlazados deben existir en el mismo negocio (evita vinculos entre tenants). */
  private async assertServicesInTenant(tenantId: string, serviceIds: string[]) {
    const unique = [...new Set(serviceIds)];
    const found = await this.handle.db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, tenantId), inArray(services.id, unique), isNull(services.deletedAt)));
    if (found.length !== unique.length) throw new AppError('NOT_FOUND', 'Alguno de los servicios no existe en tu negocio.');
  }

  /** Un profesional (staffId) debe pertenecer al negocio. */
  async assertStaffInTenant(tenantId: string, staffId: string) {
    const [s] = await this.handle.db.select({ id: staff.id }).from(staff).where(and(eq(staff.id, staffId), eq(staff.tenantId, tenantId), isNull(staff.deletedAt))).limit(1);
    if (!s) throw new AppError('NOT_FOUND', 'Profesional no encontrado.');
  }

  private async setServices(tenantId: string, staffId: string, list: NonNullable<StaffInputT['services']>) {
    const { db } = this.handle;
    await this.assertServicesInTenant(tenantId, list.map((l) => l.serviceId));
    await db.delete(staffServices).where(and(eq(staffServices.tenantId, tenantId), eq(staffServices.staffId, staffId)));
    if (list.length) {
      await db.insert(staffServices).values(
        list.map((l) => ({ tenantId, staffId, serviceId: l.serviceId, priceCentsOverride: l.priceCentsOverride ?? null, durationMinOverride: l.durationMinOverride ?? null })),
      );
    }
  }

  /**
   * Desactivar con citas futuras: asistente de reasignacion.
   * Sin `reassign` devuelve 409 con el detalle; con `reassign` mueve las citas a otro profesional libre si es posible.
   */
  async patch(tenantId: string, id: string, input: Partial<StaffInputT> & { reassign?: boolean | undefined }): Promise<StaffDto> {
    const { db } = this.handle;
    const { services: svcList, reassign, ...rest } = input;
    const current = await this.one(tenantId, id);
    if (rest.active === false && current.active) {
      const future = await db
        .select()
        .from(appointments)
        .where(and(eq(appointments.tenantId, tenantId), eq(appointments.staffId, id), inArray(appointments.status, [...ACTIVE_STATUSES]), gt(appointments.startsAt, this.clock.now())));
      if (future.length) {
        const ctx = await this.tenants.byId(tenantId);
        const plan: Array<{ appointmentId: string; startsAt: string; newStaffId: string | null }> = [];
        for (const apt of future) {
          const date = localDateOf(toAbsMin(apt.startsAt.toISOString()), ctx.tz);
          const itemRows = await db.select().from(appointmentItems).where(eq(appointmentItems.appointmentId, apt.id));
          let newStaffId: string | null = null;
          try {
            const avail = await this.availability.compute(ctx, { serviceIds: itemRows.map((i) => i.serviceId), staffId: 'any', from: date, to: date, ignoreRules: true, excludeAppointmentId: apt.id });
            const slot = avail.slots.find((s) => Date.parse(s.start) === apt.startsAt.getTime() && s.staffIds.some((x) => x !== id));
            newStaffId = slot ? (slot.staffIds.find((x) => x !== id) ?? null) : null;
          } catch {
            newStaffId = null;
          }
          plan.push({ appointmentId: apt.id, startsAt: apt.startsAt.toISOString(), newStaffId });
        }
        if (!reassign || plan.some((p) => !p.newStaffId)) {
          throw new AppError('HAS_FUTURE_APPOINTMENTS', `${future.length} cita(s) futura(s) usan a este profesional. Reasignalas antes de desactivarlo.`, { details: { count: future.length, proposal: plan } });
        }
        for (const p of plan) {
          await db.update(appointments).set({ staffId: p.newStaffId!, updatedAt: this.clock.now() }).where(and(eq(appointments.id, p.appointmentId), eq(appointments.tenantId, tenantId)));
          this.events.emit(tenantId, 'appointment.updated', { id: p.appointmentId });
        }
      }
    }
    if (Object.keys(rest).length) {
      const set: Partial<typeof staff.$inferInsert> = { updatedAt: this.clock.now() };
      if (rest.displayName !== undefined) set.displayName = rest.displayName;
      if (rest.bio !== undefined) set.bio = rest.bio;
      if (rest.specialties !== undefined) set.specialties = rest.specialties;
      if (rest.color !== undefined) set.color = rest.color;
      if (rest.photoUrl !== undefined) set.photoUrl = rest.photoUrl;
      if (rest.active !== undefined) set.active = rest.active;
      if (rest.priority !== undefined) set.priority = rest.priority;
      if (rest.commissionPct !== undefined) set.commissionPct = rest.commissionPct;
      await db.update(staff).set(set).where(and(eq(staff.id, id), eq(staff.tenantId, tenantId)));
    }
    if (svcList) await this.setServices(tenantId, id, svcList);
    return this.one(tenantId, id);
  }

  // ---- Horarios semanales ----
  async getSchedule(tenantId: string, staffId?: string) {
    const rows = await this.handle.db
      .select()
      .from(staffSchedules)
      .where(and(eq(staffSchedules.tenantId, tenantId), staffId ? eq(staffSchedules.staffId, staffId) : undefined))
      .orderBy(asc(staffSchedules.weekday), asc(staffSchedules.startTime));
    return rows.map((r) => ({ id: r.id, staffId: r.staffId, weekday: r.weekday, start: r.startTime.slice(0, 5), end: r.endTime.slice(0, 5) }));
  }

  async setSchedule(tenantId: string, staffId: string, input: ScheduleInput) {
    const { db } = this.handle;
    await this.one(tenantId, staffId);
    // validar que los bloques de un mismo dia no se solapen
    const byDay = new Map<number, Array<{ start: string; end: string }>>();
    for (const b of input.blocks) (byDay.get(b.weekday) ?? byDay.set(b.weekday, []).get(b.weekday)!).push(b);
    for (const [, list] of byDay) {
      list.sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < list.length; i++) {
        if (list[i]!.start < list[i - 1]!.end) throw new AppError('VALIDATION_ERROR', 'Hay bloques de horario que se solapan en el mismo dia.');
      }
    }
    await db.transaction(async (tx) => {
      await tx.delete(staffSchedules).where(and(eq(staffSchedules.tenantId, tenantId), eq(staffSchedules.staffId, staffId)));
      if (input.blocks.length) {
        await tx.insert(staffSchedules).values(input.blocks.map((b) => ({ id: uuidv7(), tenantId, staffId, weekday: b.weekday, startTime: b.start, endTime: b.end })));
      }
    });
    this.events.emit(tenantId, 'appointment.updated', { schedule: staffId });
    return this.getSchedule(tenantId, staffId);
  }

  // ---- Excepciones: vacaciones, permisos, festivos, aperturas especiales ----
  private toOff(r: typeof staffTimeOff.$inferSelect): TimeOffDto {
    return { id: r.id, staffId: r.staffId, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), reason: r.reason, isExtraOpening: r.isExtraOpening };
  }

  async listTimeOff(tenantId: string, from?: Date): Promise<TimeOffDto[]> {
    const rows = await this.handle.db
      .select()
      .from(staffTimeOff)
      .where(and(eq(staffTimeOff.tenantId, tenantId), from ? gt(staffTimeOff.endsAt, from) : undefined))
      .orderBy(asc(staffTimeOff.startsAt));
    return rows.map((r) => this.toOff(r));
  }

  async createTimeOff(tenantId: string, locationId: string, input: { staffId?: string | null | undefined; startsAt: string; endsAt: string; reason?: string | null | undefined; isExtraOpening: boolean }): Promise<TimeOffDto> {
    if (input.staffId) await this.assertStaffInTenant(tenantId, input.staffId);
    const [row] = await this.handle.db
      .insert(staffTimeOff)
      .values({
        id: uuidv7(), tenantId, staffId: input.staffId ?? null, locationId: input.staffId ? null : locationId, startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt), reason: input.reason ?? null, isExtraOpening: input.isExtraOpening,
      })
      .returning();
    this.events.emit(tenantId, 'appointment.updated', { timeOff: true });
    return this.toOff(row!);
  }

  async deleteTimeOff(tenantId: string, id: string): Promise<void> {
    const rows = await this.handle.db.delete(staffTimeOff).where(and(eq(staffTimeOff.id, id), eq(staffTimeOff.tenantId, tenantId))).returning({ id: staffTimeOff.id });
    if (!rows.length) throw new AppError('NOT_FOUND', 'Excepcion no encontrada.');
    this.events.emit(tenantId, 'appointment.updated', { timeOff: true });
  }
}
