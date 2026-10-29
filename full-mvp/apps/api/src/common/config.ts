import { loadRootEnv } from '@agenda/db';

export const CONFIG = Symbol('CONFIG');

export interface AppConfig {
  port: number;
  host: string;
  authSecret: string;
  fieldKey: string;
  corsOrigins: string[];
  embeddedWorker: boolean;
  /** Intervalo del planificador embebido (ms). */
  tickMs: number;
  internalSecret: string;
  databaseUrl: string | undefined;
  pgliteDir: string | undefined;
  autoSeed: boolean;
  otpMode: 'mock' | 'real';
  otpMockCode: string;
  whatsappMode: string;
  whatsappPhoneNumberId: string | undefined;
  whatsappAccessToken: string | undefined;
  whatsappVerifyToken: string;
  publicWebUrl: string;
  rateLimit: boolean;
  logger: boolean;
}

const bool = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadRootEnv();
  const e = process.env;
  const cfg: AppConfig = {
    port: Number(e.API_PORT ?? e.PORT ?? 4100),
    host: e.API_HOST ?? '0.0.0.0',
    authSecret: e.AUTH_SECRET || 'dev-secret-cambia-esto-en-produccion-32chars',
    fieldKey: e.FIELD_ENCRYPTION_KEY || 'dev-field-key-cambia-esto-en-produccion',
    corsOrigins: (e.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    embeddedWorker: bool(e.EMBEDDED_WORKER, true),
    tickMs: Number(e.JOBS_TICK_MS ?? 10_000),
    internalSecret: e.INTERNAL_JOBS_SECRET || 'dev-internal-secret',
    databaseUrl: e.DATABASE_URL || undefined,
    pgliteDir: e.PGLITE_DIR || undefined,
    autoSeed: bool(e.AUTO_SEED, true),
    otpMode: e.OTP_MODE === 'real' ? 'real' : 'mock',
    otpMockCode: e.OTP_MOCK_CODE || '123456',
    whatsappMode: e.WHATSAPP_MODE || 'mock',
    whatsappPhoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID || undefined,
    whatsappAccessToken: e.WHATSAPP_ACCESS_TOKEN || undefined,
    whatsappVerifyToken: e.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'agenda-verify-token',
    publicWebUrl: (e.PUBLIC_WEB_URL || 'http://localhost:3100').replace(/\/$/, ''),
    rateLimit: bool(e.RATE_LIMIT, true),
    logger: bool(e.API_LOGGER, true),
    ...overrides,
  };
  return cfg;
}
