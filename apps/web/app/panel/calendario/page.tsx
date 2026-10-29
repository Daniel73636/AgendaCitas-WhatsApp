"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";

export default function CalendarioPage() {
  const [appointments, setAppointments] = useState<any[]>([]);
  useEffect(() => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 14 * 86400000).toISOString();
    fetch(`${API}/v1/appointments?tenantSlug=belleza-demo&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => setAppointments(d.appointments || []));
  }, []);

  return (
    <div>
      <h1>Calendario</h1>
      <p className="muted">Vista agenda (14 días). En móvil se prioriza lista sobre cuadrícula.</p>
      <div className="grid">
        {appointments.map((a) => (
          <div key={a.id} className="card" style={{ padding: "1rem", display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <div className="badge">{a.status}</div>
              <div><strong>{new Date(a.startsAt).toLocaleString("es-CO")}</strong></div>
              <div className="muted">{a.nameSnapshots?.join(", ")}</div>
            </div>
            <div className="muted">v{a.version}</div>
          </div>
        ))}
        {!appointments.length && <p className="muted">No hay citas próximas.</p>}
      </div>
    </div>
  );
}
