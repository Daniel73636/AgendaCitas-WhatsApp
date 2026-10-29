import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConversationDto, MessageDto } from '@agenda/contracts';
import { type DbHandle, and, customers, desc, eq, messageLog, sql, uuidv7 } from '@agenda/db';
import { type TemplateName, type TemplateParams, type WhatsAppClient, createWhatsAppClient, renderTemplate } from '@agenda/whatsapp';
import { CONFIG, type AppConfig } from '../common/config';
import { ClockService } from './clock.service';
import { DB_HANDLE } from './db.provider';
import { EventsService } from './events.service';

export const WA_CLIENT = Symbol('WA_CLIENT');

type MessageRow = typeof messageLog.$inferSelect;
export const toMessageDto = (m: MessageRow): MessageDto => ({
  id: m.id,
  appointmentId: m.appointmentId,
  customerId: m.customerId,
  phone: m.phoneE164,
  direction: m.direction as 'in' | 'out',
  channel: m.channel,
  template: m.template,
  body: m.body,
  status: m.status,
  errorCode: m.errorCode,
  createdAt: m.createdAt.toISOString(),
});

export interface SendTemplateArgs {
  tenantId: string;
  phone: string;
  template: TemplateName;
  params: TemplateParams;
  appointmentId?: string | null;
  customerId?: string | null;
}

/** Modulo de mensajeria compartido: envia por WhatsApp (mock o Cloud API) y deja rastro en message_log. */
@Injectable()
export class MessagingService {
  private readonly log = new Logger('WhatsApp');
  readonly client: WhatsAppClient;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(ClockService) private readonly clock: ClockService,
  ) {
    this.client = createWhatsAppClient({
      mode: config.whatsappMode,
      phoneNumberId: config.whatsappPhoneNumberId,
      accessToken: config.whatsappAccessToken,
      log: (l) => this.log.log(l),
    });
  }

  get mode(): 'mock' | 'cloud' {
    return this.client.mode;
  }

  async sendTemplate(a: SendTemplateArgs): Promise<{ ok: boolean; messageId: string; errorCode?: string }> {
    const now = this.clock.now();
    const rendered = renderTemplate(a.template, a.params);
    const res = await this.client.sendTemplate(a.phone, a.template, a.params, a.appointmentId ? { appointmentId: a.appointmentId } : undefined);
    const id = uuidv7();
    await this.handle.db.insert(messageLog).values({
      id,
      tenantId: a.tenantId,
      appointmentId: a.appointmentId ?? null,
      customerId: a.customerId ?? null,
      phoneE164: a.phone,
      direction: 'out',
      template: a.template,
      body: rendered.body,
      waMessageId: res.waMessageId ?? null,
      status: res.ok ? 'sent' : 'failed',
      errorCode: res.errorCode ?? null,
      sentAt: res.ok ? now : null,
      createdAt: now,
    });
    if (!res.ok) this.log.warn(`Fallo de WhatsApp a ${a.phone} (${res.errorCode}). Respaldo SMS/correo: pendiente de integrar.`);
    this.events.emit(a.tenantId, 'message.sent', { messageId: id, phone: a.phone, appointmentId: a.appointmentId ?? null, ok: res.ok });
    return { ok: res.ok, messageId: id, ...(res.errorCode ? { errorCode: res.errorCode } : {}) };
  }

  /** Texto libre (respuestas del panel dentro de la ventana de 24 h). */
  async sendText(a: { tenantId: string; phone: string; body: string; customerId?: string | null; appointmentId?: string | null }) {
    const now = this.clock.now();
    const res = await this.client.sendText(a.phone, a.body);
    const id = uuidv7();
    const [row] = await this.handle.db
      .insert(messageLog)
      .values({
        id, tenantId: a.tenantId, appointmentId: a.appointmentId ?? null, customerId: a.customerId ?? null, phoneE164: a.phone,
        direction: 'out', template: null, body: a.body, waMessageId: res.waMessageId ?? null, status: res.ok ? 'sent' : 'failed',
        errorCode: res.errorCode ?? null, sentAt: res.ok ? now : null, createdAt: now,
      })
      .returning();
    this.events.emit(a.tenantId, 'message.sent', { messageId: id, phone: a.phone, ok: res.ok });
    return toMessageDto(row!);
  }

  async recordInbound(a: { tenantId: string; phone: string; body: string; waMessageId?: string }): Promise<MessageDto> {
    const [cust] = await this.handle.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, a.tenantId), eq(customers.phoneE164, a.phone)))
      .limit(1);
    const now = this.clock.now();
    const [row] = await this.handle.db
      .insert(messageLog)
      .values({
        id: uuidv7(), tenantId: a.tenantId, customerId: cust?.id ?? null, phoneE164: a.phone, direction: 'in', template: null,
        body: a.body, waMessageId: a.waMessageId ?? null, status: 'received', readByStaff: false, sentAt: now, createdAt: now,
      })
      .returning();
    this.events.emit(a.tenantId, 'message.received', { phone: a.phone, body: a.body });
    return toMessageDto(row!);
  }

  async conversations(tenantId: string): Promise<ConversationDto[]> {
    const rows = await this.handle.db.execute(sql`
      SELECT m.phone_e164 AS phone,
             (array_agg(m.customer_id ORDER BY m.created_at DESC))[1] AS customer_id,
             (array_agg(m.body ORDER BY m.created_at DESC))[1] AS last_message,
             max(m.created_at) AS last_at,
             count(*) FILTER (WHERE m.direction = 'in' AND m.read_by_staff = false) AS unread
      FROM message_log m
      WHERE m.tenant_id = ${tenantId}
      GROUP BY m.phone_e164
      ORDER BY max(m.created_at) DESC
      LIMIT 100`);
    const list = ((rows as unknown as { rows: Array<Record<string, unknown>> }).rows ?? (rows as unknown as Array<Record<string, unknown>>));
    const custs = await this.handle.db.select({ id: customers.id, name: customers.fullName, phone: customers.phoneE164 }).from(customers).where(eq(customers.tenantId, tenantId));
    const byPhone = new Map(custs.map((c) => [c.phone, c]));
    return list.map((r) => {
      const phone = String(r.phone);
      const c = byPhone.get(phone);
      return {
        phone,
        customerId: (r.customer_id as string | null) ?? c?.id ?? null,
        customerName: c?.name ?? null,
        lastMessage: String(r.last_message ?? ''),
        lastAt: new Date(r.last_at as string | Date).toISOString(),
        unread: Number(r.unread ?? 0),
      };
    });
  }

  async thread(tenantId: string, phone: string, markRead = true): Promise<MessageDto[]> {
    const rows = await this.handle.db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.tenantId, tenantId), eq(messageLog.phoneE164, phone)))
      .orderBy(desc(messageLog.createdAt))
      .limit(200);
    if (markRead) {
      await this.handle.db
        .update(messageLog)
        .set({ readByStaff: true })
        .where(and(eq(messageLog.tenantId, tenantId), eq(messageLog.phoneE164, phone), eq(messageLog.direction, 'in'), eq(messageLog.readByStaff, false)));
    }
    return rows.reverse().map(toMessageDto);
  }

  async byAppointment(tenantId: string, appointmentId: string): Promise<MessageDto[]> {
    const rows = await this.handle.db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.tenantId, tenantId), eq(messageLog.appointmentId, appointmentId)))
      .orderBy(messageLog.createdAt);
    return rows.map(toMessageDto);
  }
}
