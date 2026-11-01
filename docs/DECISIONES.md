# Decisiones de ingeniería — AgendaCitas

## 2026-11-01 — Base de trabajo

**Decisión:** Trabajar las mejoras de producción sobre `full-mvp/` (NestJS + Next + PGlite/Postgres) en la rama `feat/mejora-produccion-ux`. La versión ligera de la raíz (Fastify + JSON) se mantiene solo como demo rápida hasta promover `full-mvp` a la raíz en un PR posterior.

**Por qué:** `full-mvp` ya tiene dominio completo, e2e API y panel real; duplicar esfuerzo en la raíz sería peor.

## 2026-11-01 — Auth

**Decisión:** Sesiones con cookie HttpOnly + token opaco en Redis/PGlite table; bcrypt para contraseñas; OTP demo `123456` solo si `NODE_ENV=development` o `DEMO_MODE=true`.

## 2026-11-01 — Pagos

**Decisión:** Interfaz `PaymentProvider` con implementación `MockPaymentProvider` y stub `WompiPaymentProvider` detrás de `PAYMENTS_PROVIDER=mock|wompi`.

## 2026-11-01 — Test de performance de slots

**Decisión:** El umbral del test de `computeSlots` (1 mes × 10 profesionales) se fija en 500 ms por defecto (`SLOTS_PERF_MS`), no 50/250 ms rígidos. El objetivo de producto sigue siendo < 50 ms; el test evita flakiness en CI Windows.

## 2026-11-01 — Fase 1: alcance de auth y DEMO_MODE

**Decisión:** El OTP `123456` (y la cuenta demo, la semilla automática, el pago simulado y los simuladores de WhatsApp) solo existen con `DEMO_MODE=true`; ya **no** basta con `NODE_ENV=development` (corrige la decisión anterior). `DEMO_MODE` es `false` por defecto y la API se niega a arrancar con `NODE_ENV=production` + `DEMO_MODE=true`. `.env.example` lo activa para desarrollo.

**Por qué:** un entorno mal configurado no debe exponer credenciales ni códigos conocidos; hacerlo explícito es más seguro que inferirlo de `NODE_ENV`.

## 2026-11-01 — bcryptjs en lugar de bcrypt nativo

**Decisión:** Contraseñas con `bcryptjs` (JS puro, costo 12, configurable con `BCRYPT_ROUNDS`). Los hashes `scrypt` existentes se siguen aceptando y se **re-hashean a bcrypt en el siguiente login correcto**.

**Por qué:** sin compilación nativa funciona igual en Windows, CI y Docker alpine. El costo extra de CPU es aceptable para un login con límite de tasa.

## 2026-11-01 — Sesiones: Bearer ahora, cookie HttpOnly en Fase 2

**Decisión:** Se mantiene el token Bearer firmado (compatibilidad con el front y las pruebas) y se endurece el entorno que lo rodea (bloqueo de cuenta, CORS, cabeceras, CSP). El paso a cookie `HttpOnly` + CSRF queda para la Fase 2.

**Por qué:** es un cambio transversal de front y API; mezclarlo con aislamiento/auth/WhatsApp haría el lote difícil de revisar.

## 2026-11-01 — Bloqueo de login por correo (incluso inexistente)

**Decisión:** 5 intentos fallidos por correo ⇒ bloqueo de 15 min (`LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES`), contabilizado también para correos que no existen y con la misma respuesta, para no permitir enumerar cuentas. Además del límite por IP (que depende de `TRUST_PROXY`).

## 2026-11-01 — Webhook de WhatsApp

**Decisión:** Con `WHATSAPP_MODE=cloud` se exige `WHATSAPP_APP_SECRET` y se verifica `X-Hub-Signature-256` sobre el cuerpo crudo. Fuera de `cloud` el webhook solo responde con `DEMO_MODE=true`. El tenant se resuelve por la cita (botones) o por la conversación más reciente del número; nunca se asume “el primer tenant”. Un número de WhatsApp compartido por varios tenants es la limitación conocida (Fase 2: `phone_number_id` por tenant).

## 2026-11-01 — Ley 1581 (habeas data)

**Decisión:** La reserva pública y la lista de espera exigen `privacyAccepted=true` (`PRIVACY_CONSENT_REQUIRED`, activo por defecto) y se guarda `privacy_accepted_at` + `privacy_policy_version` por cliente. Exportar datos = JSON descargable; suprimir = anonimización (se conservan citas sin datos personales por trazabilidad contable, se borran mensajes, OTP y lista de espera). Ambos son solo *owner* y quedan en `audit_log` sin PII.
