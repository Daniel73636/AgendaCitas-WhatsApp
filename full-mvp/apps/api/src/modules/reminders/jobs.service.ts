import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../../common/config';
import { AppointmentsService } from '../appointments/appointments.service';
import { RemindersService, type TickResult } from './reminders.service';

export interface JobsTick {
  reminders: TickResult;
  holdsReleased: number;
}

/**
 * Planificador. En desarrollo corre embebido en la API (EMBEDDED_WORKER=true).
 * En produccion, apps/worker (BullMQ + Redis) invoca POST /v1/internal/jobs/tick.
 * Cada tick: envia recordatorios vencidos (red de seguridad incluida), libera holds y reofrece huecos.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(RemindersService) private readonly reminders: RemindersService,
    @Inject(AppointmentsService) private readonly appts: AppointmentsService,
  ) {}

  onModuleInit() {
    if (!this.config.embeddedWorker) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(e)), this.config.tickMs);
    this.timer.unref();
    this.log.log(`Planificador embebido activo (cada ${Math.round(this.config.tickMs / 1000)} s).`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<JobsTick> {
    if (this.running) return { reminders: { processed: 0, sent: 0, skipped: 0, failed: 0 }, holdsReleased: 0 };
    this.running = true;
    try {
      const holdsReleased = await this.appts.sweepHolds();
      const reminders: TickResult = { processed: 0, sent: 0, skipped: 0, failed: 0 };
      for (let batch = 0; batch < 20; batch++) {
        const r = await this.reminders.processDue(100);
        reminders.processed += r.processed;
        reminders.sent += r.sent;
        reminders.skipped += r.skipped;
        reminders.failed += r.failed;
        if (r.processed < 100) break;
      }
      return { reminders, holdsReleased };
    } finally {
      this.running = false;
    }
  }
}
