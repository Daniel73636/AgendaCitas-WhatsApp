import { Body, Controller, Get, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import { type DbHandle, customers, eq, messageLog, tenants } from '@agenda/db';
import { parseButtonPayload, parseWebhook } from '@agenda/whatsapp';
import { z } from 'zod';
import { Auth, type AuthContext, Public } from '../common/auth';
import { CONFIG, type AppConfig } from '../common/config';
import { AppError } from '../common/errors';
import { zod } from '../common/zod.pipe';
import { DB_HANDLE } from '../core/db.provider';
import { MessagingService } from '../core/messaging.service';
import { AppointmentsService } from './appointments/appointments.service';

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
    throw new AppError('FORBIDDEN', 'Token de verificacion invalido.');
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Body() payload: unknown) {
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
      const tenantId = await this.tenantForPhone(ev.from);
      if (!tenantId) continue;
      if (ev.type === 'button') {
        const parsed = parseButtonPayload(ev.payload);
        await this.messaging.recordInbound({ tenantId, phone: ev.from, body: ev.text || ev.payload, waMessageId: ev.waMessageId });
        if (parsed) {
          const { reply } = await this.appts.applyCustomerAction(parsed.appointmentId, parsed.action);
          await this.messaging.sendText({ tenantId, phone: ev.from, body: reply, appointmentId: parsed.appointmentId });
        }
      } else {
        await this.messaging.recordInbound({ tenantId, phone: ev.from, body: ev.text, waMessageId: ev.waMessageId });
      }
      handled++;
    }
    return { received: true, handled };
  }

  /** Demo (mock): simula que el cliente toco un boton de una plantilla. Requiere sesion del panel. */
  @Post('simulate-button')
  @HttpCode(200)
  async simulateButton(
    @Auth() a: AuthContext,
    @Body(zod(z.object({ appointmentId: z.string().uuid(), action: z.enum(['confirm', 'reschedule', 'cancel', 'accept']) }))) body: { appointmentId: string; action: 'confirm' | 'reschedule' | 'cancel' | 'accept' },
  ) {
    if (this.messaging.mode !== 'mock') throw new AppError('FORBIDDEN', 'Solo disponible en modo mock.');
    const apt = await this.appts.get(a.tenantId, body.appointmentId);
    if (!apt.customerPhone) throw new AppError('VALIDATION_ERROR', 'La cita no tiene cliente.');
    const label = { confirm: 'Confirmo', reschedule: 'Reprogramar', cancel: 'Cancelar', accept: 'Lo quiero' }[body.action];
    await this.messaging.recordInbound({ tenantId: a.tenantId, phone: apt.customerPhone, body: label });
    const { reply } = await this.appts.applyCustomerAction(body.appointmentId, body.action);
    await this.messaging.sendText({ tenantId: a.tenantId, phone: apt.customerPhone, body: reply, appointmentId: body.appointmentId });
    return { reply };
  }

  private async tenantForPhone(phone: string): Promise<string | null> {
    const [c] = await this.handle.db.select({ tenantId: customers.tenantId }).from(customers).where(eq(customers.phoneE164, phone)).limit(1);
    if (c) return c.tenantId;
    const [t] = await this.handle.db.select({ id: tenants.id }).from(tenants).limit(1);
    return t?.id ?? null;
  }
}
