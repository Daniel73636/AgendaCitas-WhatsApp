import { Inject, Injectable } from '@nestjs/common';
import type { OtpRequestResult, OtpVerifyResult } from '@agenda/contracts';
import { type DbHandle, and, desc, eq, gte, hmacHex, isNull, otpCodes, sql, uuidv7 } from '@agenda/db';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { CONFIG, type AppConfig, isMockOtp } from '../../common/config';
import { AppError } from '../../common/errors';
import { signToken, verifyToken } from '../../common/tokens';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { MessagingService } from '../../core/messaging.service';

const OTP_TTL_SEC = 600;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 6;
/** Tras agotar los intentos de un codigo, el celular queda bloqueado este tiempo. */
const LOCK_MINUTES = 15;

const sameHex = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Verificacion de celular.
 * - Con DEMO_MODE=true y OTP_MODE=mock el codigo es OTP_MOCK_CODE (123456). En cualquier otro caso es aleatorio y se envia por WhatsApp.
 * - Los codigos se guardan con HMAC (nunca en claro), vencen en 10 min y se bloquean tras 5 intentos fallidos.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
  ) {}

  private digest(tenantId: string, phone: string, code: string): string {
    return hmacHex(`otp|${tenantId}|${phone}|${code}`, this.config.authSecret);
  }

  async request(tenantId: string, phone: string): Promise<OtpRequestResult> {
    const { db } = this.handle;
    const now = this.clock.now();
    const recent = await db
      .select({ id: otpCodes.id, attempts: otpCodes.attempts, createdAt: otpCodes.createdAt })
      .from(otpCodes)
      .where(and(eq(otpCodes.tenantId, tenantId), eq(otpCodes.phoneE164, phone), gte(otpCodes.createdAt, new Date(now.getTime() - 3_600_000))));
    if (recent.length >= MAX_CODES_PER_HOUR) throw new AppError('RATE_LIMITED', 'Solicitaste demasiados códigos. Intenta de nuevo en una hora.');
    const lockSince = now.getTime() - LOCK_MINUTES * 60_000;
    if (recent.some((r) => r.attempts >= MAX_ATTEMPTS && r.createdAt.getTime() >= lockSince)) {
      throw new AppError('ACCOUNT_LOCKED', `Bloqueamos temporalmente la verificación de este número por intentos fallidos. Intenta de nuevo en ${LOCK_MINUTES} minutos.`, { retryAfterSec: LOCK_MINUTES * 60 });
    }
    const mock = isMockOtp(this.config);
    const code = mock ? this.config.otpMockCode : String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.insert(otpCodes).values({
      id: uuidv7(), tenantId, phoneE164: phone, code: this.digest(tenantId, phone, code), expiresAt: new Date(now.getTime() + OTP_TTL_SEC * 1000), createdAt: now,
    });
    const sent = await this.messaging.sendTemplate({ tenantId, phone, template: 'otp_code', params: { code } });
    return {
      sent: sent.ok,
      mock,
      ...(mock ? { hint: `Modo demostración: usa el código ${code}` } : {}),
      expiresInSec: OTP_TTL_SEC,
    };
  }

  async verify(tenantId: string, phone: string, code: string): Promise<OtpVerifyResult> {
    const { db } = this.handle;
    const now = this.clock.now();
    const mock = isMockOtp(this.config);
    const [row] = await db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.tenantId, tenantId), eq(otpCodes.phoneE164, phone), isNull(otpCodes.verifiedAt), gte(otpCodes.expiresAt, now)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    const matchesMock = mock && code === this.config.otpMockCode;
    if (!row && !matchesMock) throw new AppError('OTP_INVALID', 'El código expiró o no se ha solicitado. Pide uno nuevo.');
    if (row && row.attempts >= MAX_ATTEMPTS && !matchesMock) throw new AppError('OTP_INVALID', 'Demasiados intentos. Espera unos minutos y pide un código nuevo.');
    if (!matchesMock && row && !sameHex(row.code, this.digest(tenantId, phone, code))) {
      await db.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` }).where(eq(otpCodes.id, row.id));
      throw new AppError('OTP_INVALID', 'Código incorrecto.');
    }
    if (row) await db.update(otpCodes).set({ verifiedAt: now }).where(eq(otpCodes.id, row.id));
    const otpToken = signToken({ typ: 'otp', phone, tid: tenantId }, this.config.authSecret, 900, now.getTime());
    return { verified: true, otpToken };
  }

  /** Exige un token OTP valido (o un codigo valido) para el celular indicado. */
  async assertVerified(tenantId: string, phone: string, a: { otpToken?: string | undefined; otpCode?: string | undefined }): Promise<void> {
    if (a.otpToken) {
      const p = verifyToken<{ typ: string; phone: string; tid: string }>(a.otpToken, this.config.authSecret, this.clock.now().getTime());
      if (p && p.typ === 'otp' && p.phone === phone && p.tid === tenantId) return;
      throw new AppError('OTP_INVALID', 'La verificación del celular expiró o no corresponde a este número.');
    }
    if (a.otpCode) {
      await this.verify(tenantId, phone, a.otpCode);
      return;
    }
    throw new AppError('OTP_REQUIRED', 'Verifica tu celular con el código que te enviamos.');
  }
}
