import { loadRootEnv } from '@agenda/db';
import { z } from 'zod';

export const CONFIG = Symbol('CONFIG');

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  /** Habilita todo lo "de demostracion": OTP 123456, semilla, cuenta demo, pago simulado, simuladores de WhatsApp. */
  demoMode: boolean;
  port: number;
  host: string;
  authSecret: string;
  fieldKey: string;
  corsOrigins: string[];
  /** Confiar en X-Forwarded-For (solo detras de un proxy/balanceador propio). */
  trustProxy: boolean;
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
  /** App Secret de Meta: firma del webhook (X-Hub-Signature-256). */
  whatsappAppSecret: string | undefined;
  whatsappApiVersion: string;
  whatsappLanguage: string;
  publicWebUrl: string;
  rateLimit: boolean;
  logger: boolean;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  /** Exigir aceptacion de la politica de privacidad (Ley 1581) al reservar. */
  privacyConsentRequired: boolean;
  /** Avisos de arranque (secretos por defecto en desarrollo, etc.). */
  warnings: string[];
}

export const DEFAULT_AUTH_SECRET = 'dev-secret-cambia-esto-en-produccion-32chars';
export const DEFAULT_FIELD_KEY = 'dev-field-key-cambia-esto-en-produccion';
export const DEFAULT_INTERNAL_SECRET = 'dev-internal-secret';
export const DEFAULT_VERIFY_TOKEN = 'agenda-verify-token';

const flag = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return def;
      const s = v.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on', 'si'].includes(s)) return true;
      if (['0', 'false', 'no', 'off'].includes(s)) return false;
      ctx.addIssue({ code: 'custom', message: 'debe ser true o false' });
      return z.NEVER;
    });
const num = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : Number(v)))
    .pipe(z.number({ invalid_type_error: 'debe ser un numero' }).int('debe ser entero').min(min, `minimo ${min}`).max(max, `maximo ${max}`));
const text = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

