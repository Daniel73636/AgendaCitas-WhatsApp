import { Readable } from 'node:stream';
import type { FastifyLike } from './http-hardening';

const bodies = new WeakMap<object, Buffer>();

/** Cuerpo crudo de una peticion capturada con `registerRawBodyCapture` (clave: `request.raw`). */
export const getRawBody = (req: { raw?: object } | object): Buffer | undefined => bodies.get((req as { raw?: object }).raw ?? req);

/**
 * Conserva el cuerpo crudo de las rutas indicadas (prefijo) antes de que se parsee el JSON.
 * Una firma HMAC solo es verificable sobre los bytes originales, no sobre `JSON.stringify(body)`.
 */
export function registerRawBodyCapture(fastify: FastifyLike, prefixes: string[]): void {
  fastify.addHook('preParsing', (req, _reply, payload, done) => {
    const path = req.url.split('?')[0] ?? '';
    if (!prefixes.some((p) => path === p || path.startsWith(`${p}/`))) return done(null, payload);
    const chunks: Buffer[] = [];
    payload.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    payload.on('error', (e: Error) => done(e));
    payload.on('end', () => {
      const raw = Buffer.concat(chunks);
      bodies.set(req.raw, raw);
      done(null, Readable.from(raw));
    });
  });
}
