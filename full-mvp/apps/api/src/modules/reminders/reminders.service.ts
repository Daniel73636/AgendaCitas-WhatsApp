import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type DbHandle,
  and,
  appointmentItems,
  appointments,
  asc,
  customers,
  eq,
  inArray,
  lte,
  reminderJobs,
  sql,
  staff,
  uuidv7,
} from '@agenda/db';
import { buildReminderTimeline, type ReminderKind } from '@agenda/domain-booking';
import type { TemplateName } from '@agenda/whatsapp';
import { CONFIG, type AppConfig } from '../../common/config';
import { dateLabel, timeLabel } from '../../common/format';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { MessagingService } from '../../core/messaging.service';
import { TenantContextService } from '../../core/tenant-context.service';
import { BookingCoreService } from '../appointments/booking-core.service';

const TEMPLATE_OF: Record<ReminderKind, TemplateName> = {
  confirm: 'appointment_confirmation',
  r24: 'appointment_reminder_24h',
  r6: 'appointment_reminder_6h',
  r2: 'appointment_reminder_2h',
  review: 'review_request',
};

export interface TickResult {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Programador de recordatorios con jobId determinista `apt:{id}:{tipo}`.
 * Los trabajos viven en BD (patron outbox): sobreviven reinicios y el barrido periodico
 * (processDue) funciona tambien como "red de seguridad" para los que se perdieron.
 */
@Injectable()
export class RemindersService {
  private readonly log = new Logger('Reminders');

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
    @Inject(BookingCoreService) private readonly core: BookingCoreService,
  ) {}

  async cancelAll(appointmentId: string): Promise<void> {
    await this.handle.db
      .update(reminderJobs)
      .set({ status: 'canceled', processedAt: this.clock.now(), updatedAt: this.clock.now() })
      .where(and(eq(reminderJobs.appointmentId, appointmentId), eq(reminderJobs.status, 'pending')));
  }

  /**
   * Reprogramar = descartar pendientes y crear los nuevos (misma funcion que al confirmar).
   * `skipConfirm`: al reprogramar no se reenvia la confirmacion (se envia "reprogramada").
   */
  async sync(appointmentId: string, opts: { skipConfirm?: boolean } = {}): Promise<ReminderKind[]> {
    const { db } = this.handle;
    const [apt] = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
    if (!apt) return [];
    await this.cancelAll(appointmentId);
    if (apt.status !== 'confirmed' && apt.status !== 'completed') return [];
    const ctx = await this.tenants.byId(apt.tenantId);
    const now = this.clock.now();
    let plan = buildReminderTimeline({
      appointmentId,
      startsAt: apt.startsAt.toISOString(),
      endsAt: apt.endsAt.toISOString(),
      now: now.toISOString(),
      timezone: ctx.tz,
      policy: ctx.reminderPolicy,
    });
    if (apt.status === 'confirmed') plan = plan.filter((p) => p.kind !== 'review' && !(opts.skipConfirm && p.kind === 'confirm'));
    else plan = plan.filter((p) => p.kind === 'review' && now.getTime() - apt.endsAt.getTime() < 48 * 3_600_000);
    for (const p of plan) {
      const runAt = new Date(p.runAt);
      await db
        .insert(reminderJobs)
        .values({
          id: uuidv7(), tenantId: apt.tenantId, appointmentId, jobKey: p.jobKey, kind: p.kind, runAt,
          appointmentVersion: apt.version, status: 'pending', createdAt: now, updatedAt: now,
        })
        .onConflictDoUpdate({
          target: reminderJobs.jobKey,
          set: { runAt, appointmentVersion: apt.version, status: 'pending', attempts: 0, lastError: null, processedAt: null, updatedAt: now },
        });
    }
    return plan.map((p) => p.kind);
  }

  async pendingFor(appointmentId: string) {
    return this.handle.db
      .select()
      .from(reminderJobs)
      .where(and(eq(reminderJobs.appointmentId, appointmentId), eq(reminderJobs.status, 'pending')))
      .orderBy(asc(reminderJobs.runAt));
  }

