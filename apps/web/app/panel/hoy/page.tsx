"use client";

import { useEffect, useState } from "react";
import { API, money } from "@/lib/api";

export default function HoyPage() {
  const [summary, setSummary] = useState<any>(null);
  const [appointments, setAppointments] = useState<any[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      fetch(`${API}/v1/reports/summary?tenantSlug=belleza-demo`).then((r) => r.json()),
      fetch(`${API}/v1/appointments?tenantSlug=belleza-demo&from=${today}T00:00:00.000Z&to=${today}T23:59:59.999Z`).then((r) => r.json()),
    ]).then(([s, a]) => {
      setSummary(s);
      setAppointments(a.appointments || []);
    });
  }, []);

  async function action(id: string, path: string) {
    await fetch(`${API}/v1/appointments/${id}/${path}`, { method: "POST" });
    const today = new Date().toISOString().slice(0, 10);
    const a = await fetch(`${API}/v1/appointments?tenantSlug=belleza-demo&from=${today}T00:00:00.000Z&to=${today}T23:59:59.999Z`).then((r) => r.json());
    setAppointments(a.appointments || []);
  }

  return (
    <div>
      <h1>Hoy</h1>
      <div className="grid cols-3" style={{ marginBottom: "1.5rem" }}>
        {[
          ["Citas hoy", summary?.todayCount ?? "—"],
          ["Confirmadas", summary?.confirmedToday ?? "—"],
          ["Inasistencias", summary?.noShows ?? "—"],
        ].map(([k, v]) => (
          <div key={k as string} className="card" style={{ padding: "1rem" }}>
            <div className="muted">{k}</div>
            <div style={{ fontSize: "2rem", fontWeight: 800 }}>{v}</div>
          </div>
        ))}
      </div>

      <h2>Línea del día</h2>
      <div className="grid">
        {appointments.map((a) => (
          <article key={a.id} className="card" style={{ padding: "1rem" }}>
            <div className="badge">{a.status}</div>
            <strong>{new Date(a.startsAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</strong>
            <div>{a.nameSnapshots?.join(", ")}</div>
            <div className="muted">{money(a.totalCents)}</div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
              <button className="btn secondary" onClick={() => action(a.id, "check-in")}>Llegó</button>
              <button className="btn secondary" onClick={() => action(a.id, "complete")}>Completar</button>
              <button className="btn secondary" onClick={() => action(a.id, "no-show")}>No show</button>
            </div>
          </article>
        ))}
        {!appointments.length && <p className="muted">Sin citas para hoy. Crea una desde la página pública.</p>}
      </div>
    </div>
  );
}
