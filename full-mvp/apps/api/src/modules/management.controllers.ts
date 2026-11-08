import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Put, Query, Sse, UseGuards } from '@nestjs/common';
import {
  type AuthSession,
  availabilityQuery,
  customerInput,
  customerMergeInput,
  customerPatch,
  loginInput,
  messageReplyInput,
  scheduleInput,
  serviceInput,
  servicePatch,
  simulateInboundInput,
  staffInput,
  staffPatch,
  tenantUpdate,
  timeOffInput,
  tenantSettings,
} from '@agenda/contracts';
import { type DbHandle, and, appointments, count, eq, locations, staffSchedules, services, tenants, users, verifyPassword } from '@agenda/db';
import { z } from 'zod';
import { Auth, type AuthContext, OwnerOnly, Public } from '../common/auth';
import { CONFIG, type AppConfig } from '../common/config';
import { AppError } from '../common/errors';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';
import { signToken } from '../common/tokens';
import { zod } from '../common/zod.pipe';
import { ClockService } from '../core/clock.service';
import { DB_HANDLE } from '../core/db.provider';
import { EventsService } from '../core/events.service';
import { MessagingService } from '../core/messaging.service';
import { TenantContextService } from '../core/tenant-context.service';
import { AppointmentsService } from './appointments/appointments.service';
import { CatalogService } from './catalog/catalog.service';
import { CustomersService } from './customers/customers.service';
import { ReportsService } from './reports/reports.service';
import { StaffService } from './staff/staff.service';
import { RemindersService } from './reminders/reminders.service';
import { JobsService } from './reminders/jobs.service';
import { AvailabilityService } from './availability/availability.service';
import { WaitlistService } from './waitlist/waitlist.service';
import { Observable, map } from 'rxjs';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
  ) {}

  private async session(userId: string, tenantId: string, role: 'owner' | 'staff', name: string, email: string): Promise<AuthSession> {
    const ctx = await this.tenants.byId(tenantId);
    return {
      token: signToken({ sub: userId, tid: tenantId, role }, this.config.authSecret, 12 * 3600),
      user: { id: userId, name, email, role },
      tenant: { id: tenantId, slug: ctx.tenant.slug, name: ctx.tenant.name, timezone: ctx.tz, currency: ctx.tenant.currency },
    };
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60)
  @Post('login')
  @HttpCode(200)
  async login(@Body(zod(loginInput)) body: { email: string; password: string }): Promise<AuthSession> {
    const [u] = await this.handle.db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1);
    if (!u || !verifyPassword(body.password, u.passwordHash)) throw new AppError('UNAUTHORIZED', 'Correo o contrasena incorrectos.');
    return this.session(u.id, u.tenantId, u.role as 'owner' | 'staff', u.name, u.email);
  }

  @Get('me')
  async me(@Auth() a: AuthContext): Promise<AuthSession> {
    const [u] = await this.handle.db.select().from(users).where(eq(users.id, a.userId)).limit(1);
    if (!u) throw new AppError('UNAUTHORIZED', 'Usuario no encontrado.');
    return this.session(u.id, u.tenantId, u.role as 'owner' | 'staff', u.name, u.email);
  }
}

