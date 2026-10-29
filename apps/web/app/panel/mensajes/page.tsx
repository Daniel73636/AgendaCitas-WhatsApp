"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";

export default function MensajesPage() {
  const [data, setData] = useState<any>({ messages: [], mockLog: [] });
  useEffect(() => {
    fetch(`${API}/v1/messages?tenantSlug=belleza-demo`).then((r) => r.json()).then(setData);
  }, []);
  return (
    <div>
      <h1>Mensajes WhatsApp</h1>
      <p className="muted">Modo mock: los envíos se registran localmente.</p>
      <div className="grid">
        {(data.messages || []).map((m: any) => (
          <div key={m.id} className="card" style={{ padding: "1rem" }}>
            <div className="badge">{m.status}</div>
            <div>{m.template}</div>
            <div className="muted">{m.sentAt}</div>
          </div>
        ))}
        {!data.messages?.length && <p className="muted">Aún no hay mensajes. Confirma una cita para generar uno.</p>}
      </div>
    </div>
  );
}
