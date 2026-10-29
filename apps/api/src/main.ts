import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadStore, saveStore, uid, type Appointment, type Customer } from "@agenda/db";
import { computeSlots } from "@agenda/domain-booking";
import { MockWhatsAppClient } from "@agenda/whatsapp";
import { z } from "zod";

const wa = new MockWhatsAppClient();

const HoldRequest = z.object({
  staffId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).min(1),
  startsAt: z.string().datetime(),
});
const BookRequest = z.object({
  holdId: z.string().uuid(),
  fullName: z.string().min(2),
  phoneE164: z.string().min(8),
  otp: z.string().length(6),
  consentWhatsapp: z.boolean(),
});

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const OTP_DEMO = process.env.OTP_DEMO_CODE || "123456";
const HOLD_MS = 5 * 60_000;
const TZ = "America/Bogota";

function localDate(d = new Date(), days = 0): string {
  const x = new Date(d.getTime() + days * 86_400_000);
  return x.toLocaleDateString("en-CA", { timeZone: TZ });
}

function problem(status: number, title: string, code?: string, detail?: string) {
  return { type: `https://agenda.local/problems/${code || "error"}`, title, status, detail, code };
}

function tenantBySlug(slug: string) {
  return loadStore().tenants.find((t) => t.slug === slug);
}

function activeBusy(tenantId: string) {
  const active = new Set(["held", "pending", "confirmed", "in_progress"]);
  return loadStore()
    .appointments.filter((a) => a.tenantId === tenantId && active.has(a.status))
    .filter((a) => !(a.status === "held" && a.holdExpiresAt && Date.parse(a.holdExpiresAt) < Date.now()))
    .map((a) => ({
      staffId: a.staffId,
      startMs: Date.parse(a.occupiedStart),
      endMs: Date.parse(a.occupiedEnd),
    }));
}

function expireHolds() {
  const store = loadStore();
  const now = Date.now();
  let changed = false;
  for (const a of store.appointments) {
    if (a.status === "held" && a.holdExpiresAt && Date.parse(a.holdExpiresAt) < now) {
      a.status = "canceled";
      a.version += 1;
      changed = true;
    }
  }
  if (changed) saveStore();
}

app.addHook("onRequest", async () => expireHolds());

app.get("/health", async () => ({ ok: true, service: "agenda-api" }));

app.get("/v1/public/:slug", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const store = loadStore();
  const tenant = tenantBySlug(slug);
  if (!tenant) return reply.code(404).send(problem(404, "Negocio no encontrado", "NOT_FOUND"));
  const locations = store.locations.filter((l) => l.tenantId === tenant.id);
  const staff = store.staff.filter((s) => s.tenantId === tenant.id && s.active);
  const services = store.services.filter((s) => s.tenantId === tenant.id && s.visiblePublic);
  return { tenant, locations, staff, services };
});

app.get("/v1/public/:slug/availability", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const q = req.query as { serviceId?: string; staffId?: string; from?: string; to?: string };
  const store = loadStore();
  const tenant = tenantBySlug(slug);
  if (!tenant) return reply.code(404).send(problem(404, "Negocio no encontrado", "NOT_FOUND"));
  const service = store.services.find((s) => s.id === q.serviceId && s.tenantId === tenant.id);
  if (!service) return reply.code(400).send(problem(400, "Servicio requerido", "VALIDATION"));

  const staffList = store.staff.filter(
    (s) => s.tenantId === tenant.id && s.active && (!q.staffId || s.id === q.staffId),
  ).filter((s) => store.staffServices.some((ss) => ss.staffId === s.id && ss.serviceId === service.id));

  const busy = activeBusy(tenant.id);
  const fromDate = q.from ? localDate(new Date(q.from)) : localDate();
  const toDate = q.to ? localDate(new Date(q.to)) : localDate(new Date(), 7);

  const slots = computeSlots({
    now: new Date().toISOString(),
    timezone: TZ,
    fromDate,
    toDate,
    services: [{
      id: service.id,
      durationMin: service.durationMin,
      bufferBeforeMin: service.bufferBeforeMin,
      bufferAfterMin: service.bufferAfterMin,
    }],
    staff: staffList.map((s) => ({
      id: s.id,
      schedule: store.schedules
        .filter((sc) => sc.staffId === s.id)
        .map((sc) => ({ weekday: sc.weekday, start: sc.startTime, end: sc.endTime })),
      timeOff: [],
      busy: busy
        .filter((b) => b.staffId === s.id)
        .map((b) => ({ start: new Date(b.startMs).toISOString(), end: new Date(b.endMs).toISOString() })),
    })),
    rules: {
      minNoticeMin: 30,
      maxAdvanceDays: 60,
      stepMin: 15,
      assignment: "least_loaded",
    },
  });

  return {
    slots: slots.map((s) => ({
      startsAt: s.start,
      endsAt: s.end,
      staffId: s.staffId,
      occupiedStart: s.occupiedStart,
      occupiedEnd: s.occupiedEnd,
      label: s.label,
    })),
  };
});

