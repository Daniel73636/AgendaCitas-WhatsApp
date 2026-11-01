import type { PublicBusiness } from '@agenda/contracts';
import { apiBase } from './api';

/** Carga el negocio en el servidor (SSR) para paginas rapidas en 4G. */
export async function getBusiness(slug: string): Promise<PublicBusiness | null> {
  try {
    const res = await fetch(`${apiBase()}/v1/public/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as PublicBusiness;
  } catch (e) {
    if ((e as Error).message?.startsWith('API ')) throw e;
    throw new Error('No se pudo conectar con la API. ¿Está corriendo en el puerto 4100?');
  }
}
