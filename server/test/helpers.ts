import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

export const TEST_PASSWORD = 'correct horse battery staple';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export interface TestEnv {
  app: FastifyInstance;
  pool: Pool;
  config: Config;
  cleanup: () => Promise<void>;
}

/** Builds the app against a throwaway Postgres schema so tests never touch real data. */
export async function setupApp(overrides: Record<string, string> = {}): Promise<TestEnv> {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
  const schema = `t_${randomUUID().replace(/-/g, '')}`;
  const admin = createPool(testDatabaseUrl, { max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const pool = createPool(testDatabaseUrl, { options: `-c search_path=${schema}` });
  await migrate(pool);

  const config = loadConfig({
    DATABASE_URL: testDatabaseUrl,
    SESSION_SECRET: 'a'.repeat(16) + 'b'.repeat(16) + 'xyz',
    ADMIN_PASSWORD_HASH: await hashPassword(TEST_PASSWORD),
    PUBLIC_URL: 'http://localhost:3000',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
  const app = await buildApp({ config, pool });
  await app.ready();

  return {
    app,
    pool,
    config,
    cleanup: async () => {
      await app.close();
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    },
  };
}

/** Logs in and returns the Cookie header value for later requests. */
export async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: TEST_PASSWORD },
  });
  const set = res.cookies.find((c) => c.name === 'lg_session');
  if (!set) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return `${set.name}=${set.value}`;
}
