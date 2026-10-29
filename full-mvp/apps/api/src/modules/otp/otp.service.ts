import { Inject, Injectable } from '@nestjs/common';
import type { OtpRequestResult, OtpVerifyResult } from '@agenda/contracts';
import { type DbHandle, and, desc, eq, gte, isNull, otpCodes, uuidv7 } from '@agenda/db';
import { randomInt } from 'node:crypto';
import { CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { signToken, verifyToken } from '../../common/tokens';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { MessagingService } from '../../core/messaging.service';

const OTP_TTL_SEC = 600;
const MAX_ATTEMPTS = 5;

/** Verificacion de celular. En modo mock el codigo es siempre OTP_MOCK_CODE (123456). */
@Injectable()
export class OtpService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
  ) {}

  async request(tenantId: string, phone: string): Promise<OtpRequestResult> {
    const { db } = this.handle;
    const now = this.clock.now();
    const recent = await db
      .select({ id: otpCodes.id })
      .from(otpCodes)
      .where(and(eq(otpCodes.tenantId, tenantId), eq(otpCodes.phoneE164, phone), gte(otpCodes.createdAt, new Date(now.getTime() - 3_600_000))));
    if (recent.length >= 6) throw new AppError('RATE_LIMITED', 'Solicitaste demasiados codigos. Intenta en una hora.');
    const mock = this.config.otpMode === 'mock';
    const code = mock ? this.config.otpMockCode : String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.insert(otpCodes).values({
      id: uuidv7(), tenantId, phoneE164: phone, code, expiresAt: new Date(now.getTime() + OTP_TTL_SEC * 1000), createdAt: now,
    });
    const sent = await this.messaging.sendTemplate({ tenantId, phone, template: 'otp_code', params: { code } });
    return {
      sent: sent.ok,
      mock,
      ...(mock ? { hint: `Modo demostracion: usa el codigo ${code}` } : {}),
      expiresInSec: OTP_TTL_SEC,
    };
  }

  async verify(tenantId: string, phone: string, code: string): Promise<OtpVerifyResult> {
    const { db } = this.handle;
    const now = this.clock.now();
    const mock = this.config.otpMode === 'mock';
    const [row] = await db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.tenantId, tenantId), eq(otpCodes.phoneE164, phone), isNull(otpCodes.verifiedAt), gte(otpCodes.expiresAt, now)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    const matchesMock = mock && code === this.config.otpMockCode;
    if (!row && !matchesMock) throw new AppError('OTP_INVALID', 'El codigo expiro o no se ha solicitado. Pide uno nuevo.');
    if (row && row.attempts >= MAX_ATTEMPTS && !matchesMock) throw new AppError('OTP_INVALID', 'Demasiados intentos. Pide un codigo nuevo.');
    if (!matchesMock && row && row.code !== code) {
      await db.update(otpCodes).set({ attempts: row.attempts + 1 }).where(eq(otpCodes.id, row.id));
      throw new AppError('OTP_INVALID', 'Codigo incorrecto.');
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
      throw new AppError('OTP_INVALID', 'La verificacion del celular expiro o no corresponde a este numero.');
    }
    if (a.otpCode) {
      await this.verify(tenantId, phone, a.otpCode);
      return;
    }
    throw new AppError('OTP_REQUIRED', 'Verifica tu celular con el codigo que te enviamos.');
  }
}