app.post("/v1/public/:slug/holds", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const parsed = HoldRequest.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send(problem(400, "Datos inválidos", "VALIDATION"));
  const store = loadStore();
  const tenant = tenantBySlug(slug);
  if (!tenant) return reply.code(404).send(problem(404, "Negocio no encontrado", "NOT_FOUND"));

  const services = store.services.filter((s) => parsed.data.serviceIds.includes(s.id));
  if (!services.length) return reply.code(400).send(problem(400, "Servicios inválidos", "VALIDATION"));

  const duration = services.reduce((a, s) => a + s.durationMin, 0);
  const bufferBefore = Math.max(...services.map((s) => s.bufferBeforeMin), 0);
  const bufferAfter = Math.max(...services.map((s) => s.bufferAfterMin), 0);
  const startsAt = Date.parse(parsed.data.startsAt);
  const endsAt = startsAt + duration * 60_000;
  const occupiedStart = startsAt - bufferBefore * 60_000;
  const occupiedEnd = endsAt + bufferAfter * 60_000;

  const conflict = activeBusy(tenant.id).some(
    (b) => b.staffId === parsed.data.staffId && occupiedStart < b.endMs && b.startMs < occupiedEnd,
  );
  if (conflict) {
    return reply.code(409).send(problem(409, "Horario no disponible", "SLOT_TAKEN", "El hueco ya fue tomado"));
  }

  const apt: Appointment = {
    id: uid(),
    tenantId: tenant.id,
    staffId: parsed.data.staffId,
    status: "held",
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    occupiedStart: new Date(occupiedStart).toISOString(),
    occupiedEnd: new Date(occupiedEnd).toISOString(),
    source: "web",
    totalCents: services.reduce((a, s) => a + s.priceCents, 0),
    depositPaidCents: 0,
    version: 1,
    holdExpiresAt: new Date(Date.now() + HOLD_MS).toISOString(),
    serviceIds: services.map((s) => s.id),
    nameSnapshots: services.map((s) => s.name),
  };
  store.appointments.push(apt);
  store.events.push({
    id: uid(), tenantId: tenant.id, type: "appointment.held", payload: { id: apt.id }, at: new Date().toISOString(),
  });
  saveStore();
  return reply.code(201).send({ hold: apt });
});

app.post("/v1/public/:slug/otp/request", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const body = req.body as { phoneE164?: string };
  const tenant = tenantBySlug(slug);
  if (!tenant) return reply.code(404).send(problem(404, "Negocio no encontrado", "NOT_FOUND"));
  if (!body.phoneE164) return reply.code(400).send(problem(400, "Celular requerido", "VALIDATION"));
  const store = loadStore();
  store.otps[body.phoneE164] = { code: OTP_DEMO, expiresAt: Date.now() + 10 * 60_000 };
  saveStore();
  await wa.sendText(body.phoneE164, `Tu código de verificación es ${OTP_DEMO}`);
  return { ok: true, demoHint: `En modo demo el código es ${OTP_DEMO}` };
});

