import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { DbHandle } from '@agenda/db';
import { CONFIG, type AppConfig } from '../common/config';
import { RateLimitGuard } from '../common/rate-limit';
import { ClockService } from './clock.service';
import { DB_HANDLE, createDbHandle } from './db.provider';
import { EventsService } from './events.service';
import { MessagingService } from './messaging.service';
import { TenantContextService } from './tenant-context.service';

class Shutdown implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}
  async onApplicationShutdown() {
    await this.handle.close().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    { provide: DB_HANDLE, useFactory: (c: AppConfig) => createDbHandle(c), inject: [CONFIG] },
    ClockService,
    EventsService,
    MessagingService,
    TenantContextService,
    RateLimitGuard,
    Shutdown,
  ],
  exports: [DB_HANDLE, ClockService, EventsService, MessagingService, TenantContextService, RateLimitGuard],
})
export class CoreModule {}
