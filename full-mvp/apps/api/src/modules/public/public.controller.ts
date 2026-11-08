import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  type AvailabilityResponse,
  type HoldDto,
  type OtpRequestResult,
  type OtpVerifyResult,
  type PublicAppointmentDto,
  type PublicBusiness,
  availabilityQuery,
  bookingInput,
  cancelInput,
  holdInput,
  otpRequestInput,
  otpVerifyInput,
  rescheduleInput,
  waitlistInput,
} from '@agenda/contracts';
import { Public } from '../../common/auth';
import { CONFIG, type AppConfig } from '../../common/config';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit';
import { zod } from '../../common/zod.pipe';
import { TenantContextService } from '../../core/tenant-context.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AvailabilityService } from '../availability/availability.service';
import { CatalogService } from '../catalog/catalog.service';
import { OtpService } from '../otp/otp.service';
import { WaitlistService } from '../waitlist/waitlist.service';

/** Endpoints SIN sesion para la pagina de reservas (con limite de tasa y campo trampa anti-bots). */
@Public()
@UseGuards(RateLimitGuard)
@Controller('v1/public')
export class PublicController {
  constructor(
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(AppointmentsService) private readonly appts: AppointmentsService,
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(WaitlistService) private readonly waitlist: WaitlistService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ---- Enlace firmado de la cita (rutas estaticas primero) ----
  @Get('appointments/:token')
  @RateLimit(60, 60)
  getAppointment(@Param('token') token: string): Promise<PublicAppointmentDto> {
    return this.appts.publicGet(token);
  }

  @Post('appointments/:token/reschedule')
  @RateLimit(20, 60)
  reschedule(@Param('token') token: string, @Body(zod(rescheduleInput)) body: { startsAt: string; staffId: string | 'any' }): Promise<PublicAppointmentDto> {
    return this.appts.publicReschedule(token, body);
  }

  @Post('appointments/:token/cancel')
  @RateLimit(20, 60)
  cancel(@Param('token') token: string, @Body(zod(cancelInput)) body: { reason?: string }): Promise<PublicAppointmentDto> {
    return this.appts.publicCancel(token, body.reason);
  }

  @Post('appointments/:token/accept')
  @RateLimit(20, 60)
  accept(@Param('token') token: string): Promise<PublicAppointmentDto> {
    return this.appts.publicAccept(token);
  }

  /** Pasarela de pago simulada para el anticipo. */
  @Post('appointments/:token/pay')
  @RateLimit(20, 60)
  pay(@Param('token') token: string): Promise<PublicAppointmentDto> {
    return this.appts.publicPay(token);
  }

  // ---- Negocio ----
  @Get(':slug')
  @RateLimit(120, 60)
  async business(@Param('slug') slug: string): Promise<PublicBusiness> {
    const ctx = await this.tenants.bySlug(slug);
    const [services, staff] = await Promise.all([this.catalog.listServices(ctx.tenant.id, { publicOnly: true }), this.catalog.listStaff(ctx.tenant.id, { publicOnly: true })]);
    const publicIds = new Set(services.map((s) => s.id));
    return {
      tenant: {
        slug: ctx.tenant.slug, name: ctx.tenant.name, description: ctx.tenant.description, phone: ctx.tenant.phone, address: ctx.location.address,
        lat: ctx.location.lat, lng: ctx.location.lng, timezone: ctx.tz, currency: ctx.tenant.currency, logoUrl: ctx.tenant.logoUrl, coverUrl: ctx.tenant.coverUrl,
      },
      services,
      staff: staff.map((s) => ({ ...s, serviceIds: s.serviceIds.filter((id) => publicIds.has(id)), serviceOverrides: s.serviceOverrides.filter((o) => publicIds.has(o.serviceId)) })).filter((s) => s.serviceIds.length > 0),
      settings: {
        holdMinutes: ctx.settings.holdMinutes, cancelMinHours: ctx.settings.cancelMinHours,
        rescheduleMinHours: ctx.settings.rescheduleMinHours, maxAdvanceDays: ctx.settings.maxAdvanceDays,
      },
      otpMode: this.config.otpMode,
    };
  }

  @Get(':slug/availability')
  @RateLimit(120, 60)
  async availabilityFor(@Param('slug') slug: string, @Query(zod(availabilityQuery)) q: ReturnType<typeof availabilityQuery.parse>): Promise<AvailabilityResponse> {
    const ctx = await this.tenants.bySlug(slug);
    return this.availability.availability(ctx, {
      serviceIds: q.serviceIds, staffId: q.staffId, from: q.from, to: q.to ?? q.from, publicOnly: true,
    });
  }

  @Post(':slug/holds')
  @RateLimit(30, 60)
  hold(@Param('slug') slug: string, @Body(zod(holdInput)) body: ReturnType<typeof holdInput.parse>, @Headers('idempotency-key') key?: string): Promise<HoldDto> {
    // Un doble clic con la misma clave devuelve el mismo hold
    return this.tenants.bySlug(slug).then((ctx) => this.appts.idempotent(ctx.tenant.id, 'hold', key, () => this.appts.createHold(slug, body)));
  }

  @Delete(':slug/holds/:holdId')
  @RateLimit(30, 60)
  releaseHold(@Param('slug') slug: string, @Param('holdId') holdId: string) {
    return this.appts.releaseHold(slug, holdId);
  }

  @Post(':slug/otp/request')
  @RateLimit(6, 600)
  async otpRequest(@Param('slug') slug: string, @Body(zod(otpRequestInput)) body: { phone: string }): Promise<OtpRequestResult> {
    const ctx = await this.tenants.bySlug(slug);
    return this.otp.request(ctx.tenant.id, body.phone);
  }

  @Post(':slug/otp/verify')
  @RateLimit(20, 600)
  async otpVerify(@Param('slug') slug: string, @Body(zod(otpVerifyInput)) body: { phone: string; code: string }): Promise<OtpVerifyResult> {
    const ctx = await this.tenants.bySlug(slug);
    return this.otp.verify(ctx.tenant.id, body.phone, body.code);
  }

  @Post(':slug/bookings')
  @RateLimit(20, 60)
  book(@Param('slug') slug: string, @Body(zod(bookingInput)) body: ReturnType<typeof bookingInput.parse>, @Headers('idempotency-key') key?: string): Promise<PublicAppointmentDto> {
    return this.appts.confirmBooking(slug, body, key);
  }

  @Post(':slug/waitlist')
  @RateLimit(10, 600)
  async join(@Param('slug') slug: string, @Body(zod(waitlistInput)) body: ReturnType<typeof waitlistInput.parse>) {
    const ctx = await this.tenants.bySlug(slug);
    const entry = await this.waitlist.join(ctx, body);
    return { id: entry.id, status: entry.status };
  }
}
