import { createDb, migrate } from './client';
import { loadRootEnv } from './env';
import { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, DEMO_SLUG, isSeeded, seedDemo } from './seed';

loadRootEnv();

async function main() {
  const cmd = process.argv[2] ?? 'migrate';
  const url = process.env.DATABASE_URL || undefined;
  if (!url) {
    console.log('⚠ DATABASE_URL no definido: PGlite en memoria (los datos no persisten tras este comando).');
    console.log('  Define DATABASE_URL (docker compose up -d) o PGLITE_DIR para persistir.');
  }
  const handle = await createDb({ url, pgliteDir: process.env.PGLITE_DIR });
  try {
    if (cmd === 'reset') {
      console.log('Reiniciando esquema (DROP SCHEMA public CASCADE)...');
      await handle.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    const ran = await migrate(handle, console.log);
    console.log(ran.length ? `Migraciones aplicadas: ${ran.join(', ')}` : 'Esquema al dia.');
    if (cmd === 'seed' || cmd === 'reset') {
      if (cmd === 'seed' && (await isSeeded(handle.db))) {
        console.log(`El tenant "${DEMO_SLUG}" ya existe. Usa "pnpm db:reset" para reiniciar la base.`);
      } else {
        const r = await seedDemo(handle.db, { log: console.log });
        console.log(`✔ Semilla aplicada (${r.appointments} citas).`);
        console.log(`  Panel:   ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
        console.log(`  Publico: /${DEMO_SLUG}`);
      }
    }
  } finally {
    await handle.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