/** Esquema de las variables de entorno. Los errores se reportan todos juntos y en espanol. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('development'),
  DEMO_MODE: flag(false),
  API_PORT: num(4100, 0, 65535),
  PORT: text,
  API_HOST: text,
  AUTH_SECRET: text,
  FIELD_ENCRYPTION_KEY: text,
  CORS_ORIGINS: text,
  TRUST_PROXY: flag(false),
  EMBEDDED_WORKER: flag(true),
  JOBS_TICK_MS: num(10_000, 100, 3_600_000),
  INTERNAL_JOBS_SECRET: text,
  DATABASE_URL: text,
  PGLITE_DIR: text,
  AUTO_SEED: z.string().optional(),
  OTP_MODE: z.enum(['mock', 'real']).optional().default('mock'),
  OTP_MOCK_CODE: z.string().regex(/^\d{4,8}$/, 'debe tener entre 4 y 8 digitos').optional().default('123456'),
  WHATSAPP_MODE: z.enum(['mock', 'cloud']).optional().default('mock'),
  WHATSAPP_PHONE_NUMBER_ID: text,
  WHATSAPP_ACCESS_TOKEN: text,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: text,
  WHATSAPP_APP_SECRET: text,
  WHATSAPP_API_VERSION: text,
  WHATSAPP_LANGUAGE: text,
  PUBLIC_WEB_URL: text,
  RATE_LIMIT: flag(true),
  API_LOGGER: flag(true),
  LOGIN_MAX_ATTEMPTS: num(5, 1, 100),
  LOGIN_LOCK_MINUTES: num(15, 1, 1440),
  PRIVACY_CONSENT_REQUIRED: flag(true),
});

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuracion invalida:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

/** Valida las variables de entorno y construye la configuracion (lanza ConfigError con todos los problemas). */
export function parseConfig(env: Record<string, string | undefined>, overrides: Partial<AppConfig> = {}): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'entorno'}: ${i.message}`));
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const problems: string[] = [];
  const warnings: string[] = [];

  const secret = (name: string, value: string | undefined, def: string, minLen: number): string => {
    if (!value) {
      if (isProduction) problems.push(`${name}: es obligatorio en produccion (minimo ${minLen} caracteres aleatorios).`);
      else warnings.push(`${name} no definido: se usa un valor de desarrollo. NO lo uses en produccion.`);
      return def;
    }
    if (isProduction && (value === def || value.length < minLen)) {
      problems.push(`${name}: en produccion debe ser unico, distinto al valor de ejemplo y de al menos ${minLen} caracteres.`);
    }
    return value;
  };

  const authSecret = secret('AUTH_SECRET', e.AUTH_SECRET, DEFAULT_AUTH_SECRET, 32);
  const fieldKey = secret('FIELD_ENCRYPTION_KEY', e.FIELD_ENCRYPTION_KEY, DEFAULT_FIELD_KEY, 32);
  const internalSecret = secret('INTERNAL_JOBS_SECRET', e.INTERNAL_JOBS_SECRET, DEFAULT_INTERNAL_SECRET, 16);
  const whatsappVerifyToken = secret('WHATSAPP_WEBHOOK_VERIFY_TOKEN', e.WHATSAPP_WEBHOOK_VERIFY_TOKEN, DEFAULT_VERIFY_TOKEN, 12);

  const corsOrigins = (e.CORS_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  for (const o of corsOrigins) {
    try {
      const u = new URL(o);
      if (!/^https?:$/.test(u.protocol)) throw new Error('protocolo');
    } catch {
      problems.push(`CORS_ORIGINS: "${o}" no es un origen valido (ej: https://reservas.tudominio.com).`);
    }
  }
  if (isProduction) {
    if (corsOrigins.length === 0) problems.push('CORS_ORIGINS: es obligatorio en produccion (lista de origenes separados por coma).');
    if (corsOrigins.includes('*')) problems.push('CORS_ORIGINS: "*" no esta permitido.');
    if (!e.DATABASE_URL) problems.push('DATABASE_URL: es obligatorio en produccion (PostgreSQL).');
    if (e.DEMO_MODE) problems.push('DEMO_MODE: no puede estar activo en produccion (expone OTP y cuentas de demostracion).');
    if (e.OTP_MODE === 'mock' && !e.DEMO_MODE) warnings.push('OTP_MODE=mock sin DEMO_MODE: los codigos seran reales y se enviaran por WhatsApp.');
    if (!e.PUBLIC_WEB_URL) problems.push('PUBLIC_WEB_URL: es obligatorio en produccion (se usa en los enlaces de WhatsApp).');
    if (e.PGLITE_DIR && !e.DATABASE_URL) problems.push('PGLITE_DIR no es apto para produccion; usa DATABASE_URL.');
  } else if (corsOrigins.length === 0) {
    warnings.push('CORS_ORIGINS vacio: en desarrollo se acepta cualquier origen.');
  }

  if (e.WHATSAPP_MODE === 'cloud') {
    if (!e.WHATSAPP_PHONE_NUMBER_ID) problems.push('WHATSAPP_PHONE_NUMBER_ID: obligatorio con WHATSAPP_MODE=cloud.');
    if (!e.WHATSAPP_ACCESS_TOKEN) problems.push('WHATSAPP_ACCESS_TOKEN: obligatorio con WHATSAPP_MODE=cloud.');
    if (!e.WHATSAPP_APP_SECRET) problems.push('WHATSAPP_APP_SECRET: obligatorio con WHATSAPP_MODE=cloud (firma del webhook).');
  }

  if (problems.length) throw new ConfigError(problems);

  const demoMode = e.DEMO_MODE;
  // Semilla demo: solo con DEMO_MODE (o AUTO_SEED=true explicito fuera de produccion)
  const autoSeedRaw = e.AUTO_SEED?.trim().toLowerCase();
  const autoSeedExplicit = autoSeedRaw === undefined || autoSeedRaw === '' ? undefined : ['1', 'true', 'yes', 'on'].includes(autoSeedRaw);
  const autoSeed = isProduction ? false : (autoSeedExplicit ?? demoMode);

  const cfg: AppConfig = {
    nodeEnv: e.NODE_ENV,
    isProduction,
    demoMode,
    port: e.PORT ? Number(e.PORT) : e.API_PORT,
    host: e.API_HOST ?? '0.0.0.0',
    authSecret,
    fieldKey,
    corsOrigins,
    trustProxy: e.TRUST_PROXY,
    embeddedWorker: e.EMBEDDED_WORKER,
    tickMs: e.JOBS_TICK_MS,
    internalSecret,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    autoSeed,
    otpMode: e.OTP_MODE,
    otpMockCode: e.OTP_MOCK_CODE,
    whatsappMode: e.WHATSAPP_MODE,
    whatsappPhoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
    whatsappAccessToken: e.WHATSAPP_ACCESS_TOKEN,
    whatsappVerifyToken,
    whatsappAppSecret: e.WHATSAPP_APP_SECRET,
    whatsappApiVersion: e.WHATSAPP_API_VERSION ?? 'v21.0',
    whatsappLanguage: e.WHATSAPP_LANGUAGE ?? 'es',
    publicWebUrl: (e.PUBLIC_WEB_URL ?? 'http://localhost:3100').replace(/\/$/, ''),
    rateLimit: e.RATE_LIMIT,
    logger: e.API_LOGGER,
    loginMaxAttempts: e.LOGIN_MAX_ATTEMPTS,
    loginLockMinutes: e.LOGIN_LOCK_MINUTES,
    privacyConsentRequired: e.PRIVACY_CONSENT_REQUIRED,
    warnings,
    ...overrides,
  };
  return cfg;
}

/** Carga `.env` de la raiz del monorepo y valida `process.env`. */
export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadRootEnv();
  return parseConfig(process.env, overrides);
}

/** El codigo OTP de demostracion (123456) solo es valido con DEMO_MODE=true y OTP_MODE=mock. */
export const isMockOtp = (c: Pick<AppConfig, 'demoMode' | 'otpMode'>): boolean => c.demoMode && c.otpMode === 'mock';
