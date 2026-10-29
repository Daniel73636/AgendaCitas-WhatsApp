"use client";

import { useEffect, useState } from "react";
import { API, money } from "@/lib/api";

export default function ServiciosPage() {
  const [services, setServices] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  useEffect(() => {
    Promise.all([
      fetch(`${API}/v1/services?tenantSlug=belleza-demo`).then((r) => r.json()),
      fetch(`${API}/v1/staff?tenantSlug=belleza-demo`).then((r) => r.json()),
    ]).then(([s, st]) => {
      setServices(s.services || []);
      setStaff(st.staff || []);
    });
  }, []);
  return (
    <div>
      <h1>Servicios y equipo</h1>
      <div className="grid cols-2">
        <section>
          <h2>Servicios</h2>
          {services.map((s) => (
            <div key={s.id} className="card" style={{ padding: "1rem", marginBottom: "0.75rem" }}>
              <strong>{s.name}</strong>
              <div className="muted">{s.durationMin} min · {money(s.priceCents)}</div>
            </div>
          ))}
        </section>
        <section>
          <h2>Equipo</h2>
          {staff.map((s) => (
            <div key={s.id} className="card" style={{ padding: "1rem", marginBottom: "0.75rem" }}>
              {s.displayName} {s.active ? "" : "(inactivo)"}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
