"use client";

import { useEffect, useState } from "react";
import { API, money } from "@/lib/api";

export default function ReportesPage() {
  const [summary, setSummary] = useState<any>(null);
  useEffect(() => {
    fetch(`${API}/v1/reports/summary?tenantSlug=belleza-demo`).then((r) => r.json()).then(setSummary);
  }, []);
  return (
    <div>
      <h1>Reportes</h1>
      <div className="grid cols-2">
        <div className="card" style={{ padding: "1.25rem" }}>
          <div className="muted">Ingresos completados</div>
          <div style={{ fontSize: "2rem", fontWeight: 800 }}>{money(summary?.revenueCompletedCents || 0)}</div>
        </div>
        <div className="card" style={{ padding: "1.25rem" }}>
          <div className="muted">Mensajes enviados</div>
          <div style={{ fontSize: "2rem", fontWeight: 800 }}>{summary?.messagesSent ?? 0}</div>
        </div>
      </div>
    </div>
  );
}