// ---------------------------------------------------------------------------
// Negocio / ajustes / onboarding
// ---------------------------------------------------------------------------
@Controller('v1/tenant')
export class TenantController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async view(tenantId: string) {
    const ctx = await this.tenants.byId(tenantId);
    return {
      id: ctx.tenant.id, slug: ctx.tenant.slug, name: ctx.tenant.name, description: ctx.tenant.description, phone: ctx.tenant.phone,
      currency: ctx.tenant.currency, address: ctx.location.address, timezone: ctx.tz, lat: ctx.location.lat, lng: ctx.location.lng,
      settings: ctx.settings,
      whatsapp: { mode: this.messaging.mode, connected: this.messaging.mode === 'cloud', phoneNumberId: this.config.whatsappPhoneNumberId ?? null },
      otpMode: this.config.otpMode,
      publicUrl: `${this.config.publicWebUrl}/${ctx.tenant.slug}`,
    };
  }

  @Get()
  get(@Auth() a: AuthContext) {
    return this.view(a.tenantId);
  }

  @OwnerOnly()
  @Patch()
  async patch(@Auth() a: AuthContext, @Body(zod(tenantUpdate)) body: ReturnType<typeof tenantUpdate.parse>) {
    const ctx = await this.tenants.byId(a.tenantId);
    const set: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) set.name = body.name;
    if (body.description !== undefined) set.description = body.description;
    if (body.phone !== undefined) set.phone = body.phone;
    if (body.settings) set.settings = tenantSettings.parse({ ...ctx.settings, ...body.settings }) as unknown as Record<string, unknown>;
    await this.handle.db.update(tenants).set(set).where(eq(tenants.id, a.tenantId));
    if (body.address !== undefined || body.timezone !== undefined) {
      await this.handle.db
        .update(locations)
        .set({ ...(body.address !== undefined ? { address: body.address } : {}), ...(body.timezone !== undefined ? { timezone: body.timezone } : {}), updatedAt: new Date() })
        .where(eq(locations.id, ctx.location.id));
    }
    return this.view(a.tenantId);
  }

  /** Lista de pasos de puesta en marcha (OnboardingChecklist). */
  @Get('onboarding')
  async onboarding(@Auth() a: AuthContext) {
    const { db } = this.handle;
    const ctx = await this.tenants.byId(a.tenantId);
    const [[svc], [sched], [apt]] = await Promise.all([
      db.select({ n: count() }).from(services).where(and(eq(services.tenantId, a.tenantId), eq(services.active, true))),
      db.select({ n: count() }).from(staffSchedules).where(eq(staffSchedules.tenantId, a.tenantId)),
      db.select({ n: count() }).from(appointments).where(eq(appointments.tenantId, a.tenantId)),
    ]);
    const steps = [
      { key: 'services', label: 'Crea tus servicios', done: Number(svc?.n) > 0, href: '/servicios' },
      { key: 'schedules', label: 'Define los horarios del equipo', done: Number(sched?.n) > 0, href: '/horarios' },
      { key: 'whatsapp', label: 'Conecta WhatsApp Business', done: this.messaging.mode === 'cloud', href: '/ajustes' },
      { key: 'first', label: 'Agenda tu primera cita', done: Number(apt?.n) > 0, href: '/calendario' },
    ];
    return { steps, complete: steps.every((s) => s.done) || ctx.settings.onboardingDismissed };
  }
}

// ---------------------------------------------------------------------------
// Servicios / equipo / horarios / excepciones
// ---------------------------------------------------------------------------
@Controller('v1/services')
export class ServicesController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
  ) {}
  @Get() list(@Auth() a: AuthContext) { return this.catalog.listServices(a.tenantId); }
  @OwnerOnly() @Post() async create(@Auth() a: AuthContext, @Body(zod(serviceInput)) b: ReturnType<typeof serviceInput.parse>) {
    const ctx = await this.tenants.byId(a.tenantId);
    return this.catalog.createService(a.tenantId, ctx.tenant.currency, b);
  }
  @OwnerOnly() @Patch(':id') patch(@Auth() a: AuthContext, @Param('id') id: string, @Body(zod(servicePatch)) b: ReturnType<typeof servicePatch.parse>) {
    return this.catalog.patchService(a.tenantId, id, b);
  }
  @OwnerOnly() @Delete(':id') @HttpCode(204) async remove(@Auth() a: AuthContext, @Param('id') id: string) { await this.catalog.deleteService(a.tenantId, id); }
}

@Controller('v1/staff')
export class StaffController {
  constructor(
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
  ) {}
  @Get() list(@Auth() a: AuthContext) { return this.staff.list(a.tenantId); }
  @OwnerOnly() @Post() async create(@Auth() a: AuthContext, @Body(zod(staffInput)) b: ReturnType<typeof staffInput.parse>) {
    const ctx = await this.tenants.byId(a.tenantId);
    return this.staff.create(a.tenantId, ctx.location.id, b);
  }
  @OwnerOnly() @Patch(':id') patch(@Auth() a: AuthContext, @Param('id') id: string, @Body(zod(staffPatch)) b: ReturnType<typeof staffPatch.parse>) {
    return this.staff.patch(a.tenantId, id, b);
  }
}

