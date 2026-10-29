# Agenda de citas con WhatsApp (Producto A) — MVP

PWA multiplataforma (**PC + Android**, instalable) para que un negocio de servicios (salón, barbería, consultorio…) reciba reservas en línea, evite dobles reservas y reduzca inasistencias con recordatorios por WhatsApp.

- **Cliente final**: página pública `/{slug}` → asistente de reserva de 4 pasos → verificación por celular (OTP) → confirmación; enlace firmado para ver, reprogramar o cancelar.
- **Negocio**: panel `/hoy`, `/calendario` (arrastrar y soltar), `/clientes`, `/mensajes` (bandeja WhatsApp), `/servicios`, `/equipo`, `/horarios`, `/reportes`, `/ajustes`.
- **Integridad**: el solape de citas lo impide **la propia base de datos** (`EXCLUDE USING gist`, SQLSTATE `23P01` → `409 SLOT_TAKEN`). Dinero siempre en **centavos enteros**.

> Datos demo: negocio **Belleza Demo** (`/belleza-demo`), 3 profesionales, 5 servicios, horarios Lun–Sáb, ~200 citas y mensajes de ejemplo.
> Panel: `admin@belleza-demo.com` / `demo1234` · Código OTP de prueba: **`123456`** · WhatsApp en modo **mock** (se registra en consola y en *Mensajes*).

---

## 1. Requisitos

| Herramienta | Versión |
|---|---|
| Node.js | 20 o superior (probado con 24) |
| pnpm | 9.x (`corepack enable` o `npm i -g pnpm@9`) |
| Docker (opcional) | Para PostgreSQL 16 + Redis 7 reales |

**No necesitas Docker para probarlo**: si no defines `DATABASE_URL`, la API usa **PGlite** (PostgreSQL embebido en WASM, con `btree_gist` y la restricción `EXCLUDE` reales), migra y siembra los datos demo al arrancar.

## 2. Inicio rápido (sin Docker)

```bash
pnpm install
pnpm dev            # API :4100  +  Web :3100  (en paralelo)
```

Abre:

| Qué | URL |
|---|---|
| Página pública del negocio | http://localhost:3100/belleza-demo |
| Reservar | http://localhost:3100/belleza-demo/reservar |
| Panel (Hoy) | http://localhost:3100/hoy → usa **“Entrar con la cuenta demo”** |
| API (salud) | http://localhost:4100/v1/health |

Los datos viven en memoria (se reinician al parar la API). Para persistirlos sin Docker: `PGLITE_DIR=./.data/pglite` en `.env`.

## 3. Con PostgreSQL y Redis reales (Docker)

```bash
cp .env.example .env             # en Windows: copy .env.example .env
docker compose up -d             # postgres:16 + redis:7
# En .env descomenta/define:
#   DATABASE_URL=postgres://agenda:agenda@localhost:5432/agenda
#   REDIS_URL=redis://localhost:6379      (opcional, para BullMQ)
pnpm db:migrate                  # aplica migraciones SQL (crea EXCLUDE gist + btree_gist)
pnpm db:seed                     # siembra “Belleza Demo”
pnpm dev
pnpm dev:worker                  # (opcional) worker BullMQ si usas Redis y EMBEDDED_WORKER=false
```

- ¿Puertos 5432/6379 ocupados? Define `POSTGRES_PORT` / `REDIS_PORT` y ajusta `DATABASE_URL`.
- `pnpm db:reset` borra el esquema `public`, migra y vuelve a sembrar.

### Probar desde un celular Android (misma red Wi-Fi)

