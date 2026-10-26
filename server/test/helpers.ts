import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
export interface TestClock {
  now: Date;
  advanceMs(ms: number): void;
  set(iso: string): void;
}

export function makeClock(iso = '2026-10-26T06:00:00Z'): TestClock {
  const c: TestClock = {
    now: new Date(iso),
    advanceMs(ms) { c.now = new Date(c.now.getTime() + ms); },
    set(v) { c.now = new Date(v); },
  };
  return c;
}

export const DEFAULT_PLAYER_YAML = `timezone: Asia/Kolkata
day: { ends_at: "23:00", tasks_required: 2, grace_days_per_week: 1 }
gaming: { daily_cap_minutes: 120, minutes_per_task: 60, loss_penalty: halve_next_day }
wake: { goal_before: "12:00", final_goal: "09:00", ramp_minutes_per_week: 15 }
pressure: { level: gradual }
ramp: { max_tasks_per_day: 5, raise_after_days_met: 5 }
`;

export const DEFAULT_QUESTS_YAML = `templates:
  - { id: kickoff, title: "Kickoff: open the laptop", minutes: 2, xp: 10 }
  - { id: log-application, title: "Log 1 application", minutes: 15, xp: 40 }
  - { id: add-company, title: "Add 1 company", minutes: 10, xp: 20 }
  - { id: study-block, title: "One study block", minutes: 25, xp: 30 }
`;

export function makeConfigDir(player = DEFAULT_PLAYER_YAML, quests = DEFAULT_QUESTS_YAML): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lg-test-cfg-'));
  writeFileSync(path.join(dir, 'player.example.yml'), player);
  writeFileSync(path.join(dir, 'quests.example.yml'), quests);
  return dir;
}

export interface SetupOptions {
  env?: Record<string, string>;
  clock?: TestClock;
  configDir?: string;
}

export async function setupApp(options: SetupOptions | Record<string, string> = {}): Promise<TestEnv & { clock: TestClock }> {
  const opts: SetupOptions = 'env' in options || 'clock' in options || 'configDir' in options ? (options as SetupOptions) : { env: options as Record<string, string> };
  const overrides = opts.env ?? {};
  const clock = opts.clock ?? makeClock();
  const configDir = opts.configDir ?? makeConfigDir();
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
  const app = await buildApp({ config, pool, configDir, clock: () => clock.now });
  await app.ready();

  return {
    app,
    pool,
    config,
    clock,
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
