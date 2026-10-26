import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate.js';
import { login, setupApp, testDatabaseUrl, TEST_PASSWORD, type TestEnv } from './helpers.js';

describe.skipIf(!testDatabaseUrl)('API (needs TEST_DATABASE_URL)', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await setupApp();
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('GET /health reports ok with the database up', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: true });
  });

  it('migrations are idempotent and create the core tables', async () => {
    expect(await migrate(env.pool)).toEqual([]);
    const { rows } = await env.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      'devices', 'events', 'time_blocks', 'days', 'tasks', 'task_markers',
      'budget_days', 'xp_ledger', 'adjustments', 'pause_days', 'settings', 'schema_migrations',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('rejects wrong passwords and protects routes', async () => {
    const bad = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'definitely not it' },
    });
    expect(bad.statusCode).toBe(401);
    expect((await env.app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await env.app.inject({ method: 'GET', url: '/api/devices' })).statusCode).toBe(401);
  });

  it('rejects a tampered session cookie', async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `lg_session=${Date.now() + 1e9}.forgedsignature` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logs in with the right password and reaches protected routes', async () => {
    const cookie = await login(env.app);
    const res = await env.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });

  it('creates, uses and revokes a device token', async () => {
    const cookie = await login(env.app);
    const created = await env.app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { cookie },
      payload: { name: 'Test phone', kind: 'android' },
    });
    expect(created.statusCode).toBe(201);
    const { id, token } = created.json<{ id: string; token: string }>();
    expect(token).toMatch(/^lg_/);

    // Only the hash is stored.
    const stored = await env.pool.query('SELECT token_hash FROM devices WHERE id = $1', [id]);
    expect(stored.rows[0].token_hash).not.toBe(token);

    const ok = await env.app.inject({
      method: 'GET',
      url: '/api/device/ping',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, device: 'Test phone' });

    const wrong = await env.app.inject({
      method: 'GET',
      url: '/api/device/ping',
      headers: { authorization: 'Bearer lg_not-a-real-token' },
    });
    expect(wrong.statusCode).toBe(401);

    const revoke = await env.app.inject({
      method: 'DELETE',
      url: `/api/devices/${id}`,
      headers: { cookie },
    });
    expect(revoke.statusCode).toBe(204);

    const after = await env.app.inject({
      method: 'GET',
      url: '/api/device/ping',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('a device token cannot manage devices, and a session cannot act as a device', async () => {
    const cookie = await login(env.app);
    const { token } = (
      await env.app.inject({
        method: 'POST',
        url: '/api/devices',
        headers: { cookie },
        payload: { name: 'Mac agent', kind: 'mac' },
      })
    ).json<{ token: string }>();

    const asDevice = await env.app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asDevice.statusCode).toBe(401);

    const asUser = await env.app.inject({
      method: 'GET',
      url: '/api/device/ping',
      headers: { cookie },
    });
    expect(asUser.statusCode).toBe(401);
  });

  it('validates device creation input', async () => {
    const cookie = await login(env.app);
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { cookie },
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rate-limits repeated failed logins', async () => {
    const fresh = await setupApp();
    try {
      let last = 0;
      for (let i = 0; i < 7; i++) {
        const res = await fresh.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { password: `wrong-${i}` },
        });
        last = res.statusCode;
      }
      expect(last).toBe(429);
      // Even the right password is refused while limited.
      const right = await fresh.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: TEST_PASSWORD },
      });
      expect(right.statusCode).toBe(429);
    } finally {
      await fresh.cleanup();
    }
  });

  it('enforces events idempotency per device in the schema', async () => {
    const dev = await env.pool.query<{ id: string }>(
      `INSERT INTO devices (name, token_hash) VALUES ('d', 'hash-idem') RETURNING id`,
    );
    const id = dev.rows[0]!.id;
    const insert = () =>
      env.pool.query(
        `INSERT INTO events (device_id, source, kind, ts, idempotency_key)
         VALUES ($1, 'manual_timer', 'timer_start', now(), 'k1')`,
        [id],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });
});