1. `pnpm dev` en el PC. Averigua la IP del PC (ej. `192.168.1.20`).
2. En el celular abre `http://192.168.1.20:3100/belleza-demo`. La web calcula sola la URL de la API (mismo host, puerto 4100); puedes fijarla con `NEXT_PUBLIC_API_URL`.
3. **Instalar como app**: Chrome exige HTTPS u `localhost`. Opciones: (a) túnel HTTPS (`cloudflared tunnel --url http://localhost:3100`, `ngrok http 3100`) — ojo, entonces define `NEXT_PUBLIC_API_URL` apuntando a un túnel de la API; (b) `adb reverse tcp:3100 tcp:3100 && adb reverse tcp:4100 tcp:4100` y abre `http://localhost:3100` en el celular; (c) bandera de Chrome `unsafely-treat-insecure-origin-as-secure`.
4. El service worker solo se registra en **producción**: `pnpm build && pnpm --filter @agenda/web start`.
   Luego Chrome → menú ⋮ → *Instalar aplicación* (o el banner “Instalar” de la propia app).

## 4. Estructura del monorepo

```
full-mvp/
  apps/
    api/                 NestJS 11 + Fastify (módulos: public, auth, tenant, catalog/services, staff/schedules/time-off,
                         availability, appointments, customers, reminders, messaging, reports, waitlist, events SSE, webhooks)
    web/                 Next.js 15 (App Router) + Tailwind + TanStack Query + Zustand + dnd-kit  → PWA
    worker/              BullMQ (Redis) o setInterval → invoca POST /v1/internal/jobs/tick de la API
  packages/
    domain-booking/      PURO: computeSlots, zonas horarias/DST, estados, políticas, recordatorios, .ics  (+ tests Vitest/fast-check)
    contracts/           Esquemas Zod + tipos compartidos API ⇄ web
    db/                  Drizzle ORM (esquema), migraciones SQL (EXCLUDE gist), cliente pg/PGlite, seed, CLI
    whatsapp/            Plantillas en español, cliente Mock y Cloud API (Meta), parser de webhook (+ tests)
    ui/                  Componentes tipo shadcn (Button, Card, Modal, Field, Switch…)
  scripts/               smoke.mjs (prueba de humo de la API), generate-icons.mjs (iconos PWA)
  docker-compose.yml     PostgreSQL 16 + Redis 7
  .env.example
```

## 5. Arquitectura en 1 minuto

**Reserva sin carreras** (arquitectura §4.4)
1. `GET /v1/public/{slug}/availability` → `computeSlots` (puro, determinista, zona de la sede).
2. `POST …/holds` → crea cita `held` por 5 min con `INSERT`; la restricción **EXCLUDE** decide. Si dos personas chocan: `409 SLOT_TAKEN` + 3 alternativas. Con “cualquiera”, si el elegido se ocupa en la carrera se prueban los demás libres.
3. `POST …/otp/request` y `…/otp/verify` (mock: código `123456`).
4. `POST …/bookings` (cabecera `Idempotency-Key`) → en **una transacción** `held → confirmed` (o `pending` si hay anticipo), crea cliente, programa recordatorios (outbox) y emite SSE. Un doble clic no crea dos citas.
5. Los holds vencidos se liberan por **expiración perezosa** (al consultar) y por barrido periódico.

**Recordatorios** (§4.6): tabla `reminder_jobs` con `jobKey` determinista `apt:{id}:confirm|r24|r6|r2|review`. Reprogramar = descartar pendientes y recrear con la misma función; cancelar = cero pendientes. Antes de enviar, el handler recarga la cita y verifica **estado y versión**; ventana 7:00–21:00 hora local; reintentos; el barrido periódico es la red de seguridad. Botones de plantilla (*Confirmo / Reprogramar / Cancelar*) llegan por `POST /v1/webhooks/whatsapp`.

**Lista de espera** (§4.7): al cancelar/mover se ofrece el hueco a la primera entrada compatible con un hold de 10 min (`FOR UPDATE SKIP LOCKED`); si vence pasa a la siguiente; si acepta (`/cita/{token}` → “Lo quiero”) queda confirmada.

**Tiempo real** (§4.9): `GET /v1/events` (SSE, `?token=`), buffer por tenant con reanudación `Last-Event-ID`; el cliente invalida solo las consultas afectadas y cae a *polling* de 30 s si no hay SSE.

