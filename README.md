# AgendaCitas — Agenda de citas con WhatsApp

PWA multiplataforma (**PC + Android**) para reservas públicas, panel del negocio y mensajería WhatsApp (modo mock).

Repositorio: https://github.com/Daniel73636/AgendaCitas-WhatsApp

## Documentación

- [Checklist de lanzamiento](docs/CHECKLIST_LANZAMIENTO.md)
- [Changelog de mejoras (fases 1–4)](docs/CHANGELOG_MEJORAS.md)
- [WhatsApp Cloud API](docs/WHATSAPP.md)
- [Auditoría de producción](docs/AUDITORIA.md)
- [Decisiones de ingeniería](docs/DECISIONES.md)

## Versión recomendada: `full-mvp/`

MVP completo (NestJS + Next.js PWA, 66 tests). Ver también el PR: https://github.com/Daniel73636/AgendaCitas-WhatsApp/pull/1

```bash
cd full-mvp
pnpm install
pnpm test
pnpm dev   # API :4100 + web :3100
```

- Pública: http://localhost:3100/belleza-demo
- Panel: http://localhost:3100/login → cuenta demo (`admin@belleza-demo.com` / `demo1234`)
- OTP: **123456**

## Versión ligera (raíz del repo)

API Fastify + store JSON (`apps/api` :4001, `apps/web` :3001). Útil como demo rápida.

```bash
pnpm install
pnpm --filter @agenda/db seed
pnpm --filter @agenda/api dev
pnpm --filter @agenda/web dev
```

- Pública: http://localhost:3001/belleza-demo
- Panel: http://localhost:3001/panel/hoy
- OTP: **123456**

## Multiplataforma

- **PC**: navegador (Chrome/Edge/Firefox)
- **Android**: abre la URL → menú → *Instalar app* / *Añadir a pantalla de inicio* (PWA)

## Flujos implementados

1. Catálogo público + equipo
2. Wizard: servicios → profesional → huecos → OTP → confirmación
3. Hold 5 minutos anti-doble-reserva
4. Cancelación por enlace
5. Panel: hoy, calendario, clientes, servicios, mensajes, reportes
6. SSE de eventos (`/v1/events`)

## Docker (infra)

```bash
docker compose up -d
```

La demo actual no exige Postgres; el store JSON vive en `data/agenda-store.json`.
