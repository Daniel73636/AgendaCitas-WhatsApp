# Auditoría de producción — AgendaCitas (`full-mvp`)

- **Fecha:** 2026-11-01
- **Rama:** `feat/mejora-produccion-ux`
- **Alcance:** `full-mvp/` (NestJS 11 + Fastify, Next 15, Drizzle sobre PostgreSQL/PGlite, paquetes `domain-booking`, `contracts`, `db`, `whatsapp`, `ui`).
- **Método:** lectura completa de README, `package.json`/turbo, módulos de la API, auth, reserva pública, webhooks, esquema/migraciones, cliente de WhatsApp y las pantallas públicas del front; ejecución de `pnpm install / test / typecheck`.

## 0. Línea base (antes de cualquier cambio)

| Comando (desde `full-mvp/`) | Resultado |
|---|---|
| `pnpm install` | OK (lockfile al día, 9 proyectos) |
| `pnpm typecheck` | OK — 8/8 paquetes |
| `pnpm test` (1.ª corrida, en paralelo con otras tareas) | **FALLA**: `domain-booking › performance › un mes con 10 profesionales` tardó 444 ms vs. umbral de 250 ms. Turbo abortó el resto. |
| `pnpm turbo run test --continue` (2.ª corrida) | OK — domain-booking 41/41, whatsapp 6/6, api e2e 19/19 (66 pruebas) |

**Conclusión:** el único fallo es una **prueba de rendimiento flaky** (depende de la carga de la máquina). Es un riesgo de CI: se corrige con un umbral realista (ver plan).

No existe `lint` en ningún paquete, no hay CI, y `build` de la API es `tsc --noEmit` (la API se ejecuta con `tsx`).

## 1. Hallazgos principales (resumen)

1. **P0 — Webhook de WhatsApp sin verificar firma** (`X-Hub-Signature-256`) y con **resolución de tenant arbitraria**: `tenantForPhone` cae en *el primer tenant de la tabla* si el celular no existe. Cualquiera puede inyectar mensajes o pulsar “Cancelar” de una cita conociendo su UUID; los mensajes pueden quedar registrados en el negocio equivocado (fuga entre tenants).
2. **P0 — Valores por defecto inseguros en producción**: `AUTH_SECRET`, `FIELD_ENCRYPTION_KEY`, `INTERNAL_JOBS_SECRET` y el verify-token de Meta tienen valores por defecto públicos; no hay validación de entorno al arrancar; `OTP_MODE=mock` y `AUTO_SEED=true` por defecto ⇒ en un despliegue sin configurar existe el usuario `admin@belleza-demo.com / demo1234` y **el código OTP `123456` sirve para cualquier celular, incluso sin haberlo solicitado**.
3. **P0 — Pago de anticipo “simulado” abierto al público**: `POST /v1/public/appointments/:token/pay` confirma la cita sin cobrar nada. En producción permite saltarse el anticipo.
4. **P0 — Sin protección de fuerza bruta real en login**: solo límite por IP en memoria (10/min) y `trustProxy: true` fijo (cabecera `X-Forwarded-For` falsificable ⇒ el límite se evade). No hay bloqueo por cuenta.
5. **P1 — Aislamiento entre tenants**: las consultas principales filtran por `tenant_id`, pero hay brechas: vinculación `staff_services` con servicios sin validar pertenencia al tenant, `time-off`/lista de espera con `staffId` ajeno, `reply` con `appointmentId` ajeno, el borrado de `staff_services` sin `tenant_id`, `customers.merge` actualizando por `id` sin `tenant_id` en el `UPDATE`. No hay pruebas de aislamiento ni RLS.
6. **P1 — Cumplimiento Ley 1581 (Colombia)**: no hay política de privacidad, el consentimiento de tratamiento de datos no se exige ni se registra (solo la casilla de WhatsApp, opcional), no hay exportación ni supresión de datos de un cliente, los OTP se guardan en texto plano.
7. **P1 — Operación/observabilidad**: sin `/health` + `/ready` reales (solo `/v1/health` sin comprobar BD), sin *correlation id*, errores de Nest/Fastify (404 de ruta, JSON malformado, cuerpo demasiado grande) salen en inglés o como `500`, sin cabeceras de seguridad ni CORS restrictivo (vacío = refleja cualquier origen).
8. **P1 — Entrega**: sin CI, sin lint, `.env.example` incompleto (faltan `DEMO_MODE`, rate-limit/lockout, app secret de Meta, etc.), contraseñas con `scrypt` (válido) pero no `bcrypt` como se definió en `DECISIONES.md`.

