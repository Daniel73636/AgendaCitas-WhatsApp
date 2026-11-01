import bcrypt from 'bcryptjs';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** UUID v7 (ordenable por tiempo). Generado en la aplicacion. */
export function uuidv7(): string {
  const ts = BigInt(Date.now());
  const rnd = randomBytes(10);
  const b = Buffer.alloc(16);
  b.writeUIntBE(Number((ts >> 16n) & 0xffffffffn), 0, 4);
  b.writeUIntBE(Number(ts & 0xffffn), 4, 2);
  rnd.copy(b, 6);
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Costo de bcrypt: 12 por defecto; BCRYPT_ROUNDS permite bajarlo en pruebas (minimo 4). */
const bcryptRounds = (): number => {
  const n = Number(process.env.BCRYPT_ROUNDS);
  return Number.isInteger(n) && n >= 4 && n <= 15 ? n : 12;
};

/** Hash bcrypt ($2a/$2b). bcrypt solo usa los primeros 72 bytes: se pre-hashea con SHA-256 para no truncar contrasenas largas. */
const prehash = (password: string): string => createHash('sha256').update(password, 'utf8').digest('base64');

export function hashPassword(password: string): string {
  return `bcrypt-sha256$${bcrypt.hashSync(prehash(password), bcryptRounds())}`;
}

/** Hash de relleno para igualar el tiempo de respuesta cuando el usuario no existe. */
let dummyHash: string | undefined;
export const dummyPasswordHash = (): string => (dummyHash ??= hashPassword('contrasena-inexistente'));

/** Acepta bcrypt (formato actual) y scrypt (formato anterior, se migra al siguiente login correcto). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('bcrypt-sha256$')) return bcrypt.compare(prehash(password), stored.slice('bcrypt-sha256$'.length));
  if (stored.startsWith('$2')) return bcrypt.compare(password, stored); // bcrypt "puro" de otros sistemas
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** true si el hash guardado no es bcrypt-sha256 con el costo actual (conviene re-hashear tras un login correcto). */
export function needsRehash(stored: string): boolean {
  if (!stored.startsWith('bcrypt-sha256$')) return true;
  const m = /^bcrypt-sha256\$\$2[aby]\$(\d{2})\$/.exec(stored);
  return !m || Number(m[1]) < bcryptRounds();
}

/** HMAC-SHA256 hex (codigos OTP: nunca se guardan en claro). */
export const hmacHex = (value: string, secret: string): string => createHmac('sha256', secret).update(value).digest('hex');

const keyFrom = (secret: string): Buffer => createHash('sha256').update(secret).digest();

/** Cifrado de campo AES-256-GCM -> base64(iv|tag|ciphertext). */
export function encryptField(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptField(payload: string, secret: string): string {
  const raw = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
