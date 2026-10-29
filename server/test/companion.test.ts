import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findWakeAfterGap } from '../src/services/phoneWake.js';
import { detectPhoneWake } from '../src/services/phoneWake.js';
import { loadSettings } from '../src/services/settings.js';
import { login, makeClock, makeConfigDir, setupApp, testDatabaseUrl, type TestClock, type TestEnv } from './helpers.js';

type Env = TestEnv & { clock: TestClock };
const H = 3_600_000;
const at = (iso: string) => Date.parse(iso);

describe('findWakeAfterGap', () => {
  const now = at('2026-10-26T06:00:00Z');
  const evt = (iso: string, mins = 0) => ({ start: at(iso), end: at(iso) + mins * 60_000 });

  it('returns when phone use resumed after a long quiet gap', () => {
    expect(findWakeAfterGap([evt('2026-10-25T20:00:00Z'), evt('2026-10-26T04:00:00Z'), evt('2026-10-26T04:10:00Z')], now)).toBe(at('2026-10-26T04:00:00Z'));
  });
  it('does not treat a long app session as sleep', () => {
    expect(findWakeAfterGap([evt('2026-10-25T20:00:00Z', 8 * 60), evt('2026-10-26T04:00:00Z')], now)).toBeNull();
  });
  it('ignores gaps shorter than three hours', () => {
    expect(findWakeAfterGap([evt('2026-10-26T01:00:00Z'), evt('2026-10-26T03:30:00Z')], now)).toBeNull();
  });
  it('ignores a wake that is too old to announce', () => {
    expect(findWakeAfterGap([evt('2026-10-24T01:00:00Z'), evt('2026-10-24T10:00:00Z')], now)).toBeNull();
  });
  it('uses the latest gap when there are several', () => {
    const spans = [evt('2026-10-25T10:00:00Z'), evt('2026-10-25T15:00:00Z'), evt('2026-10-25T16:00:00Z'), evt('2026-10-26T03:00:00Z')];
    expect(findWakeAfterGap(spans, now)).toBe(at('2026-10-26T03:00:00Z'));
  });
  it('has nothing to say while the quiet gap is still going on', () => {
    expect(findWakeAfterGap([evt('2026-10-25T20:00:00Z')], now)).toBeNull();
    expect(findWakeAfterGap([], now)).toBeNull();
  });
  it('allows a custom gap', () => {
    expect(findWakeAfterGap([evt('2026-10-26T01:00:00Z'), evt('2026-10-26T03:30:00Z')], now, 2 * H)).toBe(at('2026-10-26T03:30:00Z'));
  });
});

const CATEGORIES = JSON.stringify({ rules: [{ match: { app: 'Code' }, category: 'Productive' }, { match: { app: 'Clash of Clans' }, category: 'Gaming' }] });

