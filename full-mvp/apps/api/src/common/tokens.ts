import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Token firmado HMAC-SHA256 con expiracion: base64url(payload).firma */
export function signToken(payload: Record<string, unknown>, secret: string, ttlSec: number, nowMs = Date.now()): string {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(nowMs / 1000) + ttlSec }));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string | undefined, secret: string, nowMs = Date.now()): (T & { exp: number }) | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Enlace firmado de cita (sin expiracion propia; la politica la decide el estado/fecha de la cita). */
export function signAppointmentToken(appointmentId: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(`apt:${appointmentId}`).digest('base64url').slice(0, 24);
  return `${appointmentId}.${sig}`;
}

export function verifyAppointmentToken(token: string, secret: string): string | null {
  const [id, sig] = token.split('.');
  if (!id || !sig) return null;
  const expected = createHmac('sha256', secret).update(`apt:${id}`).digest('base64url').slice(0, 24);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}
