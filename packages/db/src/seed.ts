import { resetStore, uid, type StoreData } from "./store.js";

const tenantId = uid();
const locId = uid();
const staff = [uid(), uid(), uid()];
const services = [uid(), uid(), uid(), uid(), uid()];

const data: StoreData = {
  tenants: [{ id: tenantId, name: "Belleza Demo", slug: "belleza-demo", timezone: "America/Bogota" }],
  locations: [{
    id: locId,
    tenantId,
    name: "Sede Centro",
    address: "Cra 50 #45-10, Medellín",
    timezone: "America/Bogota",
  }],
  staff: [
    { id: staff[0]!, tenantId, locationId: locId, displayName: "Ana Pérez", active: true },
    { id: staff[1]!, tenantId, locationId: locId, displayName: "Carlos Ruiz", active: true },
    { id: staff[2]!, tenantId, locationId: locId, displayName: "Laura Gómez", active: true },
  ],
  services: [
    { id: services[0]!, tenantId, name: "Corte mujer", description: "Corte y brush", durationMin: 45, bufferBeforeMin: 0, bufferAfterMin: 10, priceCents: 45000, currency: "COP", depositCents: 0, capacity: 1, visiblePublic: true },
    { id: services[1]!, tenantId, name: "Coloración", description: "Tinte completo", durationMin: 90, bufferBeforeMin: 5, bufferAfterMin: 15, priceCents: 120000, currency: "COP", depositCents: 20000, capacity: 1, visiblePublic: true },
    { id: services[2]!, tenantId, name: "Manicure", description: "Manicure clásico", durationMin: 40, bufferBeforeMin: 0, bufferAfterMin: 5, priceCents: 35000, currency: "COP", depositCents: 0, capacity: 1, visiblePublic: true },
    { id: services[3]!, tenantId, name: "Pedicure", description: "Pedicure spa", durationMin: 50, bufferBeforeMin: 0, bufferAfterMin: 5, priceCents: 45000, currency: "COP", depositCents: 0, capacity: 1, visiblePublic: true },
    { id: services[4]!, tenantId, name: "Barba", description: "Perfilado de barba", durationMin: 25, bufferBeforeMin: 0, bufferAfterMin: 5, priceCents: 25000, currency: "COP", depositCents: 0, capacity: 1, visiblePublic: true },
  ],
  staffServices: [
    { staffId: staff[0]!, serviceId: services[0]! },
    { staffId: staff[0]!, serviceId: services[1]! },
    { staffId: staff[0]!, serviceId: services[2]! },
    { staffId: staff[1]!, serviceId: services[0]! },
    { staffId: staff[1]!, serviceId: services[4]! },
    { staffId: staff[2]!, serviceId: services[2]! },
    { staffId: staff[2]!, serviceId: services[3]! },
  ],
  schedules: staff.flatMap((sid) =>
    [1, 2, 3, 4, 5, 6].map((weekday) => ({
      id: uid(),
      tenantId,
      staffId: sid,
      weekday,
      startTime: "09:00",
      endTime: "18:00",
    })),
  ),
  customers: [
    {
      id: uid(),
      tenantId,
      fullName: "María López",
      phoneE164: "+573001112233",
      noShowCount: 0,
      lateCancelCount: 0,
      tags: ["vip"],
    },
  ],
  appointments: [],
  messages: [],
  otps: {},
  events: [],
};

resetStore(data);
console.log("Seed OK — slug: belleza-demo");
