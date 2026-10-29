import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AppointmentCreateInput,
  AppointmentDto,
  AppointmentPatchInput,
  BookingInput,
  HoldDto,
  HoldInput,
  PublicAppointmentDto,
  SlotDto,
} from '@agenda/contracts';
import {
  type DbHandle,
  and,
  appointmentItems,
  appointments,
  customers,
  desc,
  eq,
  gt,
  idempotencyKeys,
  inArray,
  isExclusionViolation,
  lt,
  or,
  services,
  sql,
  staff,
  uuidv7,
} from '@agenda/db';
import {
  ACTIVE_STATUSES,
  canCustomerCancel,
  canCustomerReschedule,
  canTransition,
  computeDepositRefund,
  findSlot,
  hoursUntil,
  localDateOf,
  nearestSlots,
  requiredDepositCents,
  toAbsMin,
  type AppointmentStatus,
} from '@agenda/domain-booking';
import { type AuthContext } from '../../common/auth';
import { CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { dateLabel, isoOf, timeLabel } from '../../common/format';
import { verifyAppointmentToken } from '../../common/tokens';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { EventsService } from '../../core/events.service';
import { MessagingService } from '../../core/messaging.service';
import { type TenantContext, TenantContextService } from '../../core/tenant-context.service';
import { AvailabilityService, toSlotDto } from '../availability/availability.service';
import { OtpService } from '../otp/otp.service';
import { RemindersService } from '../reminders/reminders.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { type AptRow, BookingCoreService } from './booking-core.service';

const PAYMENT_WINDOW_MIN = 30;

@Injectable()
export class AppointmentsService {
  private readonly log = new Logger('Appointments');
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(BookingCoreService) private readonly core: BookingCoreService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(RemindersService) private readonly reminders: RemindersService,
    @Inject(WaitlistService) private readonly waitlist: WaitlistService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(OtpService) private readonly otp: OtpService,
  ) {}

  // =========================================================================
  // Utilidades
  // =========================================================================

  /** Idempotency-Key: un doble clic o reintento devuelve el mismo resultado sin crear otra cita. */
  async idempotent<T>(tenantId: string, scope: string, key: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!key) return fn();
    const mapKey = `${tenantId}|${scope}|${key}`;
    const running = this.inflight.get(mapKey);
    if (running) return (await running) as T;
    const p = (async () => {
      const { db } = this.handle;
      const [stored] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
        .limit(1);
      if (stored) return stored.response as T;
      const result = await fn();
      await db
        .insert(idempotencyKeys)
        .values({ tenantId, scope, key, statusCode: 200, response: result as unknown, createdAt: this.clock.now() })
        .onConflictDoNothing();
      return result;
    })();
    this.inflight.set(mapKey, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(mapKey);
    }
  }

  /** Expiracion perezosa de holds (ademas del barrido periodico). Devuelve las citas liberadas. */
  async releaseExpired(tenantId?: string): Promise<AptRow[]> {
    const now = this.clock.now();
    const rows = await this.handle.db
      .update(appointments)
      .set({ status: 'canceled', cancelReason: 'hold_expired', canceledAt: now, updatedAt: now, version: sql`${appointments.version} + 1` })
      .where(
        and(
          tenantId ? eq(appointments.tenantId, tenantId) : undefined,
          inArray(appointments.status, ['held', 'pending']),
          sql`${appointments.holdExpiresAt} IS NOT NULL AND ${appointments.holdExpiresAt} < ${now}`,
        ),
      )
      .returning();
    return rows;
  }

  /** Barrido periodico: libera holds vencidos y reofrece huecos de lista de espera. */
  async sweepHolds(): Promise<number> {
    const released = await this.releaseExpired();
    for (const r of released) {
      this.events.emit(r.tenantId, 'appointment.canceled', { id: r.id, reason: 'hold_expired' });
      if (r.source === 'waitlist') {
        await this.waitlist.onOfferReleased(r).catch((e) => this.log.error(`waitlist: ${(e as Error).message}`));
      }
    }
    return released.length;
  }

  private async alternatives(ctx: TenantContext, serviceIds: string[], staffId: string, startsAtIso: string, ignoreRules = false, publicOnly = true): Promise<SlotDto[]> {
    try {
      const date = localDateOf(toAbsMin(startsAtIso), ctx.tz);
      const to = new Date(Date.parse(startsAtIso) + 2 * 86_400_000).toISOString();
      const res = await this.availability.compute(ctx, {
        serviceIds, staffId, from: date, to: localDateOf(toAbsMin(to), ctx.tz), ignoreRules, publicOnly,
      });
      return nearestSlots(res.slots, startsAtIso, 3).map(toSlotDto);
    } catch {
      return [];
    }
  }

  private async loadApt(tenantId: string, id: string): Promise<AptRow> {
    const [apt] = await this.handle.db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId))).limit(1);
    if (!apt) throw new AppError('NOT_FOUND', 'Cita no encontrada.');
    return apt;
  }

  private async serviceIdsOf(aptId: string): Promise<string[]> {
    const items = await this.handle.db.select().from(appointmentItems).where(eq(appointmentItems.appointmentId, aptId));
    return items.sort((a, b) => a.position - b.position).map((i) => i.serviceId);
  }

  /** UPDATE con control optimista de version. */
  private async update(tenantId: string, id: string, set: Partial<typeof appointments.$inferInsert>, expectedVersion?: number, db = this.handle.db): Promise<AptRow> {
    const now = this.clock.now();
    const rows = await db
      .update(appointments)
      .set({ ...set, updatedAt: now, version: sql`${appointments.version} + 1` })
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId), expectedVersion !== undefined ? eq(appointments.version, expectedVersion) : undefined))
      .returning();
    if (rows.length === 0) {
      await this.loadApt(tenantId, id);
      throw new AppError('VERSION_MISMATCH', 'La cita fue modificada por otra persona. Recarga e intenta de nuevo.');
    }
    return rows[0]!;
  }

  private emitUpdate(apt: AptRow, type: 'appointment.created' | 'appointment.updated' | 'appointment.canceled' = 'appointment.updated') {
    this.events.emit(apt.tenantId, type, { id: apt.id, status: apt.status, staffId: apt.staffId, startsAt: apt.startsAt.toISOString(), version: apt.version });
  }

  private async notify(ctx: TenantContext, apt: AptRow, template: 'appointment_rescheduled' | 'appointment_canceled' | 'appointment_confirmation') {
    if (!apt.customerId || !apt.consentWhatsapp) return;
    const [cust] = await this.handle.db.select().from(customers).where(eq(customers.id, apt.customerId)).limit(1);
    if (!cust) return;
    const items = await this.handle.db.select().from(appointmentItems).where(eq(appointmentItems.appointmentId, apt.id));
    await this.messaging.sendTemplate({
      tenantId: apt.tenantId, phone: cust.phoneE164, template, appointmentId: apt.id, customerId: cust.id,
      params: {
        name: cust.fullName.split(' ')[0] ?? cust.fullName,
        business: ctx.tenant.name,
        service: items.map((i) => i.nameSnapshot).join(' + '),
        date: dateLabel(apt.startsAt, ctx.tz),
        time: timeLabel(apt.startsAt, ctx.tz),
        link: `${this.config.publicWebUrl}/${ctx.tenant.slug}/cita/${this.core.token(apt.id)}`,
      },
    });
  }

  // =========================================================================
  // Publico: holds y reserva
  // =========================================================================

  async createHold(slug: string, input: HoldInput): Promise<HoldDto> {
    const ctx = await this.tenants.bySlug(slug);
    const tenantId = ctx.tenant.id;
    await this.releaseExpired(tenantId);
    const now = this.clock.now();
    const date = localDateOf(toAbsMin(input.startsAt), ctx.tz);
    const avail = await this.availability.compute(ctx, { serviceIds: input.serviceIds, staffId: input.staffId, from: date, to: date, publicOnly: true });
    const slot = findSlot(avail.slots, input.startsAt, input.staffId === 'any' ? undefined : input.staffId);
    if (!slot) {
      // Hueco ya no ofrecido (tomado por otra persona o fuera de reglas): mismo contrato que la violacion EXCLUDE
      throw new AppError('SLOT_TAKEN', 'Ese horario ya no esta disponible. Te sugerimos estas alternativas.', { alternatives: await this.alternatives(ctx, input.serviceIds, input.staffId, input.startsAt) });
    }
    // Con "cualquiera": si el elegido se ocupa en una carrera, probar los demas libres en ese inicio
    const order = input.staffId === 'any' ? [slot.staffId, ...slot.staffIds.filter((s) => s !== slot.staffId)] : [input.staffId];
    let lastErr: unknown;
    for (const staffId of order) {
      try {
        const apt = await this.handle.db.transaction(async (tx) => {
          const items = await this.core.priceFor(tx, tenantId, staffId, avail.services);
          const plan = this.core.plan(items, slot.start);
          return this.core.insertAppointment(tx, {
            tenantId, customerId: null, staffId, status: 'held', plan, items, source: 'web',
            holdExpiresAt: new Date(now.getTime() + ctx.settings.holdMinutes * 60_000), now,
          });
        });
        const [stf] = await this.handle.db.select().from(staff).where(eq(staff.id, staffId)).limit(1);
        const items = await this.handle.db.select().from(appointmentItems).where(eq(appointmentItems.appointmentId, apt.id));
        this.emitUpdate(apt, 'appointment.created');
        return {
          holdId: apt.id,
          expiresAt: apt.holdExpiresAt!.toISOString(),
          startsAt: apt.startsAt.toISOString(),
          endsAt: apt.endsAt.toISOString(),
          staffId,
          staffName: stf?.displayName ?? '',
          totalCents: apt.totalCents,
          currency: ctx.tenant.currency,
          services: items.sort((a, b) => a.position - b.position).map((i) => ({ id: i.serviceId, name: i.nameSnapshot, durationMin: i.durationMin, priceCents: i.priceCents })),
        };
      } catch (e) {
        if (isExclusionViolation(e)) {
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    return this.core.throwIfSlotTaken(lastErr, await this.alternatives(ctx, input.serviceIds, input.staffId, input.startsAt));
  }

  /** El cliente cambia de horario o abandona: libera el hold de inmediato (sin esperar a que venza). */
  async releaseHold(slug: string, holdId: string): Promise<{ released: boolean }> {
    const ctx = await this.tenants.bySlug(slug);
    const now = this.clock.now();
    const rows = await this.handle.db
      .update(appointments)
      .set({ status: 'canceled', cancelReason: 'hold_released', canceledAt: now, updatedAt: now, version: sql`${appointments.version} + 1` })
      .where(and(eq(appointments.id, holdId), eq(appointments.tenantId, ctx.tenant.id), eq(appointments.status, 'held'), sql`${appointments.customerId} IS NULL`))
      .returning();
    if (rows[0]) this.emitUpdate(rows[0], 'appointment.canceled');
    return { released: rows.length > 0 };
  }

  async confirmBooking(slug: string, input: BookingInput, idempotencyKey?: string): Promise<PublicAppointmentDto> {
    const ctx = await this.tenants.bySlug(slug);
    return this.idempotent(ctx.tenant.id, 'booking', idempotencyKey, () => this.doConfirm(ctx, input));
  }

  private async doConfirm(ctx: TenantContext, input: BookingInput): Promise<PublicAppointmentDto> {
    const tenantId = ctx.tenant.id;
    if (input.website) throw new AppError('VALIDATION_ERROR', 'Solicitud rechazada.');
    await this.otp.assertVerified(tenantId, input.phone, { otpToken: input.otpToken, otpCode: input.otpCode });
    const now = this.clock.now();

    const result = await this.handle.db.transaction(async (tx) => {
      const [apt] = await tx
        .select()
        .from(appointments)
        .where(and(eq(appointments.id, input.holdId), eq(appointments.tenantId, tenantId)))
        .limit(1)
        .for('update');
      if (!apt) throw new AppError('NOT_FOUND', 'La reserva temporal no existe.');
      const customer = await this.core.upsertCustomer(tx, tenantId, { fullName: input.fullName, phone: input.phone, email: input.email, consent: input.consentWhatsapp, now });
      if (apt.status !== 'held') {
        if (['confirmed', 'pending'].includes(apt.status) && apt.customerId === customer.id) return { apt, created: false };
        throw new AppError(apt.status === 'canceled' ? 'HOLD_EXPIRED' : 'CONFLICT', apt.status === 'canceled' ? 'El tiempo de reserva vencio. Elige un horario de nuevo.' : 'Esta reserva ya fue procesada.');
      }
      if (apt.holdExpiresAt && apt.holdExpiresAt <= now) throw new AppError('HOLD_EXPIRED', 'El tiempo de reserva vencio. Elige un horario de nuevo.');
      const svc = await tx
        .select({ deposit: services.depositCents })
        .from(appointmentItems)
        .innerJoin(services, eq(services.id, appointmentItems.serviceId))
        .where(eq(appointmentItems.appointmentId, apt.id));
      const deposit = requiredDepositCents({
        serviceDepositsCents: ctx.settings.requireDepositForServices ? svc.map((s) => s.deposit) : [],
        totalCents: apt.totalCents,
        customerNoShows: ctx.settings.depositOnRepeatNoShow ? customer.noShowCount : 0,
        noShowThreshold: ctx.settings.noShowThreshold,
        riskDepositPct: ctx.settings.riskDepositPct,
      });
      const status = deposit > 0 ? 'pending' : 'confirmed';
      const updated = await this.update(
        tenantId,
        apt.id,
        {
          customerId: customer.id, status, depositRequiredCents: deposit, consentWhatsapp: input.consentWhatsapp, notes: input.notes ?? null,
          holdExpiresAt: status === 'pending' ? new Date(now.getTime() + PAYMENT_WINDOW_MIN * 60_000) : null,
        },
        apt.version,
        tx,
      );
      return { apt: updated, created: true };
    });

    if (result.created) {
      await this.reminders.sync(result.apt.id);
      this.emitUpdate(result.apt, 'appointment.created');
      if (result.apt.status === 'confirmed') void this.reminders.processDue(10).catch((e) => this.log.error(e));
    }
    return this.publicDto(ctx, result.apt);
  }

  // =========================================================================
  // Publico: enlace firmado de la cita
  // =========================================================================

  private async aptFromToken(token: string): Promise<{ apt: AptRow; ctx: TenantContext }> {
    const id = verifyAppointmentToken(token, this.config.authSecret);
    if (!id) throw new AppError('NOT_FOUND', 'El enlace de la cita no es valido.');
    const [apt] = await this.handle.db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
    if (!apt) throw new AppError('NOT_FOUND', 'La cita no existe.');
    const ctx = await this.tenants.byId(apt.tenantId);
    return { apt, ctx };
  }

  async publicDto(ctx: TenantContext, apt: AptRow): Promise<PublicAppointmentDto> {
    const [dto] = await this.core.hydrate(ctx.tenant.id, [apt], ctx.tenant.currency);
    const now = this.clock.nowIso();
    const active = apt.status === 'confirmed' || apt.status === 'pending';
    const cancel = active ? canCustomerCancel(dto!.startsAt, now, ctx.policy) : { allowed: false, reason: 'Esta cita ya no se puede modificar.' };
    const resched = active ? canCustomerReschedule(dto!.startsAt, now, ctx.policy) : { allowed: false, reason: 'Esta cita ya no se puede modificar.' };
    const loc = ctx.location;
    const mapsUrl = loc.lat != null && loc.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`
      : loc.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}` : null;
    return {
      id: apt.id,
      token: this.core.token(apt.id),
      status: dto!.status,
      startsAt: dto!.startsAt,
      endsAt: dto!.endsAt,
      staffId: dto!.staffId,
      staffName: dto!.staffName,
      customerName: dto!.customerName,
      services: dto!.items.map((i) => ({ id: i.serviceId, name: i.name, durationMin: i.durationMin, priceCents: i.priceCents })),
      totalCents: dto!.totalCents,
      depositRequiredCents: dto!.depositRequiredCents,
      depositPaidCents: dto!.depositPaidCents,
      currency: ctx.tenant.currency,
      business: { slug: ctx.tenant.slug, name: ctx.tenant.name, address: loc.address, phone: ctx.tenant.phone, lat: loc.lat, lng: loc.lng, timezone: ctx.tz },
      policy: {
        canCancel: cancel.allowed, canReschedule: resched.allowed,
        ...(cancel.reason ? { cancelReason: cancel.reason } : {}),
        ...(resched.reason ? { rescheduleReason: resched.reason } : {}),
        cancelMinHours: ctx.settings.cancelMinHours,
      },
      holdExpiresAt: dto!.holdExpiresAt,
      mapsUrl,
    };
  }

  async publicGet(token: string): Promise<PublicAppointmentDto> {
    const { apt: a0, ctx } = await this.aptFromToken(token);
    await this.releaseExpired(ctx.tenant.id);
    const apt = await this.loadApt(ctx.tenant.id, a0.id);
    return this.publicDto(ctx, apt);
  }

  async publicReschedule(token: string, input: { startsAt: string; staffId: string | 'any' }): Promise<PublicAppointmentDto> {
    const { apt, ctx } = await this.aptFromToken(token);
    if (apt.status !== 'confirmed' && apt.status !== 'pending') throw new AppError('INVALID_TRANSITION', 'Esta cita ya no se puede reprogramar.');
    const decision = canCustomerReschedule(apt.startsAt.toISOString(), this.clock.nowIso(), ctx.policy);
    if (!decision.allowed) throw new AppError('POLICY_VIOLATION', decision.reason ?? 'No se puede reprogramar.');
    const moved = await this.moveTo(ctx, apt, { startsAt: input.startsAt, staffId: input.staffId === 'any' ? 'any' : input.staffId, by: 'customer' });
    return this.publicDto(ctx, moved);
  }

  async publicCancel(token: string, reason?: string): Promise<PublicAppointmentDto> {
    const { apt, ctx } = await this.aptFromToken(token);
    if (apt.status !== 'confirmed' && apt.status !== 'pending') throw new AppError('INVALID_TRANSITION', 'Esta cita ya no se puede cancelar.');
    const decision = canCustomerCancel(apt.startsAt.toISOString(), this.clock.nowIso(), ctx.policy);
    if (!decision.allowed) throw new AppError('POLICY_VIOLATION', decision.reason ?? 'No se puede cancelar.');
    const canceled = await this.cancelInternal(ctx, apt, { by: 'customer', reason: reason ?? 'Cancelada por el cliente', notify: true });
    return this.publicDto(ctx, canceled);
  }

  /** Aceptar una oferta de lista de espera (hold 'held' de origen waitlist). */
  async publicAccept(token: string): Promise<PublicAppointmentDto> {
    const { apt: a0, ctx } = await this.aptFromToken(token);
    await this.releaseExpired(ctx.tenant.id);
    const apt = await this.loadApt(ctx.tenant.id, a0.id);
    if (apt.status !== 'held' || apt.source !== 'waitlist') {
      throw new AppError(apt.status === 'canceled' ? 'HOLD_EXPIRED' : 'CONFLICT', apt.status === 'canceled' ? 'La oferta vencio.' : 'Esta oferta ya no esta disponible.');
    }
    const updated = await this.update(ctx.tenant.id, apt.id, { status: 'confirmed', holdExpiresAt: null, confirmedByCustomer: true }, apt.version);
    await this.waitlist.markAccepted(apt.id);
    await this.reminders.sync(apt.id);
    this.emitUpdate(updated);
    void this.reminders.processDue(10).catch(() => undefined);
    return this.publicDto(ctx, updated);
  }

  /** Pasarela de pago SIMULADA: confirma el anticipo y pasa la cita de pending a confirmed. */
  async publicPay(token: string): Promise<PublicAppointmentDto> {
    const { apt: a0, ctx } = await this.aptFromToken(token);
    await this.releaseExpired(ctx.tenant.id);
    const apt = await this.loadApt(ctx.tenant.id, a0.id);
    if (apt.status !== 'pending') throw new AppError('INVALID_TRANSITION', apt.status === 'canceled' ? 'El tiempo para pagar vencio.' : 'Esta cita no requiere pago.');
    const updated = await this.payDeposit(ctx, apt);
    return this.publicDto(ctx, updated);
  }

  async payDeposit(ctx: TenantContext, apt: AptRow, amountCents?: number): Promise<AptRow> {
    const amount = amountCents ?? apt.depositRequiredCents;
    if (amount < apt.depositRequiredCents) throw new AppError('VALIDATION_ERROR', 'El monto no cubre el anticipo requerido.');
    const updated = await this.update(ctx.tenant.id, apt.id, { status: 'confirmed', depositPaidCents: amount, holdExpiresAt: null }, apt.version);
    await this.reminders.sync(apt.id);
    this.emitUpdate(updated);
    void this.reminders.processDue(10).catch(() => undefined);
    return updated;
  }

  // =========================================================================
  // Mover / reprogramar (cliente y panel)
  // =========================================================================

  private async moveTo(
    ctx: TenantContext,
    apt: AptRow,
    a: { startsAt: string; staffId: string | 'any'; serviceIds?: string[] | undefined; by: 'customer' | 'staff'; ignoreSchedule?: boolean | undefined; expectedVersion?: number | undefined },
  ): Promise<AptRow> {
    const tenantId = ctx.tenant.id;
    const serviceIds = a.serviceIds ?? (await this.serviceIdsOf(apt.id));
    const date = localDateOf(toAbsMin(a.startsAt), ctx.tz);
    const svcRows = await this.availability.loadServices(tenantId, serviceIds);
    let candidates: string[] = a.staffId === 'any' ? [] : [a.staffId];
    let startIso = a.startsAt;

    if (!a.ignoreSchedule) {
      const avail = await this.availability.compute(ctx, {
        serviceIds, staffId: a.staffId, from: date, to: date, ignoreRules: a.by === 'staff', excludeAppointmentId: apt.id,
      });
      const slot = findSlot(avail.slots, a.startsAt, a.staffId === 'any' ? undefined : a.staffId);
      if (!slot) {
        throw new AppError('SLOT_UNAVAILABLE', 'Ese horario no esta disponible.', { alternatives: await this.alternatives(ctx, serviceIds, a.staffId, a.startsAt, a.by === 'staff', false) });
      }
      startIso = slot.start;
      candidates = a.staffId === 'any' ? [apt.staffId, ...slot.staffIds].filter((v, i, arr) => slot.staffIds.includes(v) && arr.indexOf(v) === i) : [a.staffId];
    } else if (a.staffId === 'any') {
      candidates = [apt.staffId];
    }

    let lastErr: unknown;
    for (const staffId of candidates) {
      try {
        const updated = await this.handle.db.transaction(async (tx) => {
          const items = await this.core.priceFor(tx, tenantId, staffId, svcRows);
          const plan = this.core.plan(items, startIso);
          const row = await this.update(
            tenantId, apt.id,
            {
              staffId, startsAt: plan.startsAt, endsAt: plan.endsAt, occupiedStart: plan.occupiedStart, occupiedEnd: plan.occupiedEnd,
              totalCents: plan.totalCents, rescheduledFrom: apt.id, confirmedByCustomer: false,
            },
            a.expectedVersion ?? apt.version,
            tx,
          );
          await tx.delete(appointmentItems).where(eq(appointmentItems.appointmentId, apt.id));
          await tx.insert(appointmentItems).values(
            items.map((i, idx) => ({
              id: uuidv7(), tenantId, appointmentId: apt.id, serviceId: i.service.id, nameSnapshot: i.service.name,
              durationMin: i.durationMin, priceCents: i.priceCents, position: idx,
            })),
          );
          return row;
        });
        await this.reminders.sync(apt.id, { skipConfirm: true });
        this.emitUpdate(updated);
        await this.notify(ctx, updated, 'appointment_rescheduled').catch((e) => this.log.error(e));
        if (apt.startsAt.getTime() !== updated.startsAt.getTime() || apt.staffId !== updated.staffId) {
          await this.waitlist.offerFreedSlot({ tenantId, staffId: apt.staffId, startsAt: apt.startsAt, occupiedStart: apt.occupiedStart, occupiedEnd: apt.occupiedEnd }).catch((e) => this.log.error(e));
        }
        return updated;
      } catch (e) {
        if (isExclusionViolation(e)) {
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    return this.core.throwIfSlotTaken(lastErr, await this.alternatives(ctx, serviceIds, a.staffId, a.startsAt, a.by === 'staff', false));
  }

  private async cancelInternal(
    ctx: TenantContext,
    apt: AptRow,
    a: { by: 'customer' | 'staff'; reason?: string | undefined; notify: boolean; expectedVersion?: number | undefined },
  ): Promise<AptRow> {
    if (!canTransition(apt.status as AppointmentStatus, 'canceled')) throw new AppError('INVALID_TRANSITION', 'Esta cita no se puede cancelar.');
    const now = this.clock.nowIso();
    const hours = hoursUntil(apt.startsAt.toISOString(), now);
    // Politica: cliente -> segun antelacion; negocio que cancela -> devolucion total
    const refund = a.by === 'staff' ? { refundCents: apt.depositPaidCents, retainedCents: 0 } : computeDepositRefund(apt.depositPaidCents, hours, ctx.policy);
    const updated = await this.update(
      ctx.tenant.id, apt.id,
      { status: 'canceled', canceledAt: this.clock.now(), cancelReason: a.reason ?? null, refundedCents: refund.refundCents },
      a.expectedVersion ?? apt.version,
    );
    if (a.by === 'customer' && apt.customerId && hours < ctx.policy.fullRefundHours) {
      await this.handle.db.update(customers).set({ lateCancelCount: sql`${customers.lateCancelCount} + 1` }).where(eq(customers.id, apt.customerId));
    }
    await this.reminders.cancelAll(apt.id);
    this.emitUpdate(updated, 'appointment.canceled');
    if (a.notify) await this.notify(ctx, updated, 'appointment_canceled').catch((e) => this.log.error(e));
    // Disparar waitlist.offer con el hueco liberado
    await this.waitlist
      .offerFreedSlot({ tenantId: apt.tenantId, staffId: apt.staffId, startsAt: apt.startsAt, occupiedStart: apt.occupiedStart, occupiedEnd: apt.occupiedEnd })
      .catch((e) => this.log.error(`waitlist.offer: ${(e as Error).message}`));
    return updated;
  }

  // =========================================================================
  // Panel (privado)
  // =========================================================================

  async list(tenantId: string, q: { from: string; to: string; staffId?: string | undefined; status?: string | undefined; customerId?: string | undefined }): Promise<AppointmentDto[]> {
    await this.releaseExpired(tenantId);
    const statuses = q.status?.split(',').filter(Boolean);
    const rows = await this.handle.db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          lt(appointments.startsAt, new Date(q.to)),
          gt(appointments.endsAt, new Date(q.from)),
          q.staffId ? eq(appointments.staffId, q.staffId) : undefined,
          q.customerId ? eq(appointments.customerId, q.customerId) : undefined,
          statuses?.length ? inArray(appointments.status, statuses) : undefined,
        ),
      )
      .orderBy(appointments.startsAt)
      .limit(2000);
    const ctx = await this.tenants.byId(tenantId);
    return this.core.hydrate(tenantId, rows, ctx.tenant.currency);
  }

  async get(tenantId: string, id: string): Promise<AppointmentDto & { token: string }> {
    const apt = await this.loadApt(tenantId, id);
    const ctx = await this.tenants.byId(tenantId);
    const [dto] = await this.core.hydrate(tenantId, [apt], ctx.tenant.currency);
    return { ...dto!, token: this.core.token(id) };
  }

  async createManual(auth: AuthContext, input: AppointmentCreateInput, idempotencyKey?: string): Promise<AppointmentDto> {
    return this.idempotent(auth.tenantId, 'manual', idempotencyKey, async () => {
      const ctx = await this.tenants.byId(auth.tenantId);
      const tenantId = ctx.tenant.id;
      const now = this.clock.now();
      await this.releaseExpired(tenantId);
      const [stf] = await this.handle.db.select().from(staff).where(and(eq(staff.id, input.staffId), eq(staff.tenantId, tenantId), eq(staff.active, true))).limit(1);
      if (!stf) throw new AppError('NOT_FOUND', 'Profesional no encontrado o inactivo.');
      const svcRows = await this.availability.loadServices(tenantId, input.serviceIds);

      if (!input.ignoreSchedule) {
        const date = localDateOf(toAbsMin(input.startsAt), ctx.tz);
        const avail = await this.availability.compute(ctx, { serviceIds: input.serviceIds, staffId: input.staffId, from: date, to: date, ignoreRules: true });
        if (!findSlot(avail.slots, input.startsAt, input.staffId)) {
          throw new AppError('SLOT_UNAVAILABLE', 'Ese horario no esta disponible para el profesional (fuera de horario, bloqueado u ocupado).', {
            alternatives: await this.alternatives(ctx, input.serviceIds, input.staffId, input.startsAt, true, false),
          });
        }
      }

      let created: AptRow;
      try {
        created = await this.handle.db.transaction(async (tx) => {
          let customerId = input.customerId;
          let customerNoShows = 0;
          if (customerId) {
            const [c] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
            if (!c) throw new AppError('NOT_FOUND', 'Cliente no encontrado.');
            customerNoShows = c.noShowCount;
          } else if (input.newCustomer) {
            const c = await this.core.upsertCustomer(tx, tenantId, { fullName: input.newCustomer.fullName, phone: input.newCustomer.phone, email: input.newCustomer.email, consent: false, now });
            customerId = c.id;
            customerNoShows = c.noShowCount;
          } else {
            throw new AppError('VALIDATION_ERROR', 'Indica un cliente existente o los datos de uno nuevo.');
          }
          const items = await this.core.priceFor(tx, tenantId, input.staffId, svcRows);
          const plan = this.core.plan(items, input.startsAt);
          let deposit = 0;
          if (input.requireDeposit) {
            deposit = requiredDepositCents({
              serviceDepositsCents: svcRows.map((s) => s.depositCents), totalCents: plan.totalCents, customerNoShows: Math.max(customerNoShows, ctx.settings.noShowThreshold),
              noShowThreshold: ctx.settings.noShowThreshold, riskDepositPct: ctx.settings.riskDepositPct,
            });
          }
          return this.core.insertAppointment(tx, {
            tenantId, customerId: customerId!, staffId: input.staffId, status: deposit > 0 ? 'pending' : 'confirmed', plan, items, source: 'manual',
            depositRequiredCents: deposit, notes: input.notes ?? null, consentWhatsapp: input.sendConfirmation, createdBy: auth.userId, now,
          });
        });
      } catch (e) {
        return this.core.throwIfSlotTaken(e, await this.alternatives(ctx, input.serviceIds, input.staffId, input.startsAt, true, false));
      }
      await this.reminders.sync(created.id);
      this.emitUpdate(created, 'appointment.created');
      if (created.status === 'confirmed' && input.sendConfirmation) void this.reminders.processDue(10).catch(() => undefined);
      const [dto] = await this.core.hydrate(tenantId, [created], ctx.tenant.currency);
      return dto!;
    });
  }

  async patch(auth: AuthContext, id: string, input: AppointmentPatchInput, expectedVersion?: number): Promise<AppointmentDto> {
    const ctx = await this.tenants.byId(auth.tenantId);
    let apt = await this.loadApt(auth.tenantId, id);
    if (expectedVersion !== undefined && apt.version !== expectedVersion) {
      throw new AppError('VERSION_MISMATCH', 'La cita fue modificada por otra persona. Recarga e intenta de nuevo.');
    }
    let version = apt.version;
    const moves = input.startsAt !== undefined || input.staffId !== undefined || input.serviceIds !== undefined;
    if (moves) {
      if (!['pending', 'confirmed'].includes(apt.status)) throw new AppError('INVALID_TRANSITION', 'Solo se pueden mover citas pendientes o confirmadas.');
      apt = await this.moveTo(ctx, apt, {
        startsAt: input.startsAt ?? apt.startsAt.toISOString(), staffId: input.staffId ?? apt.staffId, serviceIds: input.serviceIds,
        by: 'staff', ignoreSchedule: input.ignoreSchedule, expectedVersion: version,
      });
      version = apt.version;
    }
    if (input.notes !== undefined) {
      apt = await this.update(auth.tenantId, id, { notes: input.notes }, version);
      version = apt.version;
    }
    if (input.status && input.status !== apt.status) {
      apt = await this.transition(ctx, apt, input.status as AppointmentStatus, version);
    }
    this.emitUpdate(apt);
    const [dto] = await this.core.hydrate(auth.tenantId, [apt], ctx.tenant.currency);
    return dto!;
  }

  private async transition(ctx: TenantContext, apt: AptRow, to: AppointmentStatus, expectedVersion?: number): Promise<AptRow> {
    const from = apt.status as AppointmentStatus;
    if (!canTransition(from, to)) throw new AppError('INVALID_TRANSITION', `No se puede pasar de "${from}" a "${to}".`);
    if (to === 'canceled') return this.cancelInternal(ctx, apt, { by: 'staff', reason: 'Cancelada por el negocio', notify: true, ...(expectedVersion !== undefined ? { expectedVersion } : {}) });
    if (to === 'completed') return this.completeInternal(ctx, apt, {}, expectedVersion);
    if (to === 'no_show') return this.noShowInternal(ctx, apt, expectedVersion);
    if (to === 'in_progress') {
      return this.update(ctx.tenant.id, apt.id, { status: 'in_progress', checkedInAt: this.clock.now() }, expectedVersion);
    }
    if (to === 'confirmed') {
      const updated = await this.update(ctx.tenant.id, apt.id, { status: 'confirmed', holdExpiresAt: null, depositPaidCents: Math.max(apt.depositPaidCents, apt.depositRequiredCents) }, expectedVersion);
      await this.reminders.sync(apt.id);
      void this.reminders.processDue(10).catch(() => undefined);
      return updated;
    }
    return this.update(ctx.tenant.id, apt.id, { status: to }, expectedVersion);
  }

  async checkIn(auth: AuthContext, id: string, expectedVersion?: number): Promise<AppointmentDto> {
    const ctx = await this.tenants.byId(auth.tenantId);
    const apt = await this.loadApt(auth.tenantId, id);
    const updated = await this.transition(ctx, apt, 'in_progress', expectedVersion);
    this.emitUpdate(updated);
    const [dto] = await this.core.hydrate(auth.tenantId, [updated], ctx.tenant.currency);
    return dto!;
  }

  async complete(auth: AuthContext, id: string, input: { paymentMethod?: string | undefined; amountCents?: number | undefined }, expectedVersion?: number): Promise<AppointmentDto> {
    const ctx = await this.tenants.byId(auth.tenantId);
    const apt = await this.loadApt(auth.tenantId, id);
    if (!canTransition(apt.status as AppointmentStatus, 'completed')) throw new AppError('INVALID_TRANSITION', `No se puede completar una cita "${apt.status}".`);
    const updated = await this.completeInternal(ctx, apt, input, expectedVersion);
    const [dto] = await this.core.hydrate(auth.tenantId, [updated], ctx.tenant.currency);
    return dto!;
  }

  private async completeInternal(ctx: TenantContext, apt: AptRow, input: { paymentMethod?: string | undefined; amountCents?: number | undefined }, expectedVersion?: number): Promise<AptRow> {
    const charge = input.amountCents ?? Math.max(0, apt.totalCents - apt.depositPaidCents);
    const updated = await this.update(
      ctx.tenant.id, apt.id,
      { status: 'completed', completedAt: this.clock.now(), paidCents: apt.depositPaidCents + charge, paymentMethod: input.paymentMethod ?? 'cash', checkedInAt: apt.checkedInAt ?? this.clock.now() },
      expectedVersion,
    );
    await this.reminders.sync(apt.id); // programa solo la solicitud de resena
    this.emitUpdate(updated);
    return updated;
  }

  async noShow(auth: AuthContext, id: string, expectedVersion?: number): Promise<AppointmentDto> {
    const ctx = await this.tenants.byId(auth.tenantId);
    const apt = await this.loadApt(auth.tenantId, id);
    if (!canTransition(apt.status as AppointmentStatus, 'no_show')) throw new AppError('INVALID_TRANSITION', `No se puede marcar inasistencia en una cita "${apt.status}".`);
    const updated = await this.noShowInternal(ctx, apt, expectedVersion);
    const [dto] = await this.core.hydrate(auth.tenantId, [updated], ctx.tenant.currency);
    return dto!;
  }

  private async noShowInternal(ctx: TenantContext, apt: AptRow, expectedVersion?: number): Promise<AptRow> {
    const updated = await this.update(ctx.tenant.id, apt.id, { status: 'no_show' }, expectedVersion);
    if (apt.customerId) {
      await this.handle.db.update(customers).set({ noShowCount: sql`${customers.noShowCount} + 1` }).where(eq(customers.id, apt.customerId));
    }
    await this.reminders.cancelAll(apt.id);
    this.emitUpdate(updated);
    return updated;
  }

  async cancel(auth: AuthContext, id: string, input: { reason?: string | undefined; notifyCustomer: boolean }, expectedVersion?: number): Promise<AppointmentDto> {
    const ctx = await this.tenants.byId(auth.tenantId);
    const apt = await this.loadApt(auth.tenantId, id);
    const updated = await this.cancelInternal(ctx, apt, { by: 'staff', reason: input.reason ?? 'Cancelada por el negocio', notify: input.notifyCustomer, ...(expectedVersion !== undefined ? { expectedVersion } : {}) });
    const [dto] = await this.core.hydrate(auth.tenantId, [updated], ctx.tenant.currency);
    return dto!;
  }

  async registerDeposit(auth: AuthContext, id: string, amountCents?: number): Promise<AppointmentDto> {
    const ctx = await this.tenants.byId(auth.tenantId);
    const apt = await this.loadApt(auth.tenantId, id);
    if (apt.status !== 'pending') throw new AppError('INVALID_TRANSITION', 'La cita no esta pendiente de pago.');
    const updated = await this.payDeposit(ctx, apt, amountCents);
    const [dto] = await this.core.hydrate(auth.tenantId, [updated], ctx.tenant.currency);
    return dto!;
  }

  /** Citas sin confirmar (pending, o confirmed sin respuesta del cliente) para las alertas del dia. */
  async unconfirmed(tenantId: string, from: Date, to: Date): Promise<AppointmentDto[]> {
    const rows = await this.handle.db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          gt(appointments.startsAt, from),
          lt(appointments.startsAt, to),
          or(eq(appointments.status, 'pending'), and(eq(appointments.status, 'confirmed'), eq(appointments.confirmedByCustomer, false))),
        ),
      )
      .orderBy(appointments.startsAt);
    const ctx = await this.tenants.byId(tenantId);
    return this.core.hydrate(tenantId, rows, ctx.tenant.currency);
  }

  async forCustomer(tenantId: string, customerId: string): Promise<AppointmentDto[]> {
    const rows = await this.handle.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.tenantId, tenantId), eq(appointments.customerId, customerId)))
      .orderBy(desc(appointments.startsAt))
      .limit(100);
    const ctx = await this.tenants.byId(tenantId);
    return this.core.hydrate(tenantId, rows, ctx.tenant.currency);
  }

  /** Accion de un boton de plantilla de WhatsApp (webhook). */
  async applyCustomerAction(appointmentId: string, action: 'confirm' | 'reschedule' | 'cancel' | 'accept'): Promise<{ reply: string }> {
    const [apt] = await this.handle.db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
    if (!apt) return { reply: 'No encontramos esa cita.' };
    const ctx = await this.tenants.byId(apt.tenantId);
    const link = `${this.config.publicWebUrl}/${ctx.tenant.slug}/cita/${this.core.token(apt.id)}`;
    if (action === 'confirm') {
      if (apt.status === 'confirmed') {
        await this.handle.db.update(appointments).set({ confirmedByCustomer: true, updatedAt: this.clock.now() }).where(eq(appointments.id, apt.id));
        this.events.emit(apt.tenantId, 'appointment.updated', { id: apt.id, confirmedByCustomer: true });
        return { reply: `¡Perfecto! Tu asistencia quedo confirmada para el ${dateLabel(apt.startsAt, ctx.tz)} a las ${timeLabel(apt.startsAt, ctx.tz)}.` };
      }
      return { reply: 'Esta cita ya no esta activa.' };
    }
    if (action === 'reschedule') return { reply: `Puedes elegir un nuevo horario aqui: ${link}` };
    if (action === 'accept') {
      await this.publicAccept(this.core.token(apt.id));
      return { reply: '¡Listo! Tu cita quedo confirmada.' };
    }
    const decision = canCustomerCancel(apt.startsAt.toISOString(), this.clock.nowIso(), ctx.policy);
    if (!decision.allowed) return { reply: `${decision.reason ?? 'No se puede cancelar.'}` };
    await this.cancelInternal(ctx, apt, { by: 'customer', reason: 'Cancelada por WhatsApp', notify: false });
    return { reply: 'Tu cita fue cancelada. Cuando quieras puedes agendar de nuevo.' };
  }
}
