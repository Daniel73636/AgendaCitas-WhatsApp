import type { ApiErrorBody, ApiErrorCode, SlotDto } from '@agenda/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'NETWORK',
    message: string,
    readonly alternatives?: SlotDto[],
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * URL base de la API.
 * - Servidor (SSR): API_URL.
 * - Navegador: NEXT_PUBLIC_API_URL o, si esta vacia, el MISMO host de la web en el puerto de la API
 *   (asi funciona sin configurar en PC y en Android dentro de la red local).
 */
export function apiBase(): string {
  if (typeof window === 'undefined') return (process.env.API_URL ?? 'http://localhost:4100').replace(/\/$/, '');
  const fixed = process.env.NEXT_PUBLIC_API_URL;
  if (fixed) return fixed.replace(/\/$/, '');
  return `${window.location.protocol}//${window.location.hostname}:${process.env.NEXT_PUBLIC_API_PORT ?? '4100'}`;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null | undefined;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        ...(method !== 'GET' && method !== 'DELETE' ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      ...(method !== 'GET' && method !== 'DELETE' ? { body: JSON.stringify(opts.body ?? {}) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const err = (json as ApiErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? `Error ${res.status}`, err?.alternatives, err?.details);
  }
  return json as T;
}

export const newIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
