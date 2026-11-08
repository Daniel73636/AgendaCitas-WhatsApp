import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CONFIG, type AppConfig } from './config';
import { AppError } from './errors';

export const RATE_LIMIT = 'rateLimit';
/** Limite por IP y por ruta: `limit` peticiones cada `windowSec` segundos. */
export const RateLimit = (limit: number, windowSec: number) => SetMetadata(RATE_LIMIT, { limit, windowSec });

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    setInterval(() => this.gc(), 60_000).unref();
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.config.rateLimit) return true;
    const meta = this.reflector.getAllAndOverride<{ limit: number; windowSec: number }>(RATE_LIMIT, [ctx.getHandler(), ctx.getClass()]);
    if (!meta) return true;
    const req = ctx.switchToHttp().getRequest();
    const key = `${req.ip}|${req.routeOptions?.url ?? req.url}`;
    const now = Date.now();
    const windowMs = meta.windowSec * 1000;
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= meta.limit) {
      throw new AppError('RATE_LIMITED', 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.');
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  private gc() {
    const now = Date.now();
    for (const [k, v] of this.hits) {
      const fresh = v.filter((t) => now - t < 3_600_000);
      if (fresh.length) this.hits.set(k, fresh);
      else this.hits.delete(k);
    }
  }
}