@Controller('v1')
export class ScheduleController {
  constructor(
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
  ) {}
  @Get('schedules') schedules(@Auth() a: AuthContext, @Query('staffId') staffId?: string) { return this.staff.getSchedule(a.tenantId, staffId); }
  @OwnerOnly() @Put('schedules/:staffId') setSchedule(@Auth() a: AuthContext, @Param('staffId') staffId: string, @Body(zod(scheduleInput)) b: ReturnType<typeof scheduleInput.parse>) {
    return this.staff.setSchedule(a.tenantId, staffId, b);
  }
  @Get('time-off') timeOff(@Auth() a: AuthContext, @Query('from') from?: string) { return this.staff.listTimeOff(a.tenantId, from ? new Date(from) : undefined); }
  @OwnerOnly() @Post('time-off') async createOff(@Auth() a: AuthContext, @Body(zod(timeOffInput)) b: ReturnType<typeof timeOffInput.parse>) {
    const ctx = await this.tenants.byId(a.tenantId);
    return this.staff.createTimeOff(a.tenantId, ctx.location.id, b);
  }
  @OwnerOnly() @Delete('time-off/:id') @HttpCode(204) async deleteOff(@Auth() a: AuthContext, @Param('id') id: string) { await this.staff.deleteTimeOff(a.tenantId, id); }
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------
@Controller('v1/customers')
export class CustomersController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(AppointmentsService) private readonly appts: AppointmentsService,
  ) {}
  @Get() list(@Auth() a: AuthContext, @Query('q') q?: string) { return this.customers.list(a.tenantId, q); }
  @Post() create(@Auth() a: AuthContext, @Body(zod(customerInput)) b: ReturnType<typeof customerInput.parse>) { return this.customers.create(a.tenantId, b); }
  @Get(':id') get(@Auth() a: AuthContext, @Param('id') id: string) { return this.customers.get(a.tenantId, id); }
  @Patch(':id') patch(@Auth() a: AuthContext, @Param('id') id: string, @Body(zod(customerPatch)) b: ReturnType<typeof customerPatch.parse>) {
    return this.customers.patch(a.tenantId, id, b as never);
  }
  @Get(':id/timeline') async timeline(@Auth() a: AuthContext, @Param('id') id: string) {
    const [customer, appointmentsList, messages] = await Promise.all([this.customers.get(a.tenantId, id), this.appts.forCustomer(a.tenantId, id), this.customers.messages(a.tenantId, id)]);
    return { customer, appointments: appointmentsList, messages };
  }
  @Post(':id/merge') @HttpCode(200) merge(@Auth() a: AuthContext, @Param('id') id: string, @Body(zod(customerMergeInput)) b: { intoCustomerId: string }) {
    return this.customers.merge(a.tenantId, id, b.intoCustomerId);
  }
}

