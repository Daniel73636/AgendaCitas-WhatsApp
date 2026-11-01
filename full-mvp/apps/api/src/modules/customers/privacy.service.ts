import { Inject, Injectable } from '@nestjs/common';
import { PRIVACY_POLICY_VERSION } from '@agenda/contracts';
import {
  type DbHandle,
  and,
  appointmentItems,
  appointments,
  auditLog,
  customers,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  messageLog,
  or,
  otpCodes,
  uuidv7,
  waitlistEntries,
} from '@agenda/db';
import type { AuthContext } from '../../common/auth';
import { AppError } from '../../common/errors';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { AppointmentsService } from '../appointments/appointments.service';
import { CustomersService } from './customers.service';

const ACTIVE = ['held', 'pending', 'confirmed', 'in_progress'];

/**
 * Derechos del titular (Ley 1581 de 2012, habeas data): acceso/portabilidad (exportar) y supresion.
 * Solo el rol owner. Cada accion queda en `audit_log` SIN datos personales.
 */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(AppointmentsService) private readonly appts: AppointmentsService,
  ) {}

  private async audit(a: AuthContext, action: string, entityId: string, correlationId: string | undefined, details: Record<string, unknown> = {}) {
    await this.handle.db.insert(auditLog).values({
      id: uuidv7(), tenantId: a.tenantId, userId: a.userId, action, entity: 'customer', entityId, correlationId: correlationId ?? null, details, createdAt: this.clock.now(),
    });
  }

  /** Todos los datos que el negocio guarda de un cliente (JSON portable). */
  async exportData(a: AuthContext, customerId: string, correlationId?: string) {
    const { db } = this.handle;
    const customer = await this.customers.get(a.tenantId, customerId);
    const [row] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, a.tenantId))).limit(1);
    const apts = await db.select().from(appointments).where(and(eq(appointments.tenantId, a.tenantId), eq(appointments.customerId, customerId))).orderBy(desc(appointments.startsAt));
    const items = apts.length
      ? await db.select().from(appointmentItems).where(and(eq(appointmentItems.tenantId, a.tenantId), inArray(appointmentItems.appointmentId, apts.map((x) => x.id))))
      : [];
    const messages = await db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.tenantId, a.tenantId), or(eq(messageLog.customerId, customerId), eq(messageLog.phoneE164, customer.phone))))
      .orderBy(desc(messageLog.createdAt));
    const waitlist = await db.select().from(waitlistEntries).where(and(eq(waitlistEntries.tenantId, a.tenantId), eq(waitlistEntries.customerId, customerId)));
    await this.audit(a, 'customer.export', customerId, correlationId, { appointments: apts.length, messages: messages.length });
    return {
      exportedAt: this.clock.nowIso(),
      policyVersion: PRIVACY_POLICY_VERSION,
      customer,
      consent: {
        whatsapp: customer.consentWhatsapp,
        privacyAcceptedAt: row?.privacyAcceptedAt?.toISOString() ?? null,
        privacyPolicyVersion: row?.privacyPolicyVersion ?? null,
      },
      appointments: apts.map((x) => ({
        id: x.id, status: x.status, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString(), source: x.source, totalCents: x.totalCents,
        paidCents: x.paidCents, notes: x.notes, createdAt: x.createdAt.toISOString(),
        services: items.filter((i) => i.appointmentId === x.id).sort((p, q) => p.position - q.position).map((i) => ({ name: i.nameSnapshot, durationMin: i.durationMin, priceCents: i.priceCents })),
      })),
      messages: messages.map((m) => ({ direction: m.direction, channel: m.channel, template: m.template, body: m.body, status: m.status, createdAt: m.createdAt.toISOString() })),
      waitlist: waitlist.map((w) => ({ serviceId: w.serviceId, status: w.status, windowStart: w.windowStart.toISOString(), windowEnd: w.windowEnd.toISOString() })),
    };
  }

  /**
   * Supresion = anonimizacion. Se borran mensajes, OTP y lista de espera; las citas se conservan sin datos
   * personales (trazabilidad contable). Con citas futuras exige `force` (las cancela sin avisar al cliente).
   */
  async erase(a: AuthContext, customerId: string, opts: { force: boolean }, correlationId?: string) {
    const { db } = this.handle;
    const now = this.clock.now();
    const [c] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, a.tenantId), isNull(customers.deletedAt))).limit(1);
    if (!c) throw new AppError('NOT_FOUND', 'Cliente no encontrado.');

    const future = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.tenantId, a.tenantId), eq(appointments.customerId, customerId), inArray(appointments.status, ACTIVE), gt(appointments.endsAt, now)));
    if (future.length && !opts.force) {
      throw new AppError('HAS_FUTURE_APPOINTMENTS', `El cliente tiene ${future.length} cita(s) vigente(s). Cancelalas antes o repite con force=true para cancelarlas y suprimir.`, { details: { count: future.length } });
    }
    for (const f of future) {
      await this.appts.cancel(a, f.id, { reason: 'Supresion de datos del titular', notifyCustomer: false });
    }

    const phone = c.phoneE164;
    const counts = await db.transaction(async (tx) => {
      const msgs = await tx
        .delete(messageLog)
        .where(and(eq(messageLog.tenantId, a.tenantId), or(eq(messageLog.customerId, customerId), eq(messageLog.phoneE164, phone))))
        .returning({ id: messageLog.id });
      const wl = await tx.delete(waitlistEntries).where(and(eq(waitlistEntries.tenantId, a.tenantId), eq(waitlistEntries.customerId, customerId))).returning({ id: waitlistEntries.id });
      await tx.delete(otpCodes).where(and(eq(otpCodes.tenantId, a.tenantId), eq(otpCodes.phoneE164, phone)));
      const apts = await tx
        .update(appointments)
        .set({ notes: null, updatedAt: now })
        .where(and(eq(appointments.tenantId, a.tenantId), eq(appointments.customerId, customerId)))
        .returning({ id: appointments.id });
      await tx
        .update(customers)
        .set({
          fullName: 'Cliente eliminado', phoneE164: `deleted:${customerId}`, email: null, birthday: null, notesEnc: null, tags: [],
          consentWhatsapp: false, privacyAcceptedAt: null, privacyPolicyVersion: null, mergedInto: null, deletedAt: now, updatedAt: now,
        })
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, a.tenantId)));
      return { messages: msgs.length, waitlist: wl.length, appointments: apts.length };
    });
    await this.audit(a, 'customer.erase', customerId, correlationId, { ...counts, appointmentsCanceled: future.length });
    return { deleted: true, anonymizedAppointments: counts.appointments, deletedMessages: counts.messages, deletedWaitlistEntries: counts.waitlist, canceledAppointments: future.length };
  }
}
