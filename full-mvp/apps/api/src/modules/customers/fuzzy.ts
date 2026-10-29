/** Busqueda difusa sin extensiones: insensible a tildes/mayusculas y tolerante a errores de tipeo. */
export const normalize = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function levenshtein(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]!;
    prev[0] = i;
    let rowMin = prev[0]!;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
      rowMin = Math.min(rowMin, prev[j]!);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length]!;
}

/** Puntaje > 0 si coincide. Mayor = mejor. */
export function fuzzyScore(query: string, name: string, phone: string, email?: string | null): number {
  const q = normalize(query);
  if (!q) return 1;
  const digits = query.replace(/\D/g, '');
  const tokens = q.split(/\s+/).filter(Boolean);
  const nameTokens = normalize(name).split(/\s+/);
  const hay = `${normalize(name)} ${email ? normalize(email) : ''}`;
  let total = 0;
  for (const t of tokens) {
    let best = 0;
    if (digits.length >= 3 && /^[\d+\s]+$/.test(t) && phone.replace(/\D/g, '').includes(t.replace(/\D/g, ''))) best = 8;
    for (const nt of nameTokens) {
      if (nt === t) best = Math.max(best, 10);
      else if (nt.startsWith(t)) best = Math.max(best, 8);
      else if (t.length >= 3 && nt.includes(t)) best = Math.max(best, 5);
      else if (t.length >= 4) {
        const d = levenshtein(t, nt.slice(0, t.length + 1), t.length >= 7 ? 2 : 1);
        if (d <= (t.length >= 7 ? 2 : 1)) best = Math.max(best, 4 - d);
      }
    }
    if (best === 0 && t.length >= 3 && hay.includes(t)) best = 3;
    if (best === 0) return 0; // todos los tokens deben coincidir
    total += best;
  }
  return total;
}
