import { Inject, Injectable, Logger } from '@nestjs/common';
import { waitlistInput } from '@agenda/contracts';
import {
  type DbHandle,
  and,
  appointmentItems,
  appointments,
  asc,
  customers,
  eq,
  gte,
  isExclusionViolation,
  isNull,
  lte,
  or,
  services,
  staffServices,
  uuidv7,
  waitlistEntries,
} from '@agenda/db';
import type { z } from 'zod';
import { CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { dateLabel, timeLabel } from '../../common/format';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { EventsService } from '../../core/events.service';
import { MessagingService } from '../../core/messaging.service';
import { type TenantContext, TenantContextService } from '../../core/tenant-context.service';
import { BookingCoreService } from '../appointments/booking-core.service';

export interface FreedSlot {
  tenantId: string;
  staffId: string;
  startsAt: Date;
  occupiedStart: Date;
  occupiedEnd: Date;
}

export const OFFER_MINUTES = 10;

/** Lista de espera: al liberarse un hueco se ofrece (hold de 10 min) a la primera entrada compatible. */
@Injectable()
export class WaitlistService {
  private readonly log = new Logger('Waitlist');
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(BookingCoreService) private readonly core: BookingCoreService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async join(ctx: TenantContext, input: z.infer<typeof waitlistInput>) {
    const { db } = this.handle;
    const now = this.clock.now();
    const [svc] = await db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, ctx.tenant.id), eq(services.id, input.serviceId), eq(services.visiblePublic, true))).limit(1);
    if (!svc) throw new AppError('NOT_FOUND', 'Servicio no disponible.');
    if (Date.parse(input.windowEnd) <= Math.max(Date.parse(input.windowStart), now.getTime())) {
      throw new AppError('VALIDATION_ERROR', 'La ventana de fechas debe estar en el futuro.');
    }
    const customer = await this.core.upsertCustomer(db, ctx.tenant.id, { fullName: input.fullName, phone: input.phone, consent: input.consentWhatsapp, now });
    const active = await db
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(and(eq(waitlistEntries.tenantId, ctx.tenant.id), eq(waitlistEntries.customerId, customer.id), eq(waitlistEntries.status, 'waiting')));
    if (active.length >= 3) throw new AppError('POLICY_VIOLATION', 'Ya tienes 3 solicitudes en lista de espera.');
    const [entry] = await db
      .insert(waitlistEntries)
      .values({
        id: uuidv7(), tenantId: ctx.tenant.id, customerId: customer.id, serviceId: input.serviceId, staffId: input.staffId ?? null,
        windowStart: new Date(input.windowStart), windowEnd: new Date(input.windowEnd), status: 'waiting', createdAt: now, updatedAt: now,
      })
      .returning();
    return entry!;
  }

  async list(tenantId: string) {
    return this.handle.db.select().from(waitlistEntries).where(eq(waitlistEntries.tenantId, tenantId)).orderBy(asc(waitlistEntries.createdAt));
  }

  /**
   * Ofrece el hueco liberado a la primera entrada compatible (orden de llegada).
   * La seleccion usa FOR UPDATE SKIP LOCKED para que dos procesos no ofrezcan el mismo hueco.
   * Devuelve el id de la cita 'held' creada, o null si nadie encaja.
   */
  async offerFreedSlot(freed: FreedSlot): Promise<string | null> {
    const now = this.clock.now();
    if (freed.startsAt <= now) return null;
    const freedMin = Math.round((freed.occupiedEnd.getTime() - freed.occupiedStart.getTime()) / 60_000);
    let offered: { appointmentId: string; entryId: string; customerId: string; serviceId: string } | null = null;

    await this.handle.db.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(waitlistEntries)
        .where(
          and(
            eq(waitlistEntries.tenantId, freed.tenantId),
            eq(waitlistEntries.status, 'waiting'),
            lte(waitlistEntries.windowStart, freed.startsAt),
            gte(waitlistEntries.windowEnd, freed.startsAt),
            or(isNull(waitlistEntries.staffId), eq(waitlistEntries.staffId, freed.staffId)),
          ),
        )
        .orderBy(asc(waitlistEntries.createdAt))
        .limit(10)
        .for('update', { skipLocked: true });

      for (const entry of candidates) {
        const [svc] = await tx.select().from(services).where(eq(services.id, entry.serviceId)).limit(1);
        if (!svc || !svc.active) continue;
        const [link] = await tx
          .select()
          .from(staffServices)
          .where(and(eq(staffServices.staffId, freed.staffId), eq(staffServices.serviceId, svc.id)))
          .limit(1);
        if (!link) continue;
        const items = [{ service: svc, durationMin: link.durationMinOverride ?? svc.durationMin, priceCents: link.priceCentsOverride ?? svc.priceCents }];
        const plan = this.core.plan(items, freed.startsAt.toISOString());
        if (plan.chain.occupiedMin > freedMin) continue;
        const [cust] = await tx.select().from(customers).where(eq(customers.id, entry.customerId)).limit(1);
        if (!cust) continue;
        try {
          const apt = await tx.transaction(async (sp) =>
            this.core.insertAppointment(sp, {
              tenantId: freed.tenantId, customerId: cust.id, staffId: freed.staffId, status: 'held', plan, items, source: 'waitlist',
              holdExpiresAt: new Date(now.getTime() + OFFER_MINUTES * 60_000), consentWhatsapp: cust.consentWhatsapp, now,
            }),
          );
          await tx
            .update(waitlistEntries)
            .set({ status: 'offered', offeredAt: now, offerExpiresAt: apt.holdExpiresAt, offeredAppointmentId: apt.id, updatedAt: now })
            .where(eq(waitlistEntries.id, entry.id));
          offered = { appointmentId: apt.id, entryId: entry.id, customerId: cust.id, serviceId: svc.id };
          return;
        } catch (e) {
          if (isExclusionViolation(e)) continue; // alguien tomo el hueco; probar con la siguiente entrada
          throw e;
        }
      }
    });

    if (!offered) return null;
    const o = offered as { appointmentId: string; entryId: string; customerId: string; serviceId: string };
    await this.sendOffer(o.appointmentId).catch((e) => this.log.error(`No se pudo enviar la oferta: ${(e as Error).message}`));
    return o.appointmentId;
  }

  private async sendOffer(appointmentId: string) {
    const { db } = this.handle;
    const [apt] = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
    if (!apt?.customerId) return;
    const [cust] = await db.select().from(customers).where(eq(customers.id, apt.customerId)).limit(1);
    const [svcItem] = await db
      .select({ name: appointmentItems.nameSnapshot })
      .from(appointmentItems)
      .where(eq(appointmentItems.appointmentId, appointmentId))
      .limit(1);
    const ctx = await this.tenants.byId(apt.tenantId);
    if (!cust) return;
    await this.messaging.sendTemplate({
      tenantId: apt.tenantId, phone: cust.phoneE164, template: 'waitlist_offer', appointmentId: apt.id, customerId: cust.id,
      params: {
        name: cust.fullName.split(' ')[0] ?? cust.fullName,
        service: svcItem?.name ?? 'tu servicio',
        date: dateLabel(apt.startsAt, ctx.tz),
        time: timeLabel(apt.startsAt, ctx.tz),
        offerMinutes: String(OFFER_MINUTES),
        link: `${this.config.publicWebUrl}/${ctx.tenant.slug}/cita/${this.core.token(apt.id)}`,
      },
    });
    this.events.emit(apt.tenantId, 'waitlist.offered', { appointmentId: apt.id });
  }

  /** La oferta vencio o fue rechazada: marcar la entrada y ofrecer el mismo hueco a la siguiente. */
  async onOfferReleased(apt: { id: string; tenantId: string; staffId: string; startsAt: Date; occupiedStart: Date; occupiedEnd: Date }) {
    const { db } = this.handle;
    await db
      .update(waitlistEntries)
      .set({ status: 'expired', updatedAt: this.clock.now() })
      .where(and(eq(waitlistEntries.offeredAppointmentId, apt.id), eq(waitlistEntries.status, 'offered')));
    await this.offerFreedSlot({ tenantId: apt.tenantId, staffId: apt.staffId, startsAt: apt.startsAt, occupiedStart: apt.occupiedStart, occupiedEnd: apt.occupiedEnd });
  }

  async markAccepted(appointmentId: string) {
    await this.handle.db
      .update(waitlistEntries)
      .set({ status: 'accepted', updatedAt: this.clock.now() })
      .where(and(eq(waitlistEntries.offeredAppointmentId, appointmentId), eq(waitlistEntries.status, 'offered')));
  }
}
