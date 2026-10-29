import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container" style={{ padding: "2rem 0 4rem" }}>
      <div className="badge">PWA · PC + Android</div>
      <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.4rem)", lineHeight: 1.1, margin: "1rem 0" }}>
        Agenda de citas<br />con WhatsApp
      </h1>
      <p className="muted" style={{ maxWidth: 560, fontSize: "1.1rem" }}>
        Reservas públicas, panel del negocio, recordatorios y disponibilidad sin cruces.
        Demo lista con el negocio <strong>Belleza Demo</strong>.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
        <Link className="btn" href="/belleza-demo">Ver página pública</Link>
        <Link className="btn secondary" href="/belleza-demo/reservar">Reservar cita</Link>
        <Link className="btn secondary" href="/panel/hoy">Abrir panel</Link>
      </div>

      <section className="grid cols-3" style={{ marginTop: "3rem" }}>
        {[
          ["Disponibilidad pura", "Motor domain-booking con huecos deterministas y filtros anti-solape."],
          ["Hold + OTP", "Bloqueo de 5 minutos y verificación de celular (demo: 123456)."],
          ["WhatsApp mock", "Confirmaciones y recordatorios encolados en modo simulación."],
        ].map(([t, d]) => (
          <article key={t} className="card" style={{ padding: "1.25rem" }}>
            <h3 style={{ marginTop: 0 }}>{t}</h3>
            <p className="muted">{d}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
