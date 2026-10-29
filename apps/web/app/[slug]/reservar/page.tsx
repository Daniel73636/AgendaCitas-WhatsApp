"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { API, money } from "@/lib/api";

type Service = { id: string; name: string; durationMin: number; priceCents: number; currency: string };
type Staff = { id: string; displayName: string };
type Slot = { startsAt: string; endsAt: string; staffId: string };

export default function ReservarPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [staffId, setStaffId] = useState<string>("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [hold, setHold] = useState<{ id: string; holdExpiresAt?: string } | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+57");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [consent, setConsent] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    fetch(`${API}/v1/public/${slug}`)
      .then((r) => r.json())
      .then((d) => {
        setServices(d.services || []);
        setStaff(d.staff || []);
      })
      .catch(() => setError("No se pudo cargar el catálogo"));
  }, [slug]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const total = useMemo(
    () => services.filter((s) => selectedServices.includes(s.id)).reduce((a, s) => a + s.priceCents, 0),
    [services, selectedServices],
  );

  const holdLeft = hold?.holdExpiresAt
    ? Math.max(0, Math.floor((Date.parse(hold.holdExpiresAt) - now) / 1000))
    : 0;

  async function loadSlots() {
    setError("");
    const serviceId = selectedServices[0];
    if (!serviceId) return;
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 86400000).toISOString();
    const qs = new URLSearchParams({ serviceId, from, to });
    if (staffId) qs.set("staffId", staffId);
    const res = await fetch(`${API}/v1/public/${slug}/availability?${qs}`);
    const data = await res.json();
    setSlots(data.slots || []);
  }

  async function createHold(selected: Slot) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/v1/public/${slug}/holds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          staffId: selected.staffId,
          serviceIds: selectedServices,
          startsAt: selected.startsAt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.title || "No disponible");
      setHold(data.hold);
      setSlot(selected);
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function requestOtp() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/v1/public/${slug}/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneE164: phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.title);
      setOtpSent(true);
      if (data.demoHint) setError(data.demoHint);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error OTP");
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (!hold) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/v1/public/${slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          holdId: hold.id,
          fullName: name,
          phoneE164: phone,
          otp,
          consentWhatsapp: consent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.title);
      router.push(`/${slug}/cita/${data.manageToken}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al confirmar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container" style={{ padding: "1.25rem 0 5rem" }}>
      <Link href={`/${slug}`} className="muted">← Volver</Link>
      <h1>Reservar</h1>
      <p className="muted">Paso {step} de 4</p>
      <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 99, marginBottom: "1.25rem" }}>
        <div style={{ width: `${step * 25}%`, height: "100%", background: "var(--brand)", borderRadius: 99 }} />
      </div>

      {error && <p style={{ color: "#fbbf24" }}>{error}</p>}

      {step === 1 && (
        <section className="grid">
          {services.map((s) => {
            const on = selectedServices.includes(s.id);
            return (
              <button
                key={s.id}
                className="card"
                style={{
                  padding: "1rem",
                  textAlign: "left",
                  borderColor: on ? "var(--brand)" : undefined,
                  cursor: "pointer",
                  color: "inherit",
                  background: "var(--card)",
                }}
                onClick={() =>
                  setSelectedServices((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                }
              >
                <strong>{s.name}</strong>
                <div className="muted">{s.durationMin} min · {money(s.priceCents)}</div>
              </button>
            );
          })}
          <div className="sticky-cta">
            <button className="btn" style={{ width: "100%" }} disabled={!selectedServices.length} onClick={() => setStep(2)}>
              Continuar · {money(total)}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="grid">
          <button className="card" style={{ padding: "1rem", textAlign: "left", color: "inherit", background: "var(--card)", borderColor: !staffId ? "var(--brand)" : undefined }} onClick={() => setStaffId("")}>
            Cualquiera disponible
          </button>
          {staff.map((s) => (
            <button key={s.id} className="card" style={{ padding: "1rem", textAlign: "left", color: "inherit", background: "var(--card)", borderColor: staffId === s.id ? "var(--brand)" : undefined }} onClick={() => setStaffId(s.id)}>
              {s.displayName}
            </button>
          ))}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn secondary" onClick={() => setStep(1)}>Atrás</button>
            <button className="btn" onClick={async () => { await loadSlots(); setStep(3); }}>Ver horarios</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <div className="grid cols-3">
            {slots.slice(0, 48).map((s) => (
              <button key={s.startsAt + s.staffId} className="slot" disabled={loading} onClick={() => createHold(s)}>
                {new Date(s.startsAt).toLocaleString("es-CO", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
              </button>
            ))}
          </div>
          {!slots.length && <p className="muted">No hay huecos en los próximos 7 días para esa combinación.</p>}
          <button className="btn secondary" style={{ marginTop: "1rem" }} onClick={() => setStep(2)}>Atrás</button>
        </section>
      )}

      {step === 4 && hold && slot && (
        <section className="card" style={{ padding: "1.25rem" }}>
          <p className="badge">Reservamos tu hora por {Math.floor(holdLeft / 60)}:{String(holdLeft % 60).padStart(2, "0")}</p>
          <p><strong>{new Date(slot.startsAt).toLocaleString("es-CO")}</strong></p>
          <p className="muted">{selectedServices.length} servicio(s) · {money(total)}</p>
          <div className="field">
            <label>Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" />
          </div>
          <div className="field">
            <label>Celular (E.164)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57300..." />
          </div>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem" }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            Acepto recordatorios por WhatsApp
          </label>
          {!otpSent ? (
            <button className="btn" disabled={loading || !name || phone.length < 8} onClick={requestOtp}>Enviar código</button>
          ) : (
            <>
              <div className="field">
                <label>Código OTP</label>
                <input value={otp} onChange={(e) => setOtp(e.target.value)} maxLength={6} placeholder="123456" />
              </div>
              <button className="btn" disabled={loading || otp.length !== 6} onClick={confirm} style={{ width: "100%" }}>
                Confirmar cita
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
}
