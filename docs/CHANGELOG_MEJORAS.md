# Changelog de mejoras — AgendaCitas (`full-mvp`)

Rama: `feat/mejora-produccion-ux`.

## Fase 2 — reserva pública, recordatorios y holds

- La carga de horarios muestra error con **Reintentar**. El día vacío explica si no hay cupo ese día, con ese profesional o en las dos semanas, y ofrece la próxima fecha o la lista de espera.
- Textos de la reserva, la ficha pública, las plantillas de WhatsApp y el catálogo demo usan tildes del español de Colombia.
- El borrador del asistente se guarda en `localStorage` y se sincroniza entre pestañas. Un hold vencido no se restaura.
- La política de privacidad sigue enlazada en el formulario (casilla de la Ley 1581) y también en el asistente y en la confirmación.
- El botón «Pagar ahora (simulado)» solo aparece con `DEMO_MODE`. Sin ese modo, la cita pendiente pide coordinar el anticipo con el negocio.
- La confirmación y la ficha de la cita explican cuándo llegan los recordatorios de WhatsApp. En el panel, el historial traduce el nombre de la plantilla y el simulador de botones queda oculto fuera de demo.
- El tick `POST /v1/internal/jobs/tick` ya liberaba holds vencidos (`held` y `pending`) y la disponibilidad ya los excluía. Hay pruebas de secreto interno, de que el barrido cancela la fila (`hold_expired`), de que la restricción EXCLUDE vuelve a aceptar el hueco, de que no se repite, y de que una cita confirmada no se toca.
- No se hizo creación rápida en la vista día del calendario del negocio: el cambio era grande frente al asistente y a los recordatorios.

## Fase 1 — seguridad y fiabilidad

- Configuración validada con Zod, `DEMO_MODE` apagado por defecto, `/health` y `/ready`, correlation id, errores en español, cabeceras de seguridad y CORS por lista blanca.
- Auth con bcrypt (y migración desde scrypt), bloqueo por intentos, OTP con hash y código `123456` solo en demo.
- Webhook de WhatsApp con firma HMAC y tenant resuelto por la cita, no por «el primer negocio».
- Aislamiento de tenant en vínculos de profesionales, servicios y clientes, con pruebas de dos negocios.
- Ley 1581: página de privacidad, consentimiento obligatorio, exportar y suprimir datos del cliente (solo owner) y bitácora.
- CI (lint, typecheck, test, build) y umbral estable de la prueba de rendimiento de `computeSlots`.

## Pendiente (fuera de esta entrega)

- Sesión en cookie HttpOnly y CSRF.
- RLS de PostgreSQL y clave de idempotencia con hash del cuerpo.
- Pasarela real (Wompi), compilación de la API a `dist`, Redis para rate limit y SSE, Playwright y k6.
- Creación rápida al tocar un hueco en la vista día del calendario.
