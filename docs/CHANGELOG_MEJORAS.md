# Changelog de mejoras — AgendaCitas (`full-mvp`)

Rama: `feat/mejora-produccion-ux`. PR: https://github.com/Daniel73636/AgendaCitas-WhatsApp/pull/2

## Fase 4 — cierre de documentación

- Los README de la raíz y de `full-mvp/` enlazan checklist, changelog, WhatsApp, auditoría y decisiones.
- El checklist de lanzamiento cubre Meta, `DEMO_MODE=false`, secretos, el despliegue actual (tsx + Next) y que Wompi todavía no existe.
- `.env.example` documenta `DEMO_MODE`, el app secret de Meta, `PAYMENTS_PROVIDER` y que logo, portada y color se guardan en Ajustes, no en el entorno.

## Fase 3 — calendario, reportes y marca

- En el día, el **+** de cada profesional abre una cita a las 10:00 y el clic en un hueco sigue usando esa hora. En la semana, cada día tiene «Crear».
- `GET /v1/reports/export` devuelve un CSV (ocupación, inasistencias y servicios). El panel lo descarga. El archivo de otro negocio no incluye nombres ajenos.
- La página pública usa logo, portada y color de marca del tenant. El manifiesto de instalación toma ese color.
- Anticipo: interfaz `PaymentProvider`. `mock` solo con `DEMO_MODE`; `none` rechaza el cobro público; `wompi` no está implementado y la API no arranca si se pide.

## Fase 2 — reserva pública, recordatorios y holds

- La carga de horarios muestra error con **Reintentar**. El día vacío explica si no hay cupo ese día, con ese profesional o en las dos semanas, y ofrece la próxima fecha o la lista de espera.
- Textos de la reserva, la ficha pública, las plantillas de WhatsApp y el catálogo demo usan tildes del español de Colombia.
- El borrador del asistente se guarda en `localStorage` y se sincroniza entre pestañas. Un hold vencido no se restaura.
- La política de privacidad está enlazada en el formulario (casilla de la Ley 1581), en el asistente y en la confirmación.
- El botón «Pagar ahora (simulado)» solo aparece con `DEMO_MODE`. Sin ese modo, la cita pendiente pide coordinar el anticipo con el negocio.
- La confirmación y la ficha de la cita explican cuándo llegan los recordatorios. En el panel, el historial traduce el nombre de la plantilla y el simulador de botones queda oculto fuera de demo.
- El tick `POST /v1/internal/jobs/tick` libera holds vencidos (`held` y `pending`). Hay pruebas del secreto, de `hold_expired`, de que la restricción EXCLUDE vuelve a aceptar el hueco y de que una cita confirmada no se toca.

## Fase 1 — seguridad y fiabilidad

- Configuración validada con Zod, `DEMO_MODE` apagado por defecto, `/health` y `/ready`, correlation id, errores en español, cabeceras de seguridad y CORS por lista blanca.
- Auth con bcrypt (y migración desde scrypt), bloqueo por intentos, OTP con hash y código `123456` solo en demo.
- Webhook de WhatsApp con firma HMAC y tenant resuelto por la cita, no por «el primer negocio».
- Aislamiento de tenant en vínculos de profesionales, servicios y clientes, con pruebas de dos negocios.
- Ley 1581: página de privacidad, consentimiento obligatorio, exportar y suprimir datos del cliente (solo owner) y bitácora.
- CI (typecheck, test, build) y umbral estable de la prueba de rendimiento de `computeSlots`.

## Pendiente

- Sesión en cookie HttpOnly y CSRF.
- RLS de PostgreSQL y hash del cuerpo en `Idempotency-Key`.
- Pasarela Wompi real detrás de `PaymentProvider` (hoy `wompi` aborta el arranque).
- Compilar la API a `dist` y un Dockerfile de la app (compose solo levanta Postgres y Redis).
- Redis para rate limit y SSE con más de una instancia.
- Playwright y k6.

## Pasos manuales (Daniel)

1. En local: `cd full-mvp`, copiar `.env.example` a `.env`, dejar `DEMO_MODE=true` y `PAYMENTS_PROVIDER=mock` si quieres la cuenta demo y el OTP `123456`. `pnpm install`, `pnpm dev`. Pública: http://localhost:3100/belleza-demo · panel: http://localhost:3100/login.
2. Antes de mergear el PR #2, mira que el check `full-mvp` de GitHub Actions esté en verde (`pnpm test`, `pnpm typecheck`, `pnpm build`).
3. Para un negocio real, sigue [CHECKLIST_LANZAMIENTO.md](CHECKLIST_LANZAMIENTO.md): `DEMO_MODE=false`, secretos nuevos, Postgres, y WhatsApp cloud como en [WHATSAPP.md](WHATSAPP.md).
4. No pongas `PAYMENTS_PROVIDER=wompi`. El anticipo en producción se registra desde el panel hasta que exista la pasarela.
5. Logo, portada y color se cargan en Ajustes del panel, no en `.env`.
