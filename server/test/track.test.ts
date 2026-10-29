import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recomputeDirty } from '../src/services/stats.js';
import { loadSettings } from '../src/services/settings.js';
import { login, makeClock, makeConfigDir, setupApp, testDatabaseUrl, type TestClock, type TestEnv } from './helpers.js';

type Env = TestEnv & { clock: TestClock };

const CATEGORIES_JSON = JSON.stringify({
  rules: [
    { match: { app: 'Code' }, category: 'Productive' },
    { match: { app: 'Example Game' }, category: 'Gaming' },
    { match: { domain: 'github.com' }, category: 'Productive' },
    { match: { domain: 'youtube.com' }, category: 'Waste' },
  ],
});

const ev = (kind: string, iso: string, durationSec: number, data: Record<string, unknown>, key = `${kind}:${iso}`) => ({
  source: 'activitywatch', kind, ts: iso, durationSec, key, data,
});

describe.skipIf(!testDatabaseUrl)('tracking: ingest, stats, reports, labels', () => {
  let env: Env;
  let cookie: string;
  let token: string;
  let configDir: string;

  const post = (url: string, payload: unknown, headers: Record<string, string> = { cookie }) =>
    env.app.inject({ method: 'POST', url, headers, payload: payload as object });
  const get = (url: string) => env.app.inject({ method: 'GET', url, headers: { cookie } });
  const ingest = (events: unknown[], auth = `Bearer ${token}`) => post('/api/ingest/events', { events }, { authorization: auth });
  const ctx = async () => ({ pool: env.pool, configDir, now: env.clock.now, settings: await loadSettings(env.pool, configDir) });

  beforeEach(async () => {
    configDir = makeConfigDir();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${configDir}/categories.example.json`, CATEGORIES_JSON);
    env = (await setupApp({ clock: makeClock('2026-10-26T06:00:00Z'), configDir })) as Env;
    cookie = await login(env.app);
    token = ((await post('/api/devices', { name: 'Mac', kind: 'mac' })).json() as { token: string }).token;
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it('rejects ingest without a device token and with bad bodies', async () => {
    expect((await post('/api/ingest/events', { events: [] }, {})).statusCode).toBe(401);
    expect((await post('/api/ingest/events', { events: [ev('window', '2026-10-26T04:30:00Z', 60, { app: 'Code' })] }, { cookie })).statusCode).toBe(401);
    expect((await ingest([])).statusCode).toBe(400);
    expect((await ingest([{ source: 'nope', kind: 'x', ts: 'yesterday', key: 'k' }])).statusCode).toBe(400);
  });

  it('stores events and upserts the same key with a longer duration', async () => {
    const first = await ingest([ev('window', '2026-10-26T04:30:00Z', 60, { app: 'Code' }, 'w:1')]);
    expect(first.json()).toEqual({ received: 1, inserted: 1, updated: 0 });
    const grown = await ingest([ev('window', '2026-10-26T04:30:00Z', 600, { app: 'Code' }, 'w:1')]);
    expect(grown.json()).toEqual({ received: 1, inserted: 0, updated: 1 });
    const same = await ingest([ev('window', '2026-10-26T04:30:00Z', 600, { app: 'Code' }, 'w:1')]);
    expect(same.json()).toMatchObject({ inserted: 0, updated: 0 });
    const { rows } = await env.pool.query(`SELECT payload FROM events`);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ app: 'Code', duration: 600 });
  });

  it('marks touched days dirty and recomputes them', async () => {
    await ingest([ev('window', '2026-10-26T04:30:00Z', 1800, { app: 'Code' })]);
    expect((await env.pool.query('SELECT count(*)::int AS n FROM stats_dirty')).rows[0].n).toBe(1);
    expect(await recomputeDirty(await ctx())).toBe(1);
    expect((await env.pool.query('SELECT count(*)::int AS n FROM stats_dirty')).rows[0].n).toBe(0);
    const row = (await env.pool.query('SELECT totals FROM daily_stats')).rows[0];
    expect(row.totals.Productive).toBe(1800);
  });

  it('builds a report for today from windows, sites, idle time and timers', async () => {
    await ingest([
      ev('window', '2026-10-26T04:30:00Z', 1800, { app: 'Code' }),
      ev('window', '2026-10-26T05:00:00Z', 1800, { app: 'Google Chrome' }),
      ev('web', '2026-10-26T05:00:00Z', 900, { domain: 'github.com' }),
      ev('web', '2026-10-26T05:15:00Z', 900, { domain: 'youtube.com' }),
      ev('afk', '2026-10-26T05:30:00Z', 600, { status: 'afk' }),
      ev('window', '2026-10-26T05:40:00Z', 600, { app: 'Mystery Tool' }),
    ]);
    const r = (await get('/api/reports?range=today')).json();
    expect(r.totals).toMatchObject({ Productive: 2700, Waste: 900, Unlabeled: 600, Away: 600 });
    expect(r.productivePct).toBe(75);
    expect(r.series).toHaveLength(1);
    expect(r.topItems[0]).toMatchObject({ key: 'Code', category: 'Productive', seconds: 1800 });
    expect(r.unlabeled).toEqual([{ kind: 'app', key: 'Mystery Tool', category: 'Unlabeled', seconds: 600 }]);
    expect(r.longestFocusMin).toBe(45);
  });

  it('puts events on the right local day around midnight', async () => {
    // 2026-10-26T18:00Z = 23:30 IST on the 26th; 20:00Z = 01:30 IST on the 27th.
    env.clock.set('2026-10-27T05:00:00Z');
    await ingest([
      ev('window', '2026-10-26T18:00:00Z', 1800, { app: 'Code' }),
      ev('window', '2026-10-26T20:00:00Z', 1800, { app: 'Code' }),
    ]);
    await recomputeDirty(await ctx());
    const rows = (await env.pool.query(`SELECT to_char(local_date,'YYYY-MM-DD') AS d, totals FROM daily_stats ORDER BY local_date`)).rows;
    expect(rows.map((r) => [r.d, r.totals.Productive])).toEqual([['2026-10-26', 1800], ['2026-10-27', 1800]]);
  });

  it('splits an event that crosses midnight between both days', async () => {
    env.clock.set('2026-10-27T05:00:00Z');
    await ingest([ev('window', '2026-10-26T18:00:00Z', 3600, { app: 'Code' })]); // 23:30 -> 00:30 IST
    await recomputeDirty(await ctx());
    const rows = (await env.pool.query(`SELECT to_char(local_date,'YYYY-MM-DD') AS d, totals FROM daily_stats ORDER BY local_date`)).rows;
    expect(rows.map((r) => [r.d, r.totals.Productive])).toEqual([['2026-10-26', 1800], ['2026-10-27', 1800]]);
  });

  it('reports a week with lazily computed past days and a 6-month view grouped by week', async () => {
    await ingest([
      ev('window', '2026-10-23T04:30:00Z', 3600, { app: 'Code' }),
      ev('window', '2026-10-25T04:30:00Z', 1800, { app: 'Example Game' }),
      ev('window', '2026-10-26T04:30:00Z', 1200, { app: 'Code' }),
    ]);
    await env.pool.query('DELETE FROM stats_dirty'); // force the lazy path
    const week = (await get('/api/reports?range=week')).json();
    expect(week.series).toHaveLength(7);
    expect(week.totals).toMatchObject({ Productive: 4800, Gaming: 1800 });
    expect(week.series.find((s: { date: string }) => s.date === '2026-10-23').totals.Productive).toBe(3600);
    const half = (await get('/api/reports?range=6months')).json();
    expect(half.series.length).toBeLessThanOrEqual(27);
    expect(half.series.every((s: { date: string }) => new Date(`${s.date}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    expect(half.totals.Productive).toBe(4800);
    expect((await get('/api/reports?range=forever')).statusCode).toBe(400);
  });

  it('recomputes history when the player labels an app or site', async () => {
    await ingest([ev('window', '2026-10-26T04:30:00Z', 600, { app: 'Mystery Tool' })]);
    await recomputeDirty(await ctx());
    expect((await get('/api/reports?range=today')).json().totals.Unlabeled).toBe(600);

    expect((await post('/api/labels', { kind: 'app', value: 'Mystery Tool', category: 'Productive' })).statusCode).toBe(204);
    const after = (await get('/api/reports?range=today')).json();
    expect(after.totals).toMatchObject({ Productive: 600, Unlabeled: 0 });
    expect((await get('/api/labels')).json().labels).toEqual([{ kind: 'app', value: 'Mystery Tool', category: 'Productive' }]);

    expect((await post('/api/labels', { kind: 'app', value: 'X', category: 'Nonsense' })).statusCode).toBe(400);
    const del = await env.app.inject({ method: 'DELETE', url: '/api/labels?kind=app&value=Mystery%20Tool', headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect((await get('/api/reports?range=today')).json().totals.Unlabeled).toBe(600);
    const missing = await env.app.inject({ method: 'DELETE', url: '/api/labels?kind=app&value=Nope', headers: { cookie } });
    expect(missing.statusCode).toBe(404);
  });

  it('lowercases domain labels and applies them to subdomains', async () => {
    await ingest([
      ev('window', '2026-10-26T04:30:00Z', 600, { app: 'Google Chrome' }),
      ev('web', '2026-10-26T04:30:00Z', 600, { domain: 'docs.Example.com' }),
    ]);
    await post('/api/labels', { kind: 'domain', value: 'WWW.Example.com', category: 'Productive' });
    expect((await get('/api/reports?range=today')).json().totals.Productive).toBe(600);
  });

  it('includes manual timers (running ones up to now) and keeps them above sensors', async () => {
    await ingest([ev('window', '2026-10-26T04:30:00Z', 3600, { app: 'Code' })]);
    env.clock.set('2026-10-26T05:00:00Z');
    await post('/api/timers/start', { kind: 'lunch' });
    env.clock.set('2026-10-26T05:30:00Z');
    const r = (await get('/api/reports?range=today')).json();
    expect(r.totals).toMatchObject({ Productive: 1800, Neutral: 1800 });
  });

  it('device list shows last event time and counts', async () => {
    await ingest([ev('window', '2026-10-26T04:30:00Z', 60, { app: 'Code' })]);
    const d = (await get('/api/devices')).json().devices[0];
    expect(d.event_count).toBe(1);
    expect(d.last_event_at).not.toBeNull();
  });
});
