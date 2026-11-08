import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type AppointmentDto,
  type MessageDto,
  appointmentCreateInput,
  appointmentPatchInput,
  appointmentsQuery,
  cancelAppointmentInput,
  completeInput,
} from '@agenda/contracts';
import { Auth, type AuthContext } from '../../common/auth';
import { AppError } from '../../common/errors';
import { zod } from '../../common/zod.pipe';
import { MessagingService } from '../../core/messaging.service';
import { AppointmentsService } from './appointments.service';
import { z } from 'zod';

/** If-Match: version (admite comillas, formato ETag). */
export function parseIfMatch(h?: string): number | undefined {
  if (!h) return undefined;
  const n = Number(h.replace(/"/g, '').replace(/^W\//, ''));
  if (!Number.isInteger(n)) throw new AppError('VALIDATION_ERROR', 'If-Match debe ser el numero de version de la cita.');
  return n;
}

@Controller('v1/appointments')
export class AppointmentsController {
  constructor(
    @Inject(AppointmentsService) private readonly svc: AppointmentsService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
  ) {}

  @Get()
  list(@Auth() a: AuthContext, @Query(zod(appointmentsQuery)) q: ReturnType<typeof appointmentsQuery.parse>): Promise<AppointmentDto[]> {
    return this.svc.list(a.tenantId, q);
  }

  @Post()
  create(@Auth() a: AuthContext, @Body(zod(appointmentCreateInput)) body: ReturnType<typeof appointmentCreateInput.parse>, @Headers('idempotency-key') key?: string): Promise<AppointmentDto> {
    return this.svc.createManual(a, body, key);
  }

  @Get('unconfirmed')
  unconfirmed(@Auth() a: AuthContext, @Query(zod(z.object({ from: z.string().datetime(), to: z.string().datetime() }))) q: { from: string; to: string }): Promise<AppointmentDto[]> {
    return this.svc.unconfirmed(a.tenantId, new Date(q.from), new Date(q.to));
  }

  @Get(':id')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.svc.get(a.tenantId, id);
  }

  @Patch(':id')
  patch(@Auth() a: AuthContext, @Param('id') id: string, @Body(zod(appointmentPatchInput)) body: ReturnType<typeof appointmentPatchInput.parse>, @Headers('if-match') ifMatch?: string): Promise<AppointmentDto> {
    return this.svc.patch(a, id, body, parseIfMatch(ifMatch));
  }

  @Post(':id/check-in')
  @HttpCode(200)
  checkIn(@Auth() a: AuthContext, @Param('id') id: string, @Headers('if-match') ifMatch?: string): Promise<AppointmentDto> {
    return this.svc.checkIn(a, id, parseIfMatch(ifMatch));
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Auth() a: AuthContext, @Param('id') id: string, @Body(zod(completeInput)) body: ReturnType<typeof completeInput.parse>, @Headers('if-match') ifMatch?: string): Promise<AppointmentDto> {
    return this.svc.complete(a, id, body, parseIfMatch(ifMatch));
  }

  @Post(':id/no-show')
  @HttpCode(200)
  noShow(@Auth() a: AuthContext, @Param('id') id: string, @Headers('if-match') ifMatch?: string): Promise<AppointmentDto> {
    return this.svc.noShow(a, id, parseIfMatch(ifMatch));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Auth() a: AuthContext, @Param('id') id: string, @Body(zod(cancelAppointmentInput)) body: ReturnType<typeof cancelAppointmentInput.parse>, @Headers('if-match') ifMatch?: string): Promise<AppointmentDto> {
    return this.svc.cancel(a, id, body, parseIfMatch(ifMatch));
  }

  /** Registrar el pago del anticipo (pending -> confirmed). */
  @Post(':id/deposit')
  @HttpCode(200)
  deposit(@Auth() a: AuthContext, @Param('id') id: string, @Body(zod(z.object({ amountCents: z.number().int().min(0).optional() }))) body: { amountCents?: number }): Promise<AppointmentDto> {
    return this.svc.registerDeposit(a, id, body.amountCents);
  }

  @Get(':id/messages')
  messages(@Auth() a: AuthContext, @Param('id') id: string): Promise<MessageDto[]> {
    return this.messaging.byAppointment(a.tenantId, id);
  }
}
