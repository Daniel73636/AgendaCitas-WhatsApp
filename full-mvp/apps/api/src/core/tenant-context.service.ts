import { Inject, Injectable } from '@nestjs/common';
import { type TenantSettings, tenantSettings } from '@agenda/contracts';
import { type DbHandle, eq, locations, tenants } from '@agenda/db';
import { DEFAULT_POLICY, type CancellationPolicy, type ReminderPolicy, DEFAULT_REMINDER_POLICY } from '@agenda/domain-booking';
import { AppError } from '../common/errors';
import { DB_HANDLE } from './db.provider';

export type TenantRow = typeof tenants.$inferSelect;
export type LocationRow = typeof locations.$inferSelect;

export interface TenantContext {
  tenant: TenantRow;
  location: LocationRow;
  settings: TenantSettings;
  tz: string;
  policy: CancellationPolicy;
  reminderPolicy: ReminderPolicy;
}

@Injectable()
export class TenantContextService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  private async build(tenant: TenantRow): Promise<TenantContext> {
    const { db } = this.handle;
    const [location] = await db.select().from(locations).where(eq(locations.tenantId, tenant.id)).limit(1);
    if (!location) throw new AppError('NOT_FOUND', 'El negocio no tiene una sede configurada.');
    const settings = tenantSettings.parse(tenant.settings ?? {});
    return {
      tenant,
      location,
      settings,
      tz: location.timezone,
      policy: {
        ...DEFAULT_POLICY,
        cancelMinHours: settings.cancelMinHours,
        rescheduleMinHours: settings.rescheduleMinHours,
        fullRefundHours: settings.fullRefundHours,
        partialRefundHours: settings.partialRefundHours,
        partialRefundPct: settings.partialRefundPct,
      },
      reminderPolicy: { ...DEFAULT_REMINDER_POLICY, ...settings.reminders },
    };
  }

  async bySlug(slug: string): Promise<TenantContext> {
    const [t] = await this.handle.db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (!t) throw new AppError('NOT_FOUND', 'Negocio no encontrado.');
    return this.build(t);
  }

  async byId(id: string): Promise<TenantContext> {
    const [t] = await this.handle.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!t) throw new AppError('NOT_FOUND', 'Negocio no encontrado.');
    return this.build(t);
  }
}
