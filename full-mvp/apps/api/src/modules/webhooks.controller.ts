import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { type DbHandle, and, appointments, customers, eq, messageLog } from '@agenda/db';
import { parseButtonPayload, parseWebhook, verifyWebhookSignature } from '@agenda/whatsapp';
import { z } from 'zod';
import { Auth, type AuthContext, Public } from '../common/auth';
import { CONFIG, type AppConfig } from '../common/config';
import { AppError } from '../common/errors';
import { getRawBody } from '../common/raw-body';
import { zod } from '../common/zod.pipe';
import { DB_HANDLE } from '../core/db.provider';
import { MessagingService } from '../core/messaging.service';
import { AppointmentsService } from './appointments/appointments.service';

/** Normaliza E.164 para comparar (quita espacios; acepta con o sin +). */
const normPhone = (p: string): string => {
  const d = p.replace(/\D/g, '');
  return d ? `+${d}` : '';
};

/** Webhook de la WhatsApp Cloud API: respuestas de botones (Confirmo / Reprogramar / Cancelar) y mensajes entrantes. */
@Controller('v1/webhooks/whatsapp')
export class WebhooksController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(AppointmentsService) private readonly appts: AppointmentsService,
  ) {}

  @Public()
  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res({ passthrough: true }) res: { header: (k: string, v: string) => void }) {
    if (mode === 'subscribe' && token === this.config.whatsappVerifyToken) {
      res.header('content-type', 'text/plain');
      return challenge;
    }
    throw new AppError('FORBIDDEN', 'Token de verificación inválido.');
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: { raw?: object },
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: unknown,
  ) {
    const cloud = this.config.whatsappMode === 'cloud';
    if (!cloud && !this.config.demoMode) {
      throw new AppError('FORBIDDEN', 'El webhook de WhatsApp está deshabilitado fuera de modo cloud o demostración.');
    }
    // En cloud (y si hay app secret configurado) la firma es obligatoria.
    if (cloud || this.config.whatsappAppSecret) {
      const raw = getRawBody(req);
      const secret = this.config.whatsappAppSecret;
      if (!raw || !secret || !verifyWebhookSignature(raw, signature, secret)) {
        throw new AppError('FORBIDDEN', 'Firma del webhook inválida.');
      }
    }

    let handled = 0;
    for (const ev of parseWebhook(payload)) {
      if (ev.type === 'status') {
        await this.handle.db
          .update(messageLog)
          .set({ status: ev.status, ...(ev.errorCode ? { errorCode: ev.errorCode } : {}), ...(ev.status === 'delivered' ? { deliveredAt: new Date() } : {}), ...(ev.status === 'read' ? { readAt: new Date() } : {}) })
          .where(eq(messageLog.waMessageId, ev.waMessageId));
        handled++;
        continue;
      }

      if (ev.type === 'button') {
        const parsed = parseButtonPayload(ev.payload);
        if (!parsed) continue;
        const [apt] = await this.handle.db.select().from(appointments).where(eq(appointments.id, parsed.appointmentId)).limit(1);
        if (!apt?.customerId) continue;
        const [cust] = await this.handle.db
          .select({ phone: customers.phoneE164 })
          .from(customers)
          .where(and(eq(customers.id, apt.customerId), eq(customers.tenantId, apt.tenantId)))
          .limit(1);
        if (!cust || normPhone(cust.phone) !== normPhone(ev.from)) continue;
        await this.messaging.recordInbound({ tenantId: apt.tenantId, phone: ev.from, body: ev.text || ev.payload, waMessageId: ev.waMessageId });
        const { reply } = await this.appts.applyCustomerAction(parsed.appointmentId, parsed.action, ev.from);
        await this.messaging.sendText({ tenantId: apt.tenantId, phone: ev.from, body: reply, appointmentId: parsed.appointmentId });
        handled++;
        continue;
      }

      // Texto: solo si el celular ya pertenece a un cliente (nunca caemos al "primer tenant").
      const tenantId = await this.tenantForPhone(ev.from);
      if (!tenantId) continue;
      await this.messaging.recordInbound({ tenantId, phone: ev.from, body: ev.text, waMessageId: ev.waMessageId });
      handled++;
    }
    return { received: true, handled };
  }

  /** Demo (mock): simula que el cliente tocó un botón de una plantilla. Requiere sesión del panel. */
  @Post('simulate-button')
  @HttpCode(200)
  async simulateButton(
    @Auth() a: AuthContext,
    @Body(zod(z.object({ appointmentId: z.string().uuid(), action: z.enum(['confirm', 'reschedule', 'cancel', 'accept']) }))) body: { appointmentId: string; action: 'confirm' | 'reschedule' | 'cancel' | 'accept' },
  ) {
    if (this.messaging.mode !== 'mock' || !this.config.demoMode) throw new AppError('FORBIDDEN', 'Solo disponible en modo demostración.');
    const apt = await this.appts.get(a.tenantId, body.appointmentId);
    if (!apt.customerPhone) throw new AppError('VALIDATION_ERROR', 'La cita no tiene cliente.');
    const label = { confirm: 'Confirmo', reschedule: 'Reprogramar', cancel: 'Cancelar', accept: 'Lo quiero' }[body.action];
    await this.messaging.recordInbound({ tenantId: a.tenantId, phone: apt.customerPhone, body: label });
    const { reply } = await this.appts.applyCustomerAction(body.appointmentId, body.action, apt.customerPhone);
    await this.messaging.sendText({ tenantId: a.tenantId, phone: apt.customerPhone, body: reply, appointmentId: body.appointmentId });
    return { reply };
  }

  /** Resuelve tenant solo por cliente existente. Nunca usa el "primer tenant" de la tabla. */
  private async tenantForPhone(phone: string): Promise<string | null> {
    const n = normPhone(phone);
    const [c] = await this.handle.db.select({ tenantId: customers.tenantId }).from(customers).where(eq(customers.phoneE164, n)).limit(1);
    return c?.tenantId ?? null;
  }
}