// ---------------------------------------------------------------------------
// Mensajes (bandeja de WhatsApp)
// ---------------------------------------------------------------------------
@Controller('v1/messages')
export class MessagesController {
  constructor(
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}
  @Get() conversations(@Auth() a: AuthContext) { return this.messaging.conversations(a.tenantId); }
  @Get('thread') thread(@Auth() a: AuthContext, @Query('phone') phone: string) { return this.messaging.thread(a.tenantId, phone.replace(/\s/g, '').replace(/^(?!\+)/, '+')); }
  @Post('reply') @HttpCode(200) async reply(@Auth() a: AuthContext, @Body(zod(messageReplyInput)) b: ReturnType<typeof messageReplyInput.parse>) {
    return this.messaging.sendText({ tenantId: a.tenantId, phone: b.phone, body: b.body, appointmentId: b.appointmentId ?? null });
  }
  /** Solo demo/mock: simula un mensaje entrante del cliente (o un clic de boton). */
  @Post('simulate-inbound') @HttpCode(200) async simulate(@Auth() a: AuthContext, @Body(zod(simulateInboundInput)) b: ReturnType<typeof simulateInboundInput.parse>) {
    if (this.messaging.mode !== 'mock') throw new AppError('FORBIDDEN', 'Solo disponible en modo mock.');
    return this.messaging.recordInbound({ tenantId: a.tenantId, phone: b.phone, body: b.body });
  }
}

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------
const rangeQ = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
@Controller('v1/reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}
  @Get('summary') summary(@Auth() a: AuthContext, @Query(zod(rangeQ)) q: z.infer<typeof rangeQ>) { return this.reports.summary(a.tenantId, q); }
  @Get('no-shows') noShows(@Auth() a: AuthContext, @Query(zod(rangeQ)) q: z.infer<typeof rangeQ>) { return this.reports.noShows(a.tenantId, q); }
  @Get('occupancy') occupancy(@Auth() a: AuthContext, @Query(zod(rangeQ)) q: z.infer<typeof rangeQ>) { return this.reports.occupancy(a.tenantId, q); }
  @Get('revenue') revenue(@Auth() a: AuthContext, @Query(zod(rangeQ)) q: z.infer<typeof rangeQ>) { return this.reports.revenue(a.tenantId, q); }
}

// ---------------------------------------------------------------------------
// Disponibilidad privada (panel)
// ---------------------------------------------------------------------------
@Controller('v1/availability')
export class PrivateAvailabilityController {
  constructor(
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
  ) {}
  @Get() async get(@Auth() a: AuthContext, @Query(zod(availabilityQuery)) q: ReturnType<typeof availabilityQuery.parse>) {
    const ctx = await this.tenants.byId(a.tenantId);
    return this.availability.availability(ctx, {
      serviceIds: q.serviceIds, staffId: q.staffId, from: q.from, to: q.to ?? q.from, ignoreRules: q.ignoreRules ?? true, ...(q.excludeAppointmentId ? { excludeAppointmentId: q.excludeAppointmentId } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// Lista de espera (panel)
// ---------------------------------------------------------------------------
@Controller('v1/waitlist')
export class WaitlistController {
  constructor(@Inject(WaitlistService) private readonly waitlist: WaitlistService) {}
  @Get() list(@Auth() a: AuthContext) { return this.waitlist.list(a.tenantId); }
}

// ---------------------------------------------------------------------------
// SSE: /v1/events
// ---------------------------------------------------------------------------
@Controller('v1')
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}
  /** Auth por cabecera Bearer o ?token= (EventSource no permite cabeceras). Reanuda con Last-Event-ID. */
  @Sse('events')
  stream(@Auth() a: AuthContext, @Headers('last-event-id') lastHeader?: string, @Query('lastEventId') lastQuery?: string): Observable<{ id: string; type: string; data: unknown }> {
    const raw = lastHeader ?? lastQuery;
    const last = raw !== undefined && raw !== '' ? Number(raw) : undefined;
    return this.events.stream(a.tenantId, last).pipe(map((e) => ({ id: e.id, type: e.type, data: e.data })));
  }
}

// ---------------------------------------------------------------------------
// Interno: tick del planificador (lo invoca apps/worker con BullMQ o setInterval)
// ---------------------------------------------------------------------------
@Public()
@Controller('v1/internal')
export class InternalController {
  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(RemindersService) private readonly reminders: RemindersService,
    @Inject(ClockService) private readonly clock: ClockService,
  ) {}
  @Post('jobs/tick') @HttpCode(200) async tick(@Headers('x-internal-secret') secret?: string) {
    if (secret !== this.config.internalSecret) throw new AppError('FORBIDDEN', 'Secreto interno invalido.');
    return this.jobs.tick();
  }
}

@Public()
@Controller('v1')
export class HealthController {
  constructor(@Inject(ClockService) private readonly clock: ClockService) {}
  @Get('health') health() { return { ok: true, service: 'agenda-api', now: this.clock.nowIso() }; }
}
