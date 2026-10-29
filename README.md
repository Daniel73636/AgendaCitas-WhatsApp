# AgendaCitas — Agenda de citas con WhatsApp

PWA multiplataforma (**PC + Android**) para reservas públicas, panel del negocio y mensajería WhatsApp (modo mock).

Repositorio: https://github.com/Daniel73636/AgendaCitas-WhatsApp

## Stack

- TypeScript
- API Fastify modular (`apps/api`) — puerto **4001**
- Next.js 15 App Router PWA (`apps/web`) — puerto **3001**
- Dominio puro `@agenda/domain-booking` (`computeSlots`)
- Persistencia JSON local (demo) + `docker-compose` Postgres/Redis listos para producción
- WhatsApp Cloud API en modo **mock**

## Arranque rápido

```bash
pnpm install
pnpm --filter @agenda/db seed
pnpm --filter @agenda/domain-booking test
pnpm --filter @agenda/api dev
# otra terminal
pnpm --filter @agenda/web dev
```

Abre:

- Pública: http://localhost:3001/belleza-demo
- Reservar: http://localhost:3001/belleza-demo/reservar
- Panel: http://localhost:3001/panel/hoy

OTP demo: **123456**

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
