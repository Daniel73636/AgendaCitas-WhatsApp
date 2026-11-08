const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(key: string, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${key}|${tz}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('es-CO', { timeZone: tz, ...opts });
    cache.set(k, f);
  }
  return f;
}

/** "jueves 5 de marzo" en la zona del negocio. */
export const dateLabel = (iso: string | Date, tz: string): string =>
  dtf('date', tz, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));

/** "14:30" 24h en la zona del negocio. */
export const timeLabel = (iso: string | Date, tz: string): string =>
  dtf('time', tz, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

export const isoOf = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
