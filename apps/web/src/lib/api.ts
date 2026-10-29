const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4001";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(data.title || "Error"), { status: res.status, data });
  }
  return data as T;
}

export function money(cents: number, currency = "COP") {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents);
}

export { API };
