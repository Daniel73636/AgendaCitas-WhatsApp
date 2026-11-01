import { Controller, Get, Inject, Res } from '@nestjs/common';
import { type DbHandle, sql } from '@agenda/db';
import { Public } from '../common/auth';
import { CONFIG, type AppConfig } from '../common/config';
import { ClockService } from '../core/clock.service';
import { DB_HANDLE } from '../core/db.provider';

const READY_TIMEOUT_MS = 2_000;

/** Liveness (`/health`) y readiness (`/ready`). Sin autenticacion ni datos sensibles. */
@Public()
@Controller()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** El proceso esta vivo (no toca la base de datos). */
  @Get(['health', 'v1/health'])
  health() {
    return { ok: true, status: 'ok', service: 'agenda-api', now: this.clock.nowIso(), uptimeSec: Math.round((Date.now() - this.startedAt) / 1000) };
  }

  /** Listo para recibir trafico: la base de datos responde. 503 si no. */
  @Get(['ready', 'v1/ready'])
  async ready(@Res({ passthrough: true }) res: { status: (n: number) => unknown }) {
    const checks: Record<string, 'ok' | 'fail'> = { database: 'fail' };
    try {
      await Promise.race([
        this.handle.db.execute(sql`select 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), READY_TIMEOUT_MS).unref()),
      ]);
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    if (!ok) res.status(503);
    return { ok, status: ok ? 'ready' : 'not_ready', checks, mode: this.config.demoMode ? 'demo' : this.config.nodeEnv };
  }
}
