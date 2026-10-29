import Link from "next/link";
import { api, money } from "@/lib/api";

type PublicData = {
  tenant: { name: string; slug: string };
  locations: Array<{ name: string; address?: string }>;
  staff: Array<{ id: string; displayName: string }>;
  services: Array<{ id: string; name: string; description?: string; durationMin: number; priceCents: number; currency: string }>;
};

export default async function PublicBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let data: PublicData | null = null;
  let error = "";
  try {
    data = await api<PublicData>(`/v1/public/${slug}`);
  } catch {
    error = "No se pudo cargar el negocio. Arranca la API en :4001 y ejecuta el seed.";
  }

  if (!data) {
    return (
      <main className="container" style={{ padding: "2rem 0" }}>
        <h1>Negocio no disponible</h1>
        <p className="muted">{error}</p>
        <Link className="btn" href="/">Volver</Link>
      </main>
    );
  }

  return (
    <main className="container" style={{ padding: "1.5rem 0 6rem" }}>
      <div className="badge">{data.locations[0]?.name || "Sede"}</div>
      <h1 style={{ marginBottom: 0 }}>{data.tenant.name}</h1>
      <p className="muted">{data.locations[0]?.address}</p>

      <h2>Servicios</h2>
      <div className="grid cols-2">
        {data.services.map((s) => (
          <article key={s.id} className="card" style={{ padding: "1rem" }}>
            <h3 style={{ margin: "0 0 0.35rem" }}>{s.name}</h3>
            <p className="muted" style={{ margin: 0 }}>{s.description}</p>
            <p style={{ marginTop: "0.75rem" }}>
              <strong>{money(s.priceCents, s.currency)}</strong>
              <span className="muted"> · {s.durationMin} min</span>
            </p>
          </article>
        ))}
      </div>

      <h2>Equipo</h2>
      <div className="grid cols-3">
        {data.staff.map((s) => (
          <div key={s.id} className="card" style={{ padding: "1rem" }}>{s.displayName}</div>
        ))}
      </div>

      <div className="sticky-cta">
        <Link className="btn" href={`/${slug}/reservar`} style={{ display: "block", textAlign: "center" }}>
          Reservar
        </Link>
      </div>
    </main>
  );
}
