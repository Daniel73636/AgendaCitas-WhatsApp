"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";

export default function ClientesPage() {
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  async function load(query = "") {
    const res = await fetch(`${API}/v1/customers?tenantSlug=belleza-demo&q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setCustomers(data.customers || []);
  }
  useEffect(() => { load(); }, []);
  return (
    <div>
      <h1>Clientes</h1>
      <div className="field">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre o teléfono" onKeyDown={(e) => e.key === "Enter" && load(q)} />
      </div>
      <button className="btn secondary" onClick={() => load(q)}>Buscar</button>
      <div className="grid" style={{ marginTop: "1rem" }}>
        {customers.map((c) => (
          <div key={c.id} className="card" style={{ padding: "1rem" }}>
            <strong>{c.fullName}</strong>
            <div className="muted">{c.phoneE164}</div>
            <div className="muted">No-shows: {c.noShowCount}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