app.post("/v1/public/:slug/bookings", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const parsed = BookRequest.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send(problem(400, "Datos inválidos", "VALIDATION"));
  const store = loadStore();
  const tenant = tenantBySlug(slug);
  if (!tenant) return reply.code(404).send(problem(404, "Negocio no encontrado", "NOT_FOUND"));

  const otp = store.otps[parsed.data.phoneE164];
  if (!otp || otp.code !== parsed.data.otp || otp.expiresAt < Date.now()) {
    return reply.code(401).send(problem(401, "Código inválido o vencido", "OTP_INVALID"));
  }

  const apt = store.appointments.find((a) => a.id === parsed.data.holdId && a.tenantId === tenant.id);
  if (!apt || apt.status !== "held") {
    return reply.code(409).send(problem(409, "Reserva temporal inválida", "HOLD_EXPIRED"));
  }
  if (apt.holdExpiresAt && Date.parse(apt.holdExpiresAt) < Date.now()) {
    apt.status = "canceled";
    saveStore();
    return reply.code(409).send(problem(409, "La reserva temporal expiró", "HOLD_EXPIRED"));
  }

  let customer = store.customers.find(
    (c) => c.tenantId === tenant.id && c.phoneE164 === parsed.data.phoneE164,
  );
  if (!customer) {
    customer = {
      id: uid(),
      tenantId: tenant.id,
      fullName: parsed.data.fullName,
      phoneE164: parsed.data.phoneE164,
      noShowCount: 0,
      lateCancelCount: 0,
      tags: [],
    } satisfies Customer;
    store.customers.push(customer);
  } else {
    customer.fullName = parsed.data.fullName;
  }

  apt.customerId = customer.id;
  apt.status = "confirmed";
  apt.holdExpiresAt = undefined;
  apt.version += 1;
  store.events.push({
    id: uid(), tenantId: tenant.id, type: "appointment.confirmed", payload: { id: apt.id }, at: new Date().toISOString(),
  });
  store.messages.push({
    id: uid(), tenantId: tenant.id, appointmentId: apt.id, channel: "whatsapp",
    template: "appointment_confirmation", status: "sent", sentAt: new Date().toISOString(),
  });
  saveStore();

  await wa.sendTemplate(
    customer.phoneE164,
    "appointment_confirmation",
    {
      name: customer.fullName,
      service: apt.nameSnapshots.join(", "),
      time: apt.startsAt,
      link: `/cita/${apt.id}`,
    },
    { appointmentId: apt.id },
  );

  return { appointment: apt, customer, manageToken: apt.id };
});

app.get("/v1/public/appointments/:token", async (req, reply) => {
  const { token } = req.params as { token: string };
  const store = loadStore();
  const apt = store.appointments.find((a) => a.id === token);
  if (!apt) return reply.code(404).send(problem(404, "Cita no encontrada", "NOT_FOUND"));
  const staff = store.staff.find((s) => s.id === apt.staffId);
  const customer = store.customers.find((c) => c.id === apt.customerId);
  return { appointment: apt, staff, customer };
});

app.post("/v1/public/appointments/:token/cancel", async (req, reply) => {
  const { token } = req.params as { token: string };
  const store = loadStore();
  const apt = store.appointments.find((a) => a.id === token);
  if (!apt) return reply.code(404).send(problem(404, "Cita no encontrada", "NOT_FOUND"));
  if (["canceled", "completed"].includes(apt.status)) {
    return reply.code(409).send(problem(409, "No se puede cancelar", "INVALID_STATE"));
  }
  apt.status = "canceled";
  apt.version += 1;
  store.events.push({
    id: uid(), tenantId: apt.tenantId, type: "appointment.canceled", payload: { id: apt.id }, at: new Date().toISOString(),
  });
  saveStore();
  return { appointment: apt };
});

app.get("/v1/appointments", async (req) => {
  const q = req.query as { tenantSlug?: string; from?: string; to?: string };
  const store = loadStore();
  const tenant = tenantBySlug(q.tenantSlug || "belleza-demo");
  if (!tenant) return [];
  let list = store.appointments.filter((a) => a.tenantId === tenant.id && a.status !== "canceled");
  if (q.from) list = list.filter((a) => Date.parse(a.startsAt) >= Date.parse(q.from!));
  if (q.to) list = list.filter((a) => Date.parse(a.startsAt) <= Date.parse(q.to!));
  return { appointments: list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)) };
});

app.patch("/v1/appointments/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as { status?: string; staffId?: string; startsAt?: string; version?: number };
  const store = loadStore();
  const apt = store.appointments.find((a) => a.id === id);
  if (!apt) return reply.code(404).send(problem(404, "Cita no encontrada", "NOT_FOUND"));
  if (body.version !== undefined && body.version !== apt.version) {
    return reply.code(412).send(problem(412, "Versión desactualizada", "PRECONDITION_FAILED"));
  }
  if (body.status) apt.status = body.status;
  if (body.staffId) apt.staffId = body.staffId;
  if (body.startsAt) {
    const dur = Date.parse(apt.endsAt) - Date.parse(apt.startsAt);
    apt.startsAt = body.startsAt;
    apt.endsAt = new Date(Date.parse(body.startsAt) + dur).toISOString();
  }
  apt.version += 1;
  store.events.push({
    id: uid(), tenantId: apt.tenantId, type: "appointment.updated", payload: { id: apt.id }, at: new Date().toISOString(),
  });
  saveStore();
  return { appointment: apt };
});

