/** Intervalos semiabiertos [start, end) en minutos absolutos (enteros). */
export interface Interval {
  start: number;
  end: number;
}

export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Ordena y fusiona intervalos que se solapan o se tocan. No muta la entrada. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .filter((i) => i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push(cur);
    }
  }
  return out;
}

/** Resta `blocks` de `base`. Ambos se normalizan primero. */
export function subtractIntervals(base: Interval[], blocks: Interval[]): Interval[] {
  const free = mergeIntervals(base);
  const busy = mergeIntervals(blocks);
  if (busy.length === 0) return free;
  const out: Interval[] = [];
  let bi = 0;
  for (const g of free) {
    let cursor = g.start;
    while (bi < busy.length && busy[bi]!.end <= cursor) bi++;
    let j = bi;
    while (j < busy.length && busy[j]!.start < g.end) {
      const b = busy[j]!;
      if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, g.end) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= g.end) break;
      j++;
    }
    if (cursor < g.end) out.push({ start: cursor, end: g.end });
  }
  return out;
}

/** Minutos de `list` que caen dentro de [from, to). */
export function overlapMinutes(list: Interval[], from: number, to: number): number {
  let total = 0;
  for (const i of list) {
    const s = Math.max(i.start, from);
    const e = Math.min(i.end, to);
    if (e > s) total += e - s;
  }
  return total;
}