**Concurrencia en el panel**: `PATCH /v1/appointments/{id}` con `If-Match: <version>` → `412 VERSION_MISMATCH`; mover sobre otra cita → `409 SLOT_TAKEN`. El calendario revierte la actualización optimista y explica el motivo.

## 6. API (resumen)

Públicos (sin sesión, con límite de tasa y campo trampa anti-bots):

| Método y ruta | Descripción |
|---|---|
| `GET /v1/public/{slug}` | Negocio, servicios y profesionales visibles |
| `GET /v1/public/{slug}/availability?serviceIds=a,b&staffId=any&from=&to=` | Huecos libres |
| `POST /v1/public/{slug}/holds` · `DELETE …/holds/{id}` | Reserva temporal / liberar |
| `POST /v1/public/{slug}/otp/request` · `/otp/verify` | Verificación del celular |
| `POST /v1/public/{slug}/bookings` | Confirmar (Idempotency-Key) |
| `GET /v1/public/appointments/{token}` | Ver cita con enlace firmado |
| `POST /v1/public/appointments/{token}/reschedule` · `/cancel` · `/accept` · `/pay` | Reprogramar, cancelar (según política), aceptar oferta, pagar anticipo (simulado) |
| `POST /v1/public/{slug}/waitlist` | Lista de espera |

Privados (`Authorization: Bearer <token>` de `POST /v1/auth/login`; rol `owner` para configuración):

`GET/POST/PATCH /v1/appointments` · `POST /v1/appointments/{id}/check-in|complete|no-show|cancel|deposit` · `GET /v1/appointments/unconfirmed` · `GET/POST/PATCH /v1/customers` (+ `/timeline`, `/merge`) · `GET/POST/PATCH/DELETE /v1/services` · `GET/POST/PATCH /v1/staff` · `GET/PUT /v1/schedules` · `GET/POST/DELETE /v1/time-off` · `GET /v1/availability` · `GET /v1/reports/summary|no-shows|occupancy|revenue` · `GET /v1/messages` · `POST /v1/messages/reply` · `GET /v1/events` (SSE) · `GET/PATCH /v1/tenant` · `GET /v1/waitlist`.

Errores: `{ "error": { "code": "SLOT_TAKEN", "message": "…", "alternatives": [...] } }` con códigos estables (`VALIDATION_ERROR`, `UNAUTHORIZED`, `SLOT_TAKEN`, `HOLD_EXPIRED`, `VERSION_MISMATCH`, `INVALID_TRANSITION`, `POLICY_VIOLATION`, `OTP_INVALID`, `RATE_LIMITED`, …).

## 7. Pruebas

```bash
pnpm test                    # todo (turbo): domain-booking, whatsapp, api
pnpm test:domain             # solo computeSlots y dominio
pnpm typecheck               # TypeScript estricto en todos los paquetes
pnpm dev                     # y en otra terminal:
node scripts/smoke.mjs       # prueba de humo extremo a extremo contra la API en :4100
```

- **`packages/domain-booking`** (41 tests): grilla, bloques partidos, colchones, cadena de servicios, antelación mínima/máxima, bloqueos y aperturas extra, reparto “cualquiera” (menos cargado / preferencia), **DST** (salto y repetición de hora), servicios que cruzan medianoche, resultado **idéntico en cualquier zona del proceso**, rendimiento (1 mes × 10 profesionales) y **propiedades fast-check**: ningún hueco se solapa con una cita, todo hueco cabe en un bloque de trabajo, al reservar un hueco ya no se ofrece.
- **`apps/api`** (19 tests e2e, PGlite *o* PostgreSQL real con `TEST_DATABASE_URL=postgres://…`): flujo completo hold→OTP→reserva→reprogramar→cancelar, idempotencia, expiración de hold, anticipo→pago, políticas, `23P01` al insertar solapado saltándose la API, **200 reservas simultáneas sobre 20 huecos ⇒ exactamente 20 confirmadas, 0 solapadas, 180 `SLOT_TAKEN`**, `If-Match`/412, estados, recordatorios con **reloj simulado** (secuencia exacta, reprogramar la reemplaza, cancelar deja 0, versión obsoleta no se envía), lista de espera, reportes y SSE.
- **`packages/whatsapp`**: plantillas, payloads de botones, cliente Cloud API (fetch simulado), webhook.

