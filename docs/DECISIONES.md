# Decisiones de ingeniería — AgendaCitas

## 2026-11-01 — Base de trabajo

**Decisión:** Trabajar las mejoras de producción sobre `full-mvp/` (NestJS + Next + PGlite/Postgres) en la rama `feat/mejora-produccion-ux`. La versión ligera de la raíz (Fastify + JSON) se mantiene solo como demo rápida hasta promover `full-mvp` a la raíz en un PR posterior.

**Por qué:** `full-mvp` ya tiene dominio completo, e2e API y panel real; duplicar esfuerzo en la raíz sería peor.

## 2026-11-01 — Auth

**Decisión:** Sesiones con cookie HttpOnly + token opaco en Redis/PGlite table; bcrypt para contraseñas; OTP demo `123456` solo si `NODE_ENV=development` o `DEMO_MODE=true`.

## 2026-11-01 — Pagos

**Decisión:** Interfaz `PaymentProvider` con implementación `MockPaymentProvider` y stub `WompiPaymentProvider` detrás de `PAYMENTS_PROVIDER=mock|wompi`.
