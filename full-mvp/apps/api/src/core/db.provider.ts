import { Logger } from '@nestjs/common';
import { type DbHandle, createDb, isSeeded, migrate, seedDemo } from '@agenda/db';
import type { AppConfig } from '../common/config';

export const DB_HANDLE = Symbol('DB_HANDLE');

/** Crea la conexion (PostgreSQL real o PGlite embebido), aplica migraciones y siembra la demo si esta vacia. */
export async function createDbHandle(config: AppConfig): Promise<DbHandle> {
  const log = new Logger('DB');
  const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
  log.log(
    handle.kind === 'pg'
      ? 'Conectado a PostgreSQL (DATABASE_URL).'
      : `Usando PGlite (PostgreSQL embebido, ${config.pgliteDir ? `persistente en ${config.pgliteDir}` : 'EN MEMORIA: los datos se reinician'}).`,
  );
  const ran = await migrate(handle, (m) => log.log(m));
  if (ran.length) log.log(`Migraciones aplicadas: ${ran.join(', ')}`);
  if (config.autoSeed && !(await isSeeded(handle.db))) {
    log.log('Base vacia: sembrando datos de demostracion (belleza-demo)...');
    await seedDemo(handle.db, { fieldKey: config.fieldKey, publicWebUrl: config.publicWebUrl, log: (m) => log.log(m) });
  }
  return handle;
}
