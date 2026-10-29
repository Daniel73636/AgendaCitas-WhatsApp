import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { migrations } from './migrations';
import { schema } from './schema';

export type Schema = typeof schema;
/** Base de datos o transaccion: ambas exponen la misma API de consultas. */
export type Db = PgDatabase<any, Schema>;
export type DbKind = 'pg' | 'pglite';

export interface DbHandle {
  db: Db;
  kind: DbKind;
  /** Ejecuta SQL crudo (multiples sentencias, sin parametros). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** postgres://... Si falta, se usa PGlite (PostgreSQL embebido). */
  url?: string | undefined;
  /** Carpeta de persistencia PGlite. Vacio = memoria. */
  pgliteDir?: string | undefined;
}

export async function createDb(opts: CreateDbOptions = {}): Promise<DbHandle> {
  if (opts.url) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString: opts.url, max: 10 });
    const db = drizzle(pool, { schema }) as unknown as Db;
    return {
      db,
      kind: 'pg',
      exec: async (sql) => {
        await pool.query(sql);
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite(opts.pgliteDir || undefined, { extensions: { btree_gist } });
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as Db;
  return {
    db,
    kind: 'pglite',
    exec: async (sql) => {
      await client.exec(sql);
    },
    close: () => client.close(),
  };
}

/** Aplica migraciones pendientes (idempotente). */
export async function migrate(handle: DbHandle, log: (m: string) => void = () => {}): Promise<string[]> {
  await handle.exec(`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());`);
  const res = await handle.db.execute(sql`SELECT name FROM _migrations`);
  const rows = ((res as unknown as { rows?: Array<{ name: string }> }).rows ?? (res as unknown as Array<{ name: string }>)) as Array<{ name: string }>;
  const applied = new Set(rows.map((r) => r.name));
  const ran: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    log(`Aplicando migracion ${m.name}...`);
    await handle.exec(`BEGIN;\n${m.sql}\nINSERT INTO _migrations (name) VALUES ('${m.name}');\nCOMMIT;`);
    ran.push(m.name);
  }
  return ran;
}

/** Extrae el SQLSTATE aunque Drizzle envuelva el error original (cause). */
export function pgErrorCode(err: unknown): string | undefined {
  let cur: any = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (typeof cur.code === 'string' && /^[0-9A-Z]{5}$/.test(cur.code)) return cur.code;
    cur = cur.cause;
  }
  return undefined;
}

/** 23P01 = exclusion_violation; 23505 = unique_violation. */
export const isExclusionViolation = (e: unknown): boolean => pgErrorCode(e) === '23P01';
export const isUniqueViolation = (e: unknown): boolean => pgErrorCode(e) === '23505';
