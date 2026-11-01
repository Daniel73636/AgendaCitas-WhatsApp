# Checklist de lanzamiento — AgendaCitas (`full-mvp`)

Úsalo en el entorno de producción, no en la demo local. Detalle de Meta: [WHATSAPP.md](WHATSAPP.md). Qué cambió en el código: [CHANGELOG_MEJORAS.md](CHANGELOG_MEJORAS.md).

## Secretos y `DEMO_MODE`

- [ ] `NODE_ENV=production`
- [ ] `DEMO_MODE=false` (o la variable ausente). Con `true` la API **no arranca** en producción: expone OTP `123456`, la cuenta demo y el pago simulado
- [ ] `AUTH_SECRET`, `FIELD_ENCRYPTION_KEY` e `INTERNAL_JOBS_SECRET` son aleatorios, largos y **distintos** de `.env.example` (mínimo 32, 32 y 16 caracteres)
- [ ] `WHATSAPP_WEBHOOK_VERIFY_TOKEN` es una cadena propia, la misma que se pega en Meta
- [ ] El archivo `.env` no está en git
- [ ] `AUTO_SEED` no importa en producción: el código no siembra aunque valga `true`

## Base de datos y proceso

- [ ] `DATABASE_URL` es PostgreSQL. PGlite no sirve para producción
- [ ] `pnpm db:migrate` aplicado. No correr `pnpm db:seed` en esa base
- [ ] `CORS_ORIGINS` es el origen HTTPS de la web (sin `*`)
- [ ] `PUBLIC_WEB_URL` es esa misma web, sin barra final (entra en los enlaces de WhatsApp)
- [ ] `TRUST_PROXY=true` solo detrás de un proxy propio
- [ ] API y web en HTTPS. La web de producción es `pnpm --filter @agenda/web build` y luego `start` (el service worker no se registra en `next dev`)
- [ ] La API hoy corre con `tsx` (`pnpm --filter @agenda/api start`). No hay imagen Docker de la app; solo Postgres y Redis en `docker-compose.yml`
- [ ] Si `REDIS_URL` está definido y `EMBEDDED_WORKER=false`, el worker debe estar vivo y llamar `POST /v1/internal/jobs/tick` con `x-internal-secret`
- [ ] `GET /health` y `GET /ready` en verde (ready comprueba la base)

## WhatsApp (Meta)

- [ ] App Business en Meta for Developers con el producto WhatsApp y un número verificado
- [ ] `WHATSAPP_MODE=cloud`
- [ ] `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_APP_SECRET` definidos (sin app secret la API no arranca en cloud)
- [ ] Webhook `https://<api>/v1/webhooks/whatsapp`, campo `messages`. Un POST sin `X-Hub-Signature-256` responde 403
- [ ] Plantillas aprobadas: `otp_code`, `appointment_confirmation`, `appointment_reminder_24h`, `appointment_reminder_6h`, `appointment_reminder_2h`, `appointment_rescheduled`, `appointment_canceled`, `waitlist_offer`, `review_request`
- [ ] `OTP_MODE=real`. Probar un código a un celular propio y los botones Confirmo / Cancelar

## Marca y negocio

La marca no es una variable de entorno. En el panel → Ajustes: logo (URL), portada (URL) y color `#rrggbb`.

- [ ] Logo, portada y color se ven en `/{slug}` y en el manifiesto de instalación
- [ ] Servicios, horarios y equipo publicados
- [ ] Política de cancelación y anticipos revisadas
- [ ] Política de privacidad enlazada en la reserva y consentimiento de la Ley 1581 obligatorio
- [ ] Cuenta owner real. No queda `admin@belleza-demo.com`

## Pagos (hoy y Wompi)

- [ ] `PAYMENTS_PROVIDER=none`. El público no puede confirmar un anticipo sin cobrar
- [ ] La ficha de la cita no muestra «Pagar ahora (simulado)»
- [ ] No poner `PAYMENTS_PROVIDER=wompi`: la API se niega a arrancar. Cuando exista la pasarela, el cobro debe entrar por `PaymentProvider` (hoy solo hay `mock`, y solo con `DEMO_MODE`)

## Comprobación rápida

- [ ] Reservar, recibir OTP real y confirmar
- [ ] Un hold vencido se cancela en el tick y el hueco vuelve a ofrecerse
- [ ] Reportes: CSV de ocupación, inasistencias y servicios
- [ ] Calendario: clic en un hueco del día, o «Crear» en la semana, abre la cita con esa hora
