import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from './db.js';

export const defaultMigrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

// Arbitrary constant: serialises concurrent migrators (e.g. two containers starting at once).
const LOCK_KEY = 727_001;

/** Applies pending `NNN_name.sql` files in order. Returns the names applied in this run. */
export async function migrate(pool: Pool, dir: string = defaultMigrationsDir): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return applied;
}