## 2. Bugs / riesgos de fiabilidad

| ID | Prio | Hallazgo | Evidencia |
|---|---|---|---|
| B1 | P1 | Prueba de rendimiento flaky (444 ms vs 250 ms) rompe `pnpm test` y la CI. | `packages/domain-booking/test/slots.test.ts` |
| B2 | P1 | Errores de plataforma devuelven código/mensaje equivocado: `FST_ERR_*` (JSON inválido, 413) caen en la rama genérica ⇒ `500 INTERNAL`; 404 de ruta en inglés (“Cannot GET …”). | `common/errors.ts` |
| B3 | P1 | `Idempotency-Key` se reutiliza aunque cambie el cuerpo (devuelve la respuesta anterior). Mitigable con hash del cuerpo. | `appointments.service.ts › idempotent` |
| B4 | P2 | `GET /v1/time-off?from=` con fecha inválida produce `Invalid Date` (500 potencial). | `management.controllers.ts` |
| B5 | P2 | La API se ejecuta con `tsx` en producción (sin compilación) y `build` = `tsc --noEmit`. | `apps/api/package.json` |
| B6 | P2 | Bus SSE y rate limit en memoria: no funcionan con más de una instancia. Ya documentado en README. | `events.service.ts`, `rate-limit.ts` |
| B7 | P2 | `cancelInternal`/`noShowInternal` actualizan `customers` por `id` sin `tenant_id` (el id viene de una cita validada; defensa en profundidad). | `appointments.service.ts` |
| B8 | P2 | El token de sesión (HMAC, 12 h, sin revocación) no verifica que el usuario siga existiendo; vive en `localStorage` y en `?token=` para SSE (queda en logs). | `common/auth.ts`, `web/lib/session.ts` |

## 3. Riesgos de seguridad

| ID | Prio | Riesgo | Mitigación prevista |
|---|---|---|---|
| S1 | P0 | Webhook WhatsApp sin firma; tenant arbitrario; acción de botón sin comprobar que el celular corresponda a la cita. | Verificar `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET` (cuerpo crudo, HMAC-SHA256, comparación en tiempo constante); resolver tenant por cita/conversación, nunca “el primero”; exigir que el celular coincida; deshabilitar el webhook si no es modo `cloud` ni demo. |
| S2 | P0 | Secretos por defecto, sin validación de entorno. | Esquema `zod` al arrancar: en `NODE_ENV=production` exige secretos fuertes y distintos al valor de ejemplo, `CORS_ORIGINS`, `DATABASE_URL`, `DEMO_MODE=false`. |
| S3 | P0 | OTP mock aceptado sin solicitud y por defecto; usuarios demo sembrados por defecto. | `DEMO_MODE` explícito: sin él no hay OTP `123456`, ni semilla automática, ni botón de cuenta demo, ni simuladores. OTP real con hash en BD. |
| S4 | P0 | `/pay` simulado público. | Solo con `DEMO_MODE=true`; en producción el anticipo se registra desde el panel (o pasarela futura). |
| S5 | P0 | Sin bloqueo por intentos fallidos; `trustProxy` fijo. | Tabla `login_attempts` (bloqueo 15 min tras 5 fallos, también para correos inexistentes ⇒ sin enumeración), `bcrypt`, `TRUST_PROXY` configurable. |
| S6 | P1 | CORS abierto, sin cabeceras de seguridad (API y web). | Lista blanca por entorno; `nosniff`, `frame-ancestors`, HSTS (prod), `Referrer-Policy`, CSP en la web. |
| S7 | P1 | Brechas de aislamiento (ver §1.5). | Validar pertenencia de FKs lógicas; `tenant_id` en todos los `UPDATE/DELETE`; suite de pruebas con dos tenants. |
| S8 | P1 | Datos personales: OTP en claro, sin consentimiento de tratamiento registrado, sin exportar/suprimir. | Hash de OTP, `privacy_accepted_at/version`, endpoints exportar/suprimir (solo *owner*) con bitácora `audit_log`. |
| S9 | P2 | Sin RLS de PostgreSQL ni claves foráneas compuestas `(tenant_id, id)`. | Fase 2: RLS por `app.tenant_id`. |
| S10 | P2 | `INTERNAL_JOBS_SECRET` se compara sin tiempo constante. | `timingSafeEqual`. |
| S11 | P2 | Sesión en `localStorage` (XSS ⇒ robo de token). | Fase 2: cookie `HttpOnly` + CSRF (decisión ya registrada en `DECISIONES.md`). |
| S12 | P2 | `reply` permite escribir a cualquier número (el panel). | Limitar a números con conversación previa o consentimiento. |

