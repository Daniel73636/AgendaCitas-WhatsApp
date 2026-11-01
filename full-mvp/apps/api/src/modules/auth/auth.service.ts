import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthSession } from '@agenda/contracts';
import { type DbHandle, and, dummyPasswordHash, eq, hashPassword, isNotNull, loginAttempts, lt, needsRehash, sql, users, verifyPassword } from '@agenda/db';
import { CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { signToken } from '../../common/tokens';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { TenantContextService } from '../../core/tenant-context.service';

const SESSION_TTL_SEC = 12 * 3600;

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(TenantContextService) private readonly tenants: TenantContextService,
  ) {}

  async session(userId: string, tenantId: string, role: 'owner' | 'staff', name: string, email: string): Promise<AuthSession> {
    const ctx = await this.tenants.byId(tenantId);
    return {
      token: signToken({ sub: userId, tid: tenantId, role }, this.config.authSecret, SESSION_TTL_SEC, this.clock.now().getTime()),
      user: { id: userId, name, email, role },
      tenant: { id: tenantId, slug: ctx.tenant.slug, name: ctx.tenant.name, timezone: ctx.tz, currency: ctx.tenant.currency },
    };
  }

  private lockedError(until: Date): AppError {
    const retryAfterSec = Math.max(1, Math.ceil((until.getTime() - this.clock.now().getTime()) / 1000));
    const minutes = Math.ceil(retryAfterSec / 60);
    return new AppError('ACCOUNT_LOCKED', `Por seguridad bloqueamos temporalmente los intentos de ingreso. Intenta de nuevo en ${minutes} minuto${minutes === 1 ? '' : 's'}.`, { retryAfterSec });
  }

  /**
   * Login con bloqueo por correo tras N fallos. El conteo aplica tambien a correos que no existen
   * y la respuesta es identica: no se puede averiguar si una cuenta existe.
   */
  async login(rawEmail: string, password: string): Promise<AuthSession> {
    const { db } = this.handle;
    const email = rawEmail.trim().toLowerCase();
    const now = this.clock.now();

    const [att] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email)).limit(1);
    if (att?.lockedUntil && att.lockedUntil > now) throw this.lockedError(att.lockedUntil);

    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Siempre se ejecuta una comparacion bcrypt (con hash de relleno si no existe) para igualar tiempos
    const passwordOk = await verifyPassword(password, u?.passwordHash ?? dummyPasswordHash());

    if (!u || !passwordOk) {
      const lockedUntil = new Date(now.getTime() + this.config.loginLockMinutes * 60_000);
      const expired = sql`${loginAttempts.lockedUntil} IS NOT NULL AND ${loginAttempts.lockedUntil} <= ${now}`;
      const [row] = await db
        .insert(loginAttempts)
        .values({ email, failedCount: 1, lastAttemptAt: now })
        .onConflictDoUpdate({
          target: loginAttempts.email,
          set: {
            failedCount: sql`CASE WHEN ${expired} THEN 1 ELSE ${loginAttempts.failedCount} + 1 END`,
            lockedUntil: sql`CASE WHEN ${expired} THEN NULL ELSE ${loginAttempts.lockedUntil} END`,
            lastAttemptAt: now,
          },
        })
        .returning();
      if (row && row.failedCount >= this.config.loginMaxAttempts && !row.lockedUntil) {
        await db.update(loginAttempts).set({ lockedUntil }).where(eq(loginAttempts.email, email));
        this.log.warn(`Cuenta bloqueada por intentos fallidos (${row.failedCount}) hasta ${lockedUntil.toISOString()}`);
        throw this.lockedError(lockedUntil);
      }
      throw new AppError('UNAUTHORIZED', 'Correo o contraseña incorrectos.');
    }

    if (att) await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
    if (needsRehash(u.passwordHash)) {
      // Migracion transparente scrypt -> bcrypt (o aumento de costo)
      await db.update(users).set({ passwordHash: hashPassword(password), updatedAt: now }).where(and(eq(users.id, u.id), eq(users.tenantId, u.tenantId)));
    }
    return this.session(u.id, u.tenantId, u.role as 'owner' | 'staff', u.name, u.email);
  }

  /** Limpieza periodica: borra contadores antiguos sin bloqueo vigente. */
  async purgeAttempts(): Promise<void> {
    const cutoff = new Date(this.clock.now().getTime() - 24 * 3_600_000);
    await this.handle.db.delete(loginAttempts).where(and(lt(loginAttempts.lastAttemptAt, cutoff), isNotNull(loginAttempts.email)));
  }
}
