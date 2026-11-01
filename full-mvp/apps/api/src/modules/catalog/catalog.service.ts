import { Inject, Injectable } from '@nestjs/common';
import type { ServiceDto, ServiceInputT, StaffDto } from '@agenda/contracts';
import { type DbHandle, and, asc, eq, inArray, isNull, services, staff, staffServices, uuidv7 } from '@agenda/db';
import { AppError } from '../../common/errors';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { EventsService } from '../../core/events.service';

type ServiceRow = typeof services.$inferSelect;
type StaffRow = typeof staff.$inferSelect;

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  private toDto(s: ServiceRow, staffIds: string[]): ServiceDto {
    return {
      id: s.id, name: s.name, description: s.description, durationMin: s.durationMin, bufferBeforeMin: s.bufferBeforeMin,
      bufferAfterMin: s.bufferAfterMin, priceCents: s.priceCents, currency: s.currency, depositCents: s.depositCents,
      capacity: s.capacity, visiblePublic: s.visiblePublic, active: s.active, category: s.category, imageUrl: s.imageUrl, staffIds,
    };
  }

  async listServices(tenantId: string, opts: { publicOnly?: boolean } = {}): Promise<ServiceDto[]> {
    const { db } = this.handle;
    const rows = await db
      .select()
      .from(services)
      .where(and(eq(services.tenantId, tenantId), isNull(services.deletedAt), opts.publicOnly ? and(eq(services.active, true), eq(services.visiblePublic, true)) : undefined))
      .orderBy(asc(services.category), asc(services.name));
    const links = rows.length
      ? await db.select().from(staffServices).where(and(eq(staffServices.tenantId, tenantId), inArray(staffServices.serviceId, rows.map((r) => r.id))))
      : [];
    return rows.map((r) => this.toDto(r, links.filter((l) => l.serviceId === r.id).map((l) => l.staffId)));
  }

  async createService(tenantId: string, tenantCurrency: string, input: ServiceInputT): Promise<ServiceDto> {
    const { db } = this.handle;
    const now = this.clock.now();
    const id = uuidv7();
    await this.assertStaffInTenant(tenantId, input.staffIds ?? []);
    const [row] = await db
      .insert(services)
      .values({
        id, tenantId, name: input.name, description: input.description ?? null, category: input.category ?? null, imageUrl: input.imageUrl ?? null,
        durationMin: input.durationMin, bufferBeforeMin: input.bufferBeforeMin, bufferAfterMin: input.bufferAfterMin, priceCents: input.priceCents,
        currency: tenantCurrency, depositCents: input.depositCents, capacity: input.capacity, visiblePublic: input.visiblePublic, active: input.active,
        createdAt: now, updatedAt: now,
      })
      .returning();
    if (input.staffIds?.length) await this.setStaff(tenantId, id, input.staffIds);
    return this.toDto(row!, input.staffIds ?? []);
  }

  /** Editar la duracion NO altera citas ya agendadas (guardan snapshot en appointment_items). */
  async patchService(tenantId: string, id: string, input: Partial<ServiceInputT>): Promise<ServiceDto> {
    const { db } = this.handle;
    const { staffIds, ...rest } = input;
    await this.assertStaffInTenant(tenantId, staffIds ?? []);
    const [row] = await db
      .update(services)
      .set({ ...rest, updatedAt: this.clock.now() })
      .where(and(eq(services.id, id), eq(services.tenantId, tenantId), isNull(services.deletedAt)))
      .returning();
    if (!row) throw new AppError('NOT_FOUND', 'Servicio no encontrado.');
    if (staffIds) await this.setStaff(tenantId, id, staffIds);
    const [dto] = (await this.listServices(tenantId)).filter((s) => s.id === id);
    this.events.emit(tenantId, 'appointment.updated', { catalog: true });
    return dto!;
  }

  async deleteService(tenantId: string, id: string): Promise<void> {
    const rows = await this.handle.db
      .update(services)
      .set({ deletedAt: this.clock.now(), active: false, updatedAt: this.clock.now() })
      .where(and(eq(services.id, id), eq(services.tenantId, tenantId)))
      .returning({ id: services.id });
    if (!rows.length) throw new AppError('NOT_FOUND', 'Servicio no encontrado.');
  }

  private async setStaff(tenantId: string, serviceId: string, staffIds: string[]) {
    const { db } = this.handle;
    const existing = await db.select().from(staffServices).where(and(eq(staffServices.tenantId, tenantId), eq(staffServices.serviceId, serviceId)));
    const keep = new Set(staffIds);
    const toRemove = existing.filter((e) => !keep.has(e.staffId)).map((e) => e.staffId);
    if (toRemove.length) await db.delete(staffServices).where(and(eq(staffServices.tenantId, tenantId), eq(staffServices.serviceId, serviceId), inArray(staffServices.staffId, toRemove)));
    const have = new Set(existing.map((e) => e.staffId));
    const toAdd = staffIds.filter((s) => !have.has(s));
    if (toAdd.length) {
      await this.assertStaffInTenant(tenantId, toAdd);
      await db.insert(staffServices).values([...new Set(toAdd)].map((id) => ({ tenantId, staffId: id, serviceId })));
    }
  }

  /** Todos los profesionales indicados deben pertenecer al negocio. */
  private async assertStaffInTenant(tenantId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const valid = await this.handle.db.select({ id: staff.id }).from(staff).where(and(eq(staff.tenantId, tenantId), isNull(staff.deletedAt), inArray(staff.id, unique)));
    if (valid.length !== unique.length) throw new AppError('NOT_FOUND', 'Alguno de los profesionales no existe en tu negocio.');
  }

  // ---- Profesionales (lectura) ----
  async listStaff(tenantId: string, opts: { publicOnly?: boolean } = {}): Promise<StaffDto[]> {
    const { db } = this.handle;
    const rows = await db
      .select()
      .from(staff)
      .where(and(eq(staff.tenantId, tenantId), isNull(staff.deletedAt), opts.publicOnly ? eq(staff.active, true) : undefined))
      .orderBy(asc(staff.priority), asc(staff.displayName));
    const links = rows.length ? await db.select().from(staffServices).where(and(eq(staffServices.tenantId, tenantId), inArray(staffServices.staffId, rows.map((r) => r.id)))) : [];
    return rows
      .sort((a, b) => b.priority - a.priority || a.displayName.localeCompare(b.displayName))
      .map((r) => this.staffDto(r, links.filter((l) => l.staffId === r.id)));
  }

  staffDto(r: StaffRow, links: Array<typeof staffServices.$inferSelect>): StaffDto {
    return {
      id: r.id, displayName: r.displayName, bio: r.bio, specialties: r.specialties, color: r.color, photoUrl: r.photoUrl, active: r.active,
      priority: r.priority, commissionPct: r.commissionPct,
      serviceIds: links.map((l) => l.serviceId),
      serviceOverrides: links.map((l) => ({ serviceId: l.serviceId, priceCentsOverride: l.priceCentsOverride, durationMinOverride: l.durationMinOverride })),
    };
  }
}
