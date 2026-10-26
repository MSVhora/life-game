import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDay } from '../src/services/engine.js';
import { runReminders, sendToAll, type PushSender, type PushSub } from '../src/services/push.js';
import { loadSettings } from '../src/services/settings.js';
import { login, makeClock, makeConfigDir, setupApp, testDatabaseUrl, type TestClock, type TestEnv } from './helpers.js';

type Env = TestEnv & { clock: TestClock };

class FakeSender implements PushSender {
  sent: Array<{ sub: PushSub; payload: { body: string } }> = [];
  failWith: number | null = null;
  async send(sub: PushSub, payload: string) {
    if (this.failWith) throw Object.assign(new Error('gone'), { statusCode: this.failWith });
    this.sent.push({ sub, payload: JSON.parse(payload) });
  }
}

describe.skipIf(!testDatabaseUrl)('push subscriptions and reminders', () => {
  let env: Env;
  let cookie: string;
  let sender: FakeSender;
  const configDir = makeConfigDir();

  const ctx = async () => ({ pool: env.pool, configDir, now: env.clock.now, settings: await loadSettings(env.pool, configDir) });

  beforeEach(async () => {
    sender = new FakeSender();
    env = (await setupApp({ clock: makeClock('2026-10-26T06:00:00Z'), configDir })) as Env;
    cookie = await login(env.app);
    await env.pool.query(`INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ('https://push.example/abc', 'k', 'a')`);
    await ensureDay(await ctx());
  });
  afterEach(async () => {
    await env.cleanup();
  });

  const at = (iso: string) => env.clock.set(iso);

  it('sends one reminder per threshold, never repeats', async () => {
    // day ends 17:30Z
    at('2026-10-26T10:00:00Z'); // 7.5h left: nothing
    expect(await runReminders(await ctx(), sender)).toBeNull();
    at('2026-10-26T12:00:00Z'); // 5.5h left
    expect(await runReminders(await ctx(), sender)).toBe('h6');
    expect(await runReminders(await ctx(), sender)).toBeNull();
    at('2026-10-26T15:45:00Z'); // 1.75h
    expect(await runReminders(await ctx(), sender)).toBe('h2');
    at('2026-10-26T17:10:00Z'); // 20 min
    expect(await runReminders(await ctx(), sender)).toBe('m30');
    expect(sender.sent.map((s) => s.payload.body)).toEqual([
      '6 hours left. 2 tasks to go.',
      '2 hours left. 2 tasks to go.',
      '30 minutes left. 2 tasks to go.',
    ]);
  });

  it('a late start sends only the most urgent reminder', async () => {
    at('2026-10-26T17:10:00Z');
    expect(await runReminders(await ctx(), sender)).toBe('m30');
    expect(sender.sent).toHaveLength(1);
    at('2026-10-26T17:20:00Z');
    expect(await runReminders(await ctx(), sender)).toBeNull();
  });

  it('stays quiet when all required tasks are done', async () => {
    await env.pool.query(`UPDATE tasks SET status = 'done' WHERE required`);
    at('2026-10-26T17:10:00Z');
    expect(await runReminders(await ctx(), sender)).toBeNull();
    expect(sender.sent).toHaveLength(0);
  });

  it('stays quiet on a paused day', async () => {
    await env.pool.query(`UPDATE days SET status = 'paused'`);
    at('2026-10-26T17:10:00Z');
    expect(await runReminders(await ctx(), sender)).toBeNull();
  });

  it('removes subscriptions the push service reports gone', async () => {
    sender.failWith = 410;
    expect(await sendToAll(env.pool, sender, { title: 't', body: 'b' })).toBe(0);
    const { rows } = await env.pool.query('SELECT count(*)::int AS n FROM push_subscriptions');
    expect(rows[0].n).toBe(0);
  });

  it('keeps subscriptions on temporary failures', async () => {
    sender.failWith = 500;
    await sendToAll(env.pool, sender, { title: 't', body: 'b' });
    const { rows } = await env.pool.query('SELECT count(*)::int AS n FROM push_subscriptions');
    expect(rows[0].n).toBe(1);
  });

  it('subscribe and unsubscribe endpoints validate and store', async () => {
    const sub = { endpoint: 'https://push.example/xyz', keys: { p256dh: 'p', auth: 'a' } };
    const post = (url: string, payload: unknown) => env.app.inject({ method: 'POST', url, headers: { cookie }, payload: payload as object });
    expect((await post('/api/push/subscribe', sub)).statusCode).toBe(204);
    expect((await post('/api/push/subscribe', sub)).statusCode).toBe(204); // idempotent
    expect((await post('/api/push/subscribe', { endpoint: 'not a url', keys: {} })).statusCode).toBe(400);
    expect((await env.pool.query(`SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = $1`, [sub.endpoint])).rows[0].n).toBe(1);
    expect((await post('/api/push/unsubscribe', { endpoint: sub.endpoint })).statusCode).toBe(204);
    expect((await env.pool.query(`SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = $1`, [sub.endpoint])).rows[0].n).toBe(0);
    expect((await env.app.inject({ method: 'POST', url: '/api/push/subscribe', payload: sub })).statusCode).toBe(401);
  });

  it('reports push as not configured without VAPID keys', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/push/key', headers: { cookie } });
    expect(res.statusCode).toBe(503);
  });
});
