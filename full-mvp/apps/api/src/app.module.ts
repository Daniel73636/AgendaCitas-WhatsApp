import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './common/auth';
import { CONFIG, type AppConfig } from './common/config';
import { AllExceptionsFilter } from './common/errors';
import { CoreModule } from './core/core.module';
import { AppointmentsController } from './modules/appointments/appointments.controller';
import { AppointmentsService } from './modules/appointments/appointments.service';
import { BookingCoreService } from './modules/appointments/booking-core.service';
import { AuthService } from './modules/auth/auth.service';
import { AvailabilityService } from './modules/availability/availability.service';
import { CatalogService } from './modules/catalog/catalog.service';
import { CustomersService } from './modules/customers/customers.service';
import {
  AuthController,
  CustomersController,
  EventsController,
  InternalController,
  MessagesController,
  PrivateAvailabilityController,
  ReportsController,
  ScheduleController,
  ServicesController,
  StaffController,
  TenantController,
  WaitlistController,
} from './modules/management.controllers';
import { HealthController } from './modules/health.controller';
import { OtpService } from './modules/otp/otp.service';
import { PublicController } from './modules/public/public.controller';
import { JobsService } from './modules/reminders/jobs.service';
import { RemindersService } from './modules/reminders/reminders.service';
import { ReportsService } from './modules/reports/reports.service';
import { StaffService } from './modules/staff/staff.service';
import { WaitlistService } from './modules/waitlist/waitlist.service';
import { WebhooksController } from './modules/webhooks.controller';

/**
 * Modulo de reservas: estructura modular espejo de la arquitectura
 * (tenants, catalog, staff, availability, appointments, customers, reminders, messaging, reports, public).
 */
@Module({
  controllers: [
    PublicController,
    AuthController,
    TenantController,
    ServicesController,
    StaffController,
    ScheduleController,
    AppointmentsController,
    PrivateAvailabilityController,
    CustomersController,
    MessagesController,
    ReportsController,
    WaitlistController,
    EventsController,
    WebhooksController,
    InternalController,
    HealthController,
  ],
  providers: [
    AuthService,
    BookingCoreService,
    AvailabilityService,
    CatalogService,
    StaffService,
    OtpService,
    RemindersService,
    WaitlistService,
    AppointmentsService,
    CustomersService,
    ReportsService,
    JobsService,
  ],
})
class DomainModule {}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule, DomainModule],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [CONFIG],
      global: true,
    };
  }
}