## 4. UX

| ID | Prio | Hallazgo |
|---|---|---|
| U1 | P1 | Falta página de privacidad y enlace desde el formulario; la casilla de WhatsApp no equivale a la autorización de tratamiento de datos (Ley 1581). |
| U2 | P1 | La pantalla de login muestra siempre “Entrar con la cuenta demo” (con credenciales en el código del cliente) aunque el servidor esté en producción. |
| U3 | P2 | Copy en español sin tildes ni “ñ” (“Contrasena”, “Codigo”, “sesion”, “En linea”). Corregir al tocar cada pantalla. |
| U4 | P2 | El asistente de reserva ya persiste el borrador (sessionStorage), tiene temporizador de hold, `.ics` y alternativas cuando el cupo se ocupa; falta un estado de error con “Reintentar” cuando falla la carga de disponibilidad y un estado vacío más claro por dispositivo. Revisar en Fase 2. |
| U5 | P2 | El mensaje “Pagar anticipo (simulado)” es visible a clientes reales. |
| U6 | P2 | Errores de red/servidor llegan crudos (`Error 500`) en algunos flujos. |

## 5. Plan priorizado

### Fase 1 (esta entrega) — seguridad y fiabilidad
1. Configuración validada con `zod` + `DEMO_MODE`; `/health`, `/ready`; *correlation id*; errores estructurados en español.
2. Cabeceras de seguridad (API + web) y CORS por lista blanca.
3. Autenticación: `bcrypt` (con migración transparente de `scrypt`), bloqueo por intentos, límites de OTP, OTP demo solo con `DEMO_MODE=true`, OTP con hash.
4. Aislamiento de tenants: correcciones + pruebas Vitest con dos tenants.
5. WhatsApp: firma del webhook, cliente Cloud API con *timeouts*/reintentos tras `WHATSAPP_MODE=cloud`, `docs/WHATSAPP.md`.
6. Ley 1581: `/privacidad`, consentimiento obligatorio y registrado, exportar/suprimir datos del cliente (solo *owner*), bitácora.
7. CI (GitHub Actions: lint, typecheck, test, build), lint, `.env.example` completo, prueba de rendimiento estable.

### Fase 2 (siguiente)
- UX de reserva: estados de carga/vacío/error con reintento, textos con tildes, `.ics` también en la ficha pública y en el correo/WhatsApp, persistencia del asistente entre pestañas.
- Sesiones en cookie `HttpOnly` + CSRF; revocación y rotación de tokens.
- RLS en PostgreSQL y FKs compuestas por tenant; hash del cuerpo en `Idempotency-Key`.
- Pasarela de pagos real detrás de `PAYMENTS_PROVIDER` (Wompi) y eliminación del pago simulado de la UI pública.
- Compilar la API (`tsc` → `dist`) y Dockerfile; Redis para rate limit y SSE multi-instancia.
- Pruebas E2E (Playwright) del flujo público y del panel; k6 de carga.