app.post("/v1/appointments/:id/check-in", async (req, reply) => {
  const { id } = req.params as { id: string };
  const store = loadStore();
  const apt = store.appointments.find((a) => a.id === id);
  if (!apt) return reply.code(404).send(problem(404, "Cita no encontrada", "NOT_FOUND"));
  apt.status = "in_progress";
  apt.version += 1;
  saveStore();
  return { appointment: apt };
});

app.post("/v1/appointments/:id/complete", async (req, reply) => {
  const { id } = req.params as { id: string };
  const store = loadStore();
  const apt = store.appointments.find((a) => a.id === id);
  if (!apt) return reply.code(404).send(problem(404, "Cita no encontrada", "NOT_FOUND"));
  apt.status = "completed";
  apt.version += 1;
  saveStore();
  return { appointment: apt };
});

app.post("/v1/appointments/:id/no-show", async (req, reply) => {
  const { id } = req.params as { id: string };
  const store = loadStore();
  const apt = store.appointments.find((a) => a.id === id);
  if (!apt) return reply.code(404).send(problem(404, "Cita no encontrada", "NOT_FOUND"));
  apt.status = "no_show";
  apt.version += 1;
  if (apt.customerId) {
    const c = store.customers.find((x) => x.id === apt.customerId);
    if (c) c.noShowCount += 1;
  }
  saveStore();
  return { appointment: apt };
});

app.get("/v1/customers", async (req) => {
  const q = req.query as { tenantSlug?: string; q?: string };
  const store = loadStore();
  const tenant = tenantBySlug(q.tenantSlug || "belleza-demo");
  if (!tenant) return { customers: [] };
  let list = store.customers.filter((c) => c.tenantId === tenant.id);
  if (q.q) {
    const s = q.q.toLowerCase();
    list = list.filter((c) => c.fullName.toLowerCase().includes(s) || c.phoneE164.includes(s));
  }
  return { customers: list };
});

app.get("/v1/services", async (req) => {
  const tenant = tenantBySlug((req.query as { tenantSlug?: string }).tenantSlug || "belleza-demo");
  const store = loadStore();
  return { services: tenant ? store.services.filter((s) => s.tenantId === tenant.id) : [] };
});

app.get("/v1/staff", async (req) => {
  const tenant = tenantBySlug((req.query as { tenantSlug?: string }).tenantSlug || "belleza-demo");
  const store = loadStore();
  return { staff: tenant ? store.staff.filter((s) => s.tenantId === tenant.id) : [] };
});

app.get("/v1/reports/summary", async (req) => {
  const tenant = tenantBySlug((req.query as { tenantSlug?: string }).tenantSlug || "belleza-demo");
  const store = loadStore();
  if (!tenant) return {};
  const apts = store.appointments.filter((a) => a.tenantId === tenant.id);
  const today = new Date().toISOString().slice(0, 10);
  const todayApts = apts.filter((a) => a.startsAt.startsWith(today));
  return {
    todayCount: todayApts.length,
    confirmedToday: todayApts.filter((a) => a.status === "confirmed").length,
    noShows: apts.filter((a) => a.status === "no_show").length,
    revenueCompletedCents: apts.filter((a) => a.status === "completed").reduce((s, a) => s + a.totalCents, 0),
    messagesSent: store.messages.filter((m) => m.tenantId === tenant.id).length,
  };
});

app.get("/v1/messages", async (req) => {
  const tenant = tenantBySlug((req.query as { tenantSlug?: string }).tenantSlug || "belleza-demo");
  const store = loadStore();
  return {
    messages: tenant ? store.messages.filter((m) => m.tenantId === tenant.id) : [],
    mockLog: wa.outbox,
  };
});

app.get("/v1/events", async (req, reply) => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const tenant = tenantBySlug((req.query as { tenantSlug?: string }).tenantSlug || "belleza-demo");
  const send = () => {
    const store = loadStore();
    const events = tenant ? store.events.filter((e) => e.tenantId === tenant.id).slice(-20) : [];
    reply.raw.write(`data: ${JSON.stringify(events)}\n\n`);
  };
  send();
  const iv = setInterval(send, 5000);
  req.raw.on("close", () => clearInterval(iv));
});

const port = Number(process.env.PORT || 4001);
await app.listen({ port, host: "0.0.0.0" });
console.log(`Agenda API on :${port}`);
