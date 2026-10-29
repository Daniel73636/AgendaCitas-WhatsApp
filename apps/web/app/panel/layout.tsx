import Link from "next/link";

const links = [
  ["/panel/hoy", "Hoy"],
  ["/panel/calendario", "Calendario"],
  ["/panel/clientes", "Clientes"],
  ["/panel/servicios", "Servicios"],
  ["/panel/mensajes", "Mensajes"],
  ["/panel/reportes", "Reportes"],
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", paddingTop: "1rem" }}>
          <div>
            <strong>Belleza Demo</strong>
            <div className="muted" style={{ fontSize: "0.85rem" }}>Panel del negocio · PWA</div>
          </div>
          <Link className="btn secondary" href="/belleza-demo/reservar">Nueva cita</Link>
        </div>
        <nav className="nav">
          {links.map(([href, label]) => (
            <Link key={href} href={href}>{label}</Link>
          ))}
        </nav>
      </header>
      <main className="container" style={{ paddingBottom: "3rem" }}>{children}</main>
    </div>
  );
}
