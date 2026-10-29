import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Carga el .env de la raiz del monorepo (sube directorios hasta encontrar pnpm-workspace.yaml). */
export function loadRootEnv(from: string = process.cwd()): void {
  let dir = resolve(from);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const envFile = join(dir, '.env');
      if (existsSync(envFile)) config({ path: envFile });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
