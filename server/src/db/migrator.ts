import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

// server/db/migrations: two levels up from src/db/migrator.ts, one level up once bundled into dist/*.js.
export const MIGRATIONS_DIR =
  [new URL('../../db/migrations', import.meta.url), new URL('../db/migrations', import.meta.url)]
    .map((u) => fileURLToPath(u))
    .find((dir) => fs.existsSync(dir)) ?? fileURLToPath(new URL('../../db/migrations', import.meta.url));

/** Apply every not-yet-applied db/migrations/*.sql file in name order, each in its own transaction. */
export async function runMigrations(
  pool: pg.Pool,
  log: (msg: string) => void = console.log,
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`applied ${file}`);
      done.push(file);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  log('migrations up to date');
  return done;
}
