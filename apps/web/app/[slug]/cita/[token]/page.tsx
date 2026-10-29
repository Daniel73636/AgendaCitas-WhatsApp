"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API, money } from "@/lib/api";

export default function CitaPage() {
  const { slug, token } = useParams<{ slug: string; token: string }>();
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const res = await fetch(`${API}/v1/public/appointments/${token}`);
    setData(await res.json());
  }

  useEffect(() => { load(); }, [token]);

  async function cancel() {
    const res = await fetch(`${API}/v1/public/appointments/${token}/cancel`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) setMsg(body.title);
    else {
      setMsg("Cita cancelada");
      load();
    }
  }

  if (!data?.appointment) {
    return <main className="container" style={{ padding: "2rem 0" }}><p className="muted">Cargando…</p></main>;
  }

  const a = data.appointment;
  return (
    <main className="container" style={{ padding: "1.5rem 0 3rem" }}>
      <Link href={`/${slug}`} className="muted">← {slug}</Link>
      <h1>Tu cita</h1>
      <article className="card" style={{ padding: "1.25rem" }}>
        <div className="badge">{a.status}</div>
        <h2 style={{ marginBottom: 0 }}>{a.nameSnapshots?.join(", ")}</h2>
        <p>{new Date(a.startsAt).toLocaleString("es-CO")}</p>
        <p className="muted">Con {data.staff?.displayName || "profesional"}</p>
        <p><strong>{money(a.totalCents)}</strong></p>
        {data.customer && <p className="muted">{data.customer.fullName} · {data.customer.phoneE164}</p>}
        {a.status !== "canceled" && a.status !== "completed" && (
          <button className="btn secondary" onClick={cancel}>Cancelar cita</button>
        )}
        {msg && <p style={{ color: "#fbbf24" }}>{msg}</p>}
      </article>
    </main>
  );
}
