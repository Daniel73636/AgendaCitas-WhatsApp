export const DEFAULT_BRAND = '#7c3aed';
const HEX = /^#[0-9a-fA-F]{6}$/;

export function normalizeBrand(input: string | null | undefined): string {
  return input && HEX.test(input) ? input : DEFAULT_BRAND;
}

/** Componentes HSL ("262 83% 58%") para `hsl(var(--primary))`. */
export function brandHsl(hex: string): string {
  const n = normalizeBrand(hex).slice(1);
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return `0 0% ${Math.round(l * 100)}%`;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return `${Math.round((h / 6) * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