## 8. Variables de entorno

Ver `.env.example` (comentado). Las más importantes: `DATABASE_URL`, `PGLITE_DIR`, `AUTO_SEED`, `REDIS_URL`, `AUTH_SECRET`, `FIELD_ENCRYPTION_KEY`, `OTP_MODE`/`OTP_MOCK_CODE`, `WHATSAPP_MODE` (`mock`|`cloud`), `EMBEDDED_WORKER`, `NEXT_PUBLIC_API_URL`.

### Conectar WhatsApp real (Cloud API de Meta)
1. Crea la app en Meta for Developers y agrega *WhatsApp*. Copia `Phone number ID` y un token permanente.
2. `.env`: `WHATSAPP_MODE=cloud`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
3. Webhook → `https://tu-dominio/v1/webhooks/whatsapp`.
4. Aprueba las plantillas (nombres en `packages/whatsapp/src/templates.ts`): `appointment_confirmation`, `appointment_reminder_24h`, `appointment_reminder_2h`, `appointment_rescheduled`, `appointment_canceled`, `waitlist_offer`, `review_request`, `otp_code`.
5. `OTP_MODE=real` para enviar códigos aleatorios por WhatsApp.

## 9. Decisiones y diferencias respecto a la especificación

- **Base “sin Docker”**: PGlite en lugar de un almacén en memoria: mismo SQL, mismas migraciones y la **misma restricción `EXCLUDE`** (no se simula en código).
- `occupied tstzrange` se expresa como `occupied_start/occupied_end` + `tstzrange(...)` dentro de la restricción (evita tipos personalizados en Drizzle). `customer_id` es nulo mientras el hold es anónimo. Migraciones SQL escritas a mano (Drizzle se usa para el esquema tipado y las consultas).
- Notas de clientes cifradas con AES-256-GCM a nivel de campo (`FIELD_ENCRYPTION_KEY`).
- El worker no duplica lógica: llama a la API (`/v1/internal/jobs/tick`); la API contiene el planificador (también embebido con `EMBEDDED_WORKER=true`).
- NestJS con inyección **explícita** (`@Inject`) para poder ejecutar con `tsx`/esbuild sin metadatos de decoradores.

## 10. Brechas conocidas (fuera del MVP)

- **CAPTCHA** real (hay límite de tasa por IP + campo trampa); firma `X-Hub-Signature-256` del webhook de Meta; Web Push (el service worker ya maneja `push`, falta el emisor VAPID).
- **Pasarela de pago real**: el pago del anticipo es simulado (`/pay`); paquetes/bonos y cierre de caja no implementados (solo comisiones por profesional en reportes).
- Varios servicios con profesionales **distintos y no contiguos** (hoy: cadena secuencial con un solo profesional); recursos/salas y capacidad > 1 (clases grupales) solo en el modelo de datos.
- Respaldo por SMS/correo cuando falla WhatsApp: se registra el fallo y se reintenta, sin canal alterno.
- RLS de PostgreSQL por `app.tenant_id` (hoy el aislamiento es por `tenant_id` en cada consulta + pruebas de rutas privadas); caché Redis de disponibilidad; pruebas Playwright/k6.
- Arrastrar y soltar probado por lógica y por las pruebas del endpoint de mover; no hay prueba E2E automatizada del gesto en el navegador. La vista de calendario no está virtualizada (se dibuja con CSS y pocas filas DOM).
- Tablero SSE en memoria (una instancia de API); para varias instancias usar Redis pub/sub.