  async processDue(limit = 50): Promise<TickResult> {
    const { db } = this.handle;
    const now = this.clock.now();
    const due = await db
      .select()
      .from(reminderJobs)
      .where(and(eq(reminderJobs.status, 'pending'), lte(reminderJobs.runAt, now)))
      .orderBy(asc(reminderJobs.runAt))
      .limit(limit);
    const res: TickResult = { processed: 0, sent: 0, skipped: 0, failed: 0 };
    for (const job of due) {
      // reclamar el trabajo (evita doble envio si dos barridos coinciden)
      const claimed = await db
        .update(reminderJobs)
        .set({ attempts: sql`${reminderJobs.attempts} + 1`, updatedAt: now })
        .where(and(eq(reminderJobs.id, job.id), eq(reminderJobs.status, 'pending'), eq(reminderJobs.attempts, job.attempts)))
        .returning({ id: reminderJobs.id });
      if (claimed.length === 0) continue;
      res.processed++;
      try {
        const outcome = await this.handleJob(job, now);
        if (outcome === 'sent') res.sent++;
        else if (outcome === 'skipped') res.skipped++;
        else if (outcome === 'failed') res.failed++;
      } catch (e) {
        res.failed++;
        this.log.error(`Fallo procesando ${job.jobKey}: ${(e as Error).message}`);
        await this.finish(job.id, job.attempts + 1 >= 3 ? 'failed' : 'pending', now, (e as Error).message, job.attempts + 1 < 3 ? new Date(now.getTime() + 5 * 60_000) : undefined);
      }
    }
    return res;
  }

  private async finish(id: string, status: 'sent' | 'skipped' | 'failed' | 'pending', now: Date, error?: string, retryAt?: Date) {
    await this.handle.db
      .update(reminderJobs)
      .set({
        status,
        lastError: error ?? null,
        processedAt: status === 'pending' ? null : now,
        updatedAt: now,
        ...(retryAt ? { runAt: retryAt } : {}),
      })
      .where(eq(reminderJobs.id, id));
  }

  private async handleJob(job: typeof reminderJobs.$inferSelect, now: Date): Promise<'sent' | 'skipped' | 'failed' | 'retry'> {
    const { db } = this.handle;
    const kind = job.kind as ReminderKind;
    // Recargar la cita y verificar estado y version: evita mensajes obsoletos
    const [apt] = await db.select().from(appointments).where(eq(appointments.id, job.appointmentId)).limit(1);
    if (!apt) return this.skip(job.id, now, 'cita inexistente');
    if (apt.version !== job.appointmentVersion) return this.skip(job.id, now, 'version obsoleta');
    const okStatus = kind === 'review' ? apt.status === 'completed' : apt.status === 'confirmed';
    if (!okStatus) return this.skip(job.id, now, `estado ${apt.status} no aplica`);
    if (kind !== 'confirm' && kind !== 'review' && apt.startsAt <= now) return this.skip(job.id, now, 'la cita ya comenzo');
    if (!apt.consentWhatsapp || !apt.customerId) return this.skip(job.id, now, 'sin consentimiento de WhatsApp');
    const [customer] = await db.select().from(customers).where(eq(customers.id, apt.customerId)).limit(1);
    if (!customer) return this.skip(job.id, now, 'cliente inexistente');
    const [items, [stf]] = await Promise.all([
      db.select().from(appointmentItems).where(eq(appointmentItems.appointmentId, apt.id)),
      db.select().from(staff).where(inArray(staff.id, [apt.staffId])),
    ]);
    const ctx = await this.tenants.byId(apt.tenantId);
    const link = `${this.config.publicWebUrl}/${ctx.tenant.slug}/cita/${this.core.token(apt.id)}`;
    const result = await this.messaging.sendTemplate({
      tenantId: apt.tenantId,
      phone: customer.phoneE164,
      template: TEMPLATE_OF[kind],
      appointmentId: apt.id,
      customerId: customer.id,
      params: {
        name: customer.fullName.split(' ')[0] ?? customer.fullName,
        business: ctx.tenant.name,
        service: items.sort((a, b) => a.position - b.position).map((i) => i.nameSnapshot).join(' + '),
        staff: stf?.displayName ?? '',
        date: dateLabel(apt.startsAt, ctx.tz),
        time: timeLabel(apt.startsAt, ctx.tz),
        address: ctx.location.address ?? '',
        link,
        reviewUrl: ctx.settings.reviewUrl || link,
      },
    });
    if (result.ok) {
      await this.finish(job.id, 'sent', now);
      return 'sent';
    }
    const attempts = job.attempts + 1;
    if (attempts >= 3) {
      await this.finish(job.id, 'failed', now, `WhatsApp ${result.errorCode}`);
      return 'failed';
    }
    await this.finish(job.id, 'pending', now, `WhatsApp ${result.errorCode}`, new Date(now.getTime() + 5 * 60_000));
    return 'retry';
  }

  private async skip(id: string, now: Date, reason: string): Promise<'skipped'> {
    await this.finish(id, 'skipped', now, reason);
    return 'skipped';
  }
}
