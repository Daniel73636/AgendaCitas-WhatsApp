# Checklist de lanzamiento — AgendaCitas (`full-mvp`)

Úsalo antes de abrir el enlace público de un negocio real. Marca cada ítem en el entorno de producción, no en la demo.

## Entorno

- [ ] `NODE_ENV=production`
- [ ] `DEMO_MODE` ausente o `false` (la API no arranca si está en `true`)
- [ ] `PAYMENTS_PROVIDER=none` (el mock solo existe con `DEMO_MODE`; no hay pasarela real)
- [ ] `DATABASE_URL` apunta a PostgreSQL (no PGlite)
- [ ] `AUTH_SECRET`, `FIELD_ENCRYPTION_KEY` e `INTERNAL_JOBS_SECRET` son largos y distintos a los de `.env.example`
- [ ] `CORS_ORIGINS` y `PUBLIC_WEB_URL` son el origen HTTPS de la web
- [ ] `TRUST_PROXY=true` solo si hay un proxy propio delante
- [ ] Migraciones aplicadas (`pnpm db:migrate`) y **sin** semilla demo

## WhatsApp

- [ ] `WHATSAPP_MODE=cloud` con phone number id, token y app secret
- [ ] Webhook verificado; un POST sin firma `X-Hub-Signature-256` responde 403
- [ ] Plantillas aprobadas: confirmación, recordatorios, reprogramación, cancelación, lista de espera, reseña y OTP
- [ ] El worker (o `EMBEDDED_WORKER`) llama `POST /v1/internal/jobs/tick` con el secreto interno

## Negocio

- [ ] Servicios, horarios y equipo publicados
- [ ] Logo, portada y color de marca en Ajustes; la página `/{slug}` los usa
- [ ] Política de cancelación y anticipos revisadas
- [ ] Enlace de privacidad visible en la reserva (Ley 1581) y consentimiento obligatorio
- [ ] Cuenta owner real; no queda `admin@belleza-demo.com`

## Comprobación rápida

- [ ] `GET /health` y `GET /ready` en verde
- [ ] Reservar un horario, recibir el código real y confirmar
- [ ] Sin `DEMO_MODE`, la ficha no ofrece «Pagar ahora (simulado)»
- [ ] Un hold vencido desaparece tras el tick y el hueco se puede volver a tomar
- [ ] Reportes: exportar CSV de ocupación, inasistencias y servicios
- [ ] Calendario: clic en un hueco del día, o «Crear» en la semana, abre la cita con esa hora
