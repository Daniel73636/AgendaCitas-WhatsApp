/**
 * apps/worker - planificador de trabajos (recordatorios, expiracion de holds, ofertas de lista de espera).
 *
 * Con REDIS_URL: usa BullMQ (cola "agenda-jobs" con un trabajo repetible "tick" y jobId determinista);
 * puede haber varias instancias del worker sin duplicar el trabajo.
 * Sin Redis: un setInterval en memoria (modo degradado). Ambos invocan la API (POST /v1/internal/jobs/tick),
 * que contiene la logica de negocio: cargar la cita, verificar estado/version y enviar por WhatsApp.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function loadRootEnv() {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      if (existsSync(join(dir, '.env'))) config({ path: join(dir, '.env') });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
loadRootEnv();

const API_URL = (process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4100}`).replace(/\/$/, '');
const SECRET = process.env.INTERNAL_JOBS_SECRET ?? 'dev-internal-secret';
const REDIS_URL = process.env.REDIS_URL;
const EVERY_MS = Number(process.env.WORKER_TICK_MS ?? 15_000);

async function tick(): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/v1/internal/jobs/tick`, { method: 'POST', headers: { 'x-internal-secret': SECRET } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) console.error(`[worker] tick fallo (${res.status})`, body);
    else {
      const r = body.reminders as { processed?: number; sent?: number } | undefined;
      if ((r?.processed ?? 0) > 0 || Number(body.holdsReleased) > 0) console.log('[worker] tick', JSON.stringify(body));
    }
  } catch (e) {
    console.error(`[worker] no se pudo contactar la API en ${API_URL}: ${(e as Error).message}`);
  }
}

async function main() {
  if (!REDIS_URL) {
    console.log(`[worker] REDIS_URL vacio: modo en memoria (setInterval cada ${EVERY_MS / 1000}s) -> ${API_URL}`);
    void tick();
    setInterval(() => void tick(), EVERY_MS);
    return;
  }
  const { Queue, Worker } = await import('bullmq');
  const { default: IORedis } = await import('ioredis');
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue('agenda-jobs', { connection });
  // jobId determinista: aunque arranquen N workers, existe un unico trabajo repetible
  await queue.upsertJobScheduler('tick', { every: EVERY_MS }, { name: 'tick', opts: { removeOnComplete: 20, removeOnFail: 50 } });
  const worker = new Worker('agenda-jobs', async (job) => (job.name === 'tick' ? tick() : undefined), { connection, concurrency: 1 });
  worker.on('failed', (job, err) => console.error('[worker] job fallo', job?.id, err.message));
  console.log(`[worker] BullMQ activo (Redis ${REDIS_URL}) cada ${EVERY_MS / 1000}s -> ${API_URL}`);
  const stop = async () => {
    await worker.close();
    await queue.close();
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