describe.skipIf(!testDatabaseUrl)('Android companion', () => {
  let env: Env; let cookie: string; let token: string; let configDir: string;
  const dev = (path: string, method: 'GET' | 'POST' = 'GET', payload?: unknown) =>
    env.app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, payload: payload as object });
  const user = (path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', payload?: unknown) =>
    env.app.inject({ method, url: path, headers: { cookie }, payload: payload as object });
  const ingest = (events: unknown[]) => dev('/api/ingest/events', 'POST', { events });
  const phone = (kind: string, iso: string, durationSec: number, data: Record<string, unknown> = {}, key = `${kind}:${iso}:${JSON.stringify(data)}`) =>
    ({ source: 'android', kind, ts: iso, durationSec, key, data });
  const ctx = async () => ({ pool: env.pool, configDir, now: env.clock.now, settings: await loadSettings(env.pool, configDir) });

  beforeEach(async () => {
    configDir = makeConfigDir();
    writeFileSync(`${configDir}/categories.example.json`, CATEGORIES);
    env = (await setupApp({ clock: makeClock('2026-10-26T06:00:00Z'), configDir })) as Env;
    cookie = await login(env.app);
    token = ((await user('/api/devices', 'POST', { name: 'Pixel', kind: 'android' })).json() as { token: string }).token;
  });
  afterEach(async () => { await env.cleanup(); });

  it('serves status to a device token only', async () => {
    expect((await user('/api/device/status')).statusCode).toBe(401);
    const res = await dev('/api/device/status');
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({ timezone: 'Asia/Kolkata', baseline: false, pressure: 'gradual' });
    expect(s.day).toMatchObject({ status: 'open', tasksRequired: 2, requiredDone: 0 });
    expect(s.budget).toMatchObject({ capMinutes: 120, usedMinutes: 0 });
    expect(s.wake).toMatchObject({ goal: '12:00', today: null, source: 'manual' });
    expect(s.gamingApps).toEqual(['Clash of Clans']);
  });

  it('accepts phone events and counts phone time in reports', async () => {
    const r = await ingest([
      phone('app_usage', '2026-10-26T04:30:00Z', 1200, { app: 'Code', package: 'x.code' }),
      phone('app_usage', '2026-10-26T05:00:00Z', 900, { app: 'Mystery App', package: 'x.mystery' }),
      phone('unlock', '2026-10-26T04:29:00Z', 0),
    ]);
    expect(r.json()).toMatchObject({ received: 3, inserted: 3 });
    const rep = (await user('/api/reports?range=today')).json();
    expect(rep.totals).toMatchObject({ Productive: 1200, Unlabeled: 900 });
    expect(rep.unlabeled[0]).toMatchObject({ key: 'Mystery App' });
  });

  it('phone beats the Mac when both claim the same minutes', async () => {
    await dev('/api/ingest/events', 'POST', { events: [
      { source: 'activitywatch', kind: 'window', ts: '2026-10-26T04:30:00Z', durationSec: 3600, key: 'mac:1', data: { app: 'Code' } },
      phone('app_usage', '2026-10-26T04:50:00Z', 1200, { app: 'Clash of Clans' }),
    ] });
    const rep = (await user('/api/reports?range=today')).json();
    expect(rep.totals).toMatchObject({ Productive: 2400, Gaming: 1200 });
  });

  it('counts phone gaming against the game time budget', async () => {
    env.clock.set('2026-10-26T07:00:00Z');
    await ingest([phone('app_usage', '2026-10-26T06:00:00Z', 2400, { app: 'Clash of Clans' })]);
    const s = (await dev('/api/device/status')).json();
    expect(s.budget.usedMinutes).toBe(40);
    expect((await user('/api/state')).json().budget.usedMinutes).toBe(40);
  });

  it('lets the phone log wake and run timers', async () => {
    const wake = (await dev('/api/device/wake', 'POST')).json();
    expect(wake).toMatchObject({ alreadyLogged: false, xp: 15, beforeGoal: true });
    expect((await dev('/api/device/wake', 'POST')).json().alreadyLogged).toBe(true);

    expect((await dev('/api/device/timers/start', 'POST', { kind: 'work' })).statusCode).toBe(204);
    expect((await dev('/api/device/status')).json().timer).toMatchObject({ kind: 'work' });
    env.clock.advanceMs(20 * 60_000);
    expect((await dev('/api/device/timers/stop', 'POST')).json().stopped).toEqual({ kind: 'work', minutes: 20 });
    expect((await dev('/api/device/timers/start', 'POST', { kind: 'nope' })).statusCode).toBe(400);
  });

  it('detects the wake-up from phone use after a quiet night when the source is phone', async () => {
    await ingest([
      phone('screen_off', '2026-10-25T20:00:00Z', 0),
      phone('unlock', '2026-10-26T04:00:00Z', 0),
      phone('app_usage', '2026-10-26T04:01:00Z', 600, { app: 'Mystery App' }),
    ]);
    expect(await detectPhoneWake(await ctx())).toBeNull(); // source is still manual

    expect((await user('/api/profile', 'PUT', { wakeSource: 'phone' })).statusCode).toBe(200);
    const w = await detectPhoneWake(await ctx());
    expect(w).toMatchObject({ beforeGoal: true, xp: 15, alreadyLogged: false });
    expect(w!.wokeAt.toISOString()).toBe('2026-10-26T04:00:00.000Z'); // 09:30 IST
    const row = (await env.pool.query('SELECT woke_at, source FROM wake_logs')).rows[0];
    expect(row.source).toBe('phone');
    expect((await detectPhoneWake(await ctx()))!.alreadyLogged).toBe(true);
    expect((await user('/api/state')).json().wake.today).toBe('2026-10-26T04:00:00.000Z');
  });

  it('does not invent a wake-up from a night of one long session', async () => {
    await user('/api/profile', 'PUT', { wakeSource: 'phone' });
    await ingest([phone('app_usage', '2026-10-25T20:00:00Z', 8 * 3600, { app: 'Novel Reader' }), phone('unlock', '2026-10-26T04:30:00Z', 0)]);
    expect(await detectPhoneWake(await ctx())).toBeNull();
  });

  it('validates the wake source setting', async () => {
    expect((await user('/api/profile', 'PUT', { wakeSource: 'telepathy' })).statusCode).toBe(400);
  });
});
