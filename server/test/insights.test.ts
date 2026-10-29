import { createServer, type Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMarkers, evidenceFor } from '../src/services/markers.js';
import { loadSettings } from '../src/services/settings.js';
import { recomputeDirty } from '../src/services/stats.js';
import { login, makeClock, makeConfigDir, setupApp, testDatabaseUrl, type TestClock, type TestEnv } from './helpers.js';

type Env = TestEnv & { clock: TestClock };

const QUESTS = `templates:
  - { id: kickoff, title: "Kickoff", minutes: 2, xp: 10, evidence: [ { type: mac_active, min_minutes: 2 } ] }
  - { id: log-application, title: "Log 1 application", minutes: 15, xp: 40, evidence: [ { type: csv_new_row, source: applications_csv }, { type: site_visit, domains: [example-jobs.com], min_seconds: 30 } ] }
  - { id: add-company, title: "Add 1 company", minutes: 10, xp: 20 }
  - { id: study-block, title: "One study block", minutes: 25, xp: 30 }
  - { id: commit-code, title: "Commit code", minutes: 20, xp: 30, evidence: [ { type: git_commit, source: my_repo } ] }
`;
const CATEGORIES = JSON.stringify({ rules: [{ match: { app: 'Code' }, category: 'Productive' }, { match: { domain: 'example-jobs.com' }, category: 'Productive' }] });
const CLIENTS = `currency: INR
clients:
  - { name: "Client A", hourly_rate: 4000, monthly_cap: 50000, timetracker_project: "client-a" }
  - { name: "Client B", hourly_rate: 1000, monthly_cap: 10000, timetracker_project: "client-b" }
`;

const ev = (source: string, kind: string, iso: string, durationSec: number, data: Record<string, unknown>, key = `${kind}:${iso}:${JSON.stringify(data)}`) =>
  ({ source, kind, ts: iso, durationSec, key, data });

async function makeEnv(extraEnv: Record<string, string> = {}): Promise<{ env: Env; cookie: string; token: string; configDir: string }> {
  const configDir = makeConfigDir(undefined, QUESTS);
  writeFileSync(`${configDir}/categories.example.json`, CATEGORIES);
  writeFileSync(`${configDir}/clients.example.yml`, CLIENTS);
  const env = (await setupApp({ clock: makeClock('2026-10-26T06:00:00Z'), configDir, env: extraEnv })) as Env;
  const cookie = await login(env.app);
  const dev = await env.app.inject({ method: 'POST', url: '/api/devices', headers: { cookie }, payload: { name: 'Mac', kind: 'mac' } });
  return { env, cookie, token: (dev.json() as { token: string }).token, configDir };
}

describe.skipIf(!testDatabaseUrl)('activity markers', () => {
  let env: Env; let cookie: string; let token: string; let configDir: string;
  const ctx = async () => ({ pool: env.pool, configDir, now: env.clock.now, settings: await loadSettings(env.pool, configDir) });
  const ingest = (events: unknown[]) => env.app.inject({ method: 'POST', url: '/api/ingest/events', headers: { authorization: `Bearer ${token}` }, payload: { events } });
  const state = async () => (await env.app.inject({ method: 'GET', url: '/api/state', headers: { cookie } })).json();
  /** Replaces the dealt tasks with specific template ids so the tests do not depend on rotation. */
  const dealTasks = async (templates: Array<[string, number | null]>) => {
    const st = await state();
    await env.pool.query('DELETE FROM tasks WHERE day_id = $1', [st.day.id]);
    const ids: number[] = [];
    for (const [tpl, minutes] of templates) {
      const r = await env.pool.query(`INSERT INTO tasks (day_id, template_id, title, planned_minutes, xp, reward_minutes, required) VALUES ($1, $2, $2, $3, 10, 30, true) RETURNING id`, [st.day.id, tpl, minutes]);
      ids.push(Number(r.rows[0].id));
    }
    return ids;
  };
  const markersOf = async (id: number) => (await env.pool.query('SELECT type, ref FROM task_markers WHERE task_id = $1 ORDER BY id', [id])).rows;

  beforeEach(async () => { ({ env, cookie, token, configDir } = await makeEnv()); });
  afterEach(async () => { await env.cleanup(); });

  it('falls back to a sensible rule for unknown tasks and none for bonus tasks', () => {
    expect(evidenceFor('bonus', 10, new Map())).toEqual([]);
    expect(evidenceFor('mystery', 10, new Map())).toEqual([{ type: 'active_time', categories: ['Productive'], min_minutes: 8 }]);
    expect(evidenceFor('mystery', null, new Map())[0]!.min_minutes).toBe(12);
    expect(evidenceFor('kickoff', 2, new Map())[0]!.type).toBe('mac_active');
  });

  it('marks the kickoff when the Mac has been used', async () => {
    const [kick] = await dealTasks([['kickoff', 2]]);
    await ingest([ev('activitywatch', 'window', '2026-10-26T05:00:00Z', 60, { app: 'Code' })]);
    expect(await runMarkers(await ctx())).toBe(0); // one minute is not enough
    await ingest([ev('activitywatch', 'window', '2026-10-26T05:10:00Z', 300, { app: 'Code' })]);
    expect(await runMarkers(await ctx())).toBe(1);
    expect(await markersOf(kick!)).toEqual([{ type: 'mac_active', ref: 'Mac in use' }]);
    expect(await runMarkers(await ctx())).toBe(0); // idempotent
  });

  it('detects new CSV rows against the count before the day began', async () => {
    const [apply] = await dealTasks([['log-application', 15]]);
    await ingest([ev('folder', 'csv_rows', '2026-10-25T10:00:00Z', 0, { source: 'applications_csv', rows: 5 })]);
    await ingest([ev('folder', 'csv_rows', '2026-10-26T05:00:00Z', 0, { source: 'applications_csv', rows: 5 })]);
    expect(await runMarkers(await ctx())).toBe(0); // nothing new yet
    await ingest([ev('folder', 'csv_rows', '2026-10-26T05:30:00Z', 0, { source: 'applications_csv', rows: 6 })]);
    expect(await runMarkers(await ctx())).toBe(1);
    expect(await markersOf(apply!)).toEqual([{ type: 'csv_new_row', ref: '1 new row' }]);
  });

  it('with no earlier count, only a later increase counts', async () => {
    const [apply] = await dealTasks([['log-application', 15]]);
    await ingest([ev('folder', 'csv_rows', '2026-10-26T05:00:00Z', 0, { source: 'applications_csv', rows: 9 })]);
    expect(await runMarkers(await ctx())).toBe(0);
    await ingest([ev('folder', 'csv_rows', '2026-10-26T05:10:00Z', 0, { source: 'applications_csv', rows: 11 })]);
    await runMarkers(await ctx());
    expect((await markersOf(apply!))[0]).toEqual({ type: 'csv_new_row', ref: '2 new rows' });
  });

  it('matches job-site visits, ignoring short glances and other sites', async () => {
    const [apply] = await dealTasks([['log-application', 15]]);
    await ingest([
      ev('activitywatch', 'web', '2026-10-26T05:00:00Z', 10, { domain: 'example-jobs.com' }),
      ev('activitywatch', 'web', '2026-10-26T05:01:00Z', 600, { domain: 'other.example' }),
    ]);
    expect(await runMarkers(await ctx())).toBe(0);
    await ingest([ev('activitywatch', 'web', '2026-10-26T05:20:00Z', 120, { domain: 'jobs.example-jobs.com' })]);
    expect(await runMarkers(await ctx())).toBe(1);
    expect((await markersOf(apply!))[0]).toEqual({ type: 'site_visit', ref: 'jobs.example-jobs.com' });
  });

  it('matches folder changes, git commits and productive time', async () => {
    const [study, commit] = await dealTasks([['study-block', 25], ['commit-code', 20]]);
    await ingest([
      ev('folder', 'folder_change', '2026-10-26T05:00:00Z', 0, { source: 'prep_folder', files: 2 }),
      ev('folder', 'git_commit', '2026-10-26T05:05:00Z', 0, { repo: 'my_repo' }, 'c1'),
      ev('folder', 'git_commit', '2026-10-26T05:06:00Z', 0, { repo: 'other_repo' }, 'c2'),
      ev('activitywatch', 'window', '2026-10-26T04:00:00Z', 1500, { app: 'Code' }),
    ]);
    await runMarkers(await ctx());
    expect((await markersOf(study!)).map((m) => m.type).sort()).toEqual(['active_time', 'folder_change']);
    expect(await markersOf(commit!)).toEqual([{ type: 'git_commit', ref: '1 commit' }]);
  });

  it('skips finished tasks and never completes anything by itself', async () => {
    const [kick] = await dealTasks([['kickoff', 2]]);
    await env.pool.query(`UPDATE tasks SET status = 'done' WHERE id = $1`, [kick]);
    await ingest([ev('activitywatch', 'window', '2026-10-26T05:00:00Z', 600, { app: 'Code' })]);
    expect(await runMarkers(await ctx())).toBe(0);
    await env.pool.query(`UPDATE tasks SET status = 'pending' WHERE id = $1`, [kick]);
    await runMarkers(await ctx());
    expect((await env.pool.query('SELECT status FROM tasks WHERE id = $1', [kick])).rows[0].status).toBe('pending');
  });

  it('shows markers on the task in the state', async () => {
    const [kick] = await dealTasks([['kickoff', 2]]);
    await ingest([ev('activitywatch', 'window', '2026-10-26T05:00:00Z', 600, { app: 'Code' })]);
    await runMarkers(await ctx());
    const st = await state();
    expect(st.tasks.find((t: { id: number }) => t.id === kick).markers).toEqual([{ type: 'mac_active', ref: 'Mac in use' }]);
  });
});

describe.skipIf(!testDatabaseUrl)('baseline week', () => {
  let env: Env; let cookie: string; let token: string; let configDir: string;
  const ctx = async () => ({ pool: env.pool, configDir, now: env.clock.now, settings: await loadSettings(env.pool, configDir) });
  const call = (method: 'GET' | 'POST', url: string, payload?: unknown) => env.app.inject({ method, url, headers: { cookie }, payload: payload as object });
  const state = async () => (await call('GET', '/api/state')).json();

  beforeEach(async () => { ({ env, cookie, token, configDir } = await makeEnv()); });
  afterEach(async () => { await env.cleanup(); });

  it('starts a tracking-only week: tasks are blocked, nothing is penalised or counted', async () => {
    await state();
    const started = (await call('POST', '/api/baseline/start')).json();
    expect(started.baseline).toMatchObject({ active: true, dayNumber: 1, totalDays: 7, endsOn: '2026-11-01' });
    const st = await state();
    expect(st.day.status).toBe('paused');
    expect(st.baseline.active).toBe(true);
    expect(st.crew[0].text).toMatch(/Baseline week/);
    const task = st.tasks.find((t: { required: boolean }) => t.required);
    expect((await call('POST', `/api/tasks/${task.id}/complete`)).statusCode).toBe(409);

    env.clock.advanceMs(25 * 3_600_000);
    const next = await state();
    expect(next.day.status).toBe('paused');
    expect(next.player.streak).toBe(0);
    expect(next.baseline.dayNumber).toBe(2);
    expect((await call('POST', '/api/baseline/start')).json().baseline.dayNumber).toBe(2); // starting twice changes nothing
  });

  it('finishes by itself after seven days and then plays normally', async () => {
    await call('POST', '/api/baseline/start');
    env.clock.advanceMs(8 * 24 * 3_600_000);
    const st = await state();
    expect(st.baseline).toMatchObject({ active: false, status: 'done' });
    expect(st.day.status).toBe('open');
    expect(st.crew[0].text).not.toMatch(/Baseline week/);
  });

  it('can be skipped, which reopens today', async () => {
    await call('POST', '/api/baseline/start');
    expect((await state()).day.status).toBe('paused');
    const end = (await call('POST', '/api/baseline/end', { skip: true })).json();
    expect(end.baseline.status).toBe('skipped');
    expect((await state()).day.status).toBe('open');
  });

  it('does not reopen a day the player paused themselves', async () => {
    await state();
    await call('POST', '/api/pause', { reason: 'illness' });
    await call('POST', '/api/baseline/start');
    await call('POST', '/api/baseline/end', { skip: false });
    expect((await state()).day.status).toBe('paused');
  });

  it('summarises wake times, focus, gaming start and suggests a task length', async () => {
    await call('POST', '/api/baseline/start');
    const ingest = (events: unknown[]) => env.app.inject({ method: 'POST', url: '/api/ingest/events', headers: { authorization: `Bearer ${token}` }, payload: { events } });
    await ingest([
      ev('activitywatch', 'window', '2026-10-26T04:30:00Z', 40 * 60, { app: 'Code' }),
      ev('activitywatch', 'window', '2026-10-26T06:00:00Z', 30 * 60, { app: 'Example Game' }),
    ]);
    await env.pool.query(`INSERT INTO app_labels (kind, value, category) VALUES ('app', 'Example Game', 'Gaming')`);
    await env.pool.query(`INSERT INTO wake_logs (local_date, woke_at) VALUES ('2026-10-26', '2026-10-26T08:00:00Z'), ('2026-10-27', '2026-10-27T09:00:00Z')`); // 13:30 and 14:30 IST
    env.clock.set('2026-10-27T10:00:00Z');
    await recomputeDirty(await ctx());
    const s = (await call('GET', '/api/baseline')).json().summary;
    expect(s.wake).toMatchObject({ loggedDays: 2, medianMinutes: 14 * 60, spreadMinutes: 60 });
    expect(s.longestFocusMedianMin).toBe(40);
    expect(s.suggestedTaskMinutes).toBe(20);
    expect(s.gamingStartMedianMinutes).toBe(11 * 60 + 30); // 06:00Z is 11:30 IST
    expect(s.totals.Productive).toBe(2400);
    expect(s.productivePct).toBe(57);
  });

  it('has no summary before a baseline exists', async () => {
    const r = (await call('GET', '/api/baseline')).json();
    expect(r).toEqual({ baseline: null, summary: null });
  });
});

interface FakeEntry { id: string; start: string; end: string | null; project_id: string; billable: boolean }

function fakeSolidtime(entries: FakeEntry[], opts: { token?: string } = {}): Promise<{ server: Server; url: string; hits: string[] }> {
  const hits: string[] = [];
  const token = opts.token ?? 'tok_test_123';
  const server = createServer((req, res) => {
    hits.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 401; return res.end('{}'); }
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/api/v1/users/me/memberships') return res.end(JSON.stringify({ data: [{ organization: { id: 'org1' } }] }));
    if (url.pathname === '/api/v1/organizations/org1/time-entries') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return res.end(JSON.stringify({ data: entries.slice(offset, offset + limit), meta: { total: entries.length } }));
    }
    if (url.pathname === '/api/v1/organizations/org1/projects') return res.end(JSON.stringify({ data: [{ id: 'p1', name: 'client-a', client_id: 'c1' }, { id: 'p2', name: 'Side project', client_id: null }] }));
    if (url.pathname === '/api/v1/organizations/org1/clients') return res.end(JSON.stringify({ data: [{ id: 'c1', name: 'Client A Ltd' }] }));
    res.statusCode = 404;
    res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`, hits })));
}

describe.skipIf(!testDatabaseUrl)('freelance meter (fake Solidtime)', () => {
  let env: Env; let cookie: string; let st: Awaited<ReturnType<typeof fakeSolidtime>>;
  const entries: FakeEntry[] = [
    { id: 'e1', start: '2026-10-20T04:00:00Z', end: '2026-10-20T05:30:00Z', project_id: 'p1', billable: true },
    { id: 'e2', start: '2026-10-21T04:00:00Z', end: '2026-10-21T06:00:00Z', project_id: 'p1', billable: true },
    { id: 'e3', start: '2026-10-22T04:00:00Z', end: '2026-10-22T05:00:00Z', project_id: 'p2', billable: true },
    { id: 'e4', start: '2026-10-26T05:30:00Z', end: null, project_id: 'p1', billable: true }, // running, 30 min at "now"
    { id: 'e5', start: '2026-10-23T04:00:00Z', end: '2026-10-23T05:00:00Z', project_id: 'p1', billable: false },
  ];
  const call = (method: 'GET' | 'POST', url: string) => env.app.inject({ method, url, headers: { cookie } });

  afterEach(async () => { await env?.cleanup(); st?.server.close(); });

  async function setup(e = entries, token = 'tok_test_123') {
    st = await fakeSolidtime(e);
    ({ env, cookie } = await makeEnv({ TIMETRACKER_API_URL: st.url, TIMETRACKER_API_TOKEN: token }));
  }

  it('is off without configuration and says so', async () => {
    ({ env, cookie } = await makeEnv());
    expect((await call('POST', '/api/freelance/sync')).statusCode).toBe(503);
    const s = (await call('GET', '/api/freelance')).json();
    expect(s.configured).toBe(false);
    expect(s.clients.map((c: { name: string }) => c.name)).toEqual(['Client A', 'Client B']);
  });

  it('ignores placeholder values from .env.example', async () => {
    ({ env, cookie } = await makeEnv({ TIMETRACKER_API_URL: 'https://time.example.com/api', TIMETRACKER_API_TOKEN: 'change-me' }));
    expect((await call('POST', '/api/freelance/sync')).statusCode).toBe(503);
  });

  it('syncs entries and computes hours, money and what is left of the cap', async () => {
    await setup();
    const res = await call('POST', '/api/freelance/sync');
    expect(res.statusCode).toBe(200);
    const s = res.json();
    const a = s.clients.find((c: { name: string }) => c.name === 'Client A');
    expect(a).toMatchObject({ hours: 4, earned: 16000, cap: 50000, capHours: 12.5, remainingHours: 8.5, pctOfCap: 32 });
    expect(s.clients.find((c: { name: string }) => c.name === 'Client B')).toMatchObject({ hours: 0, earned: 0 });
    expect(s.unmatched).toEqual([{ name: 'Side project', hours: 1 }]);
    expect(s.totals).toMatchObject({ hours: 4, earned: 16000 });
    expect(s.configured).toBe(true);
    expect(st.hits.some((h) => h.includes('/time-entries'))).toBe(true);
  });

  it('adds finished entries to the time blocks as Productive and keeps re-syncs idempotent', async () => {
    await setup();
    await call('POST', '/api/freelance/sync');
    await call('POST', '/api/freelance/sync');
    const blocks = await env.pool.query(`SELECT category, source, label FROM time_blocks WHERE external_id IS NOT NULL`);
    expect(blocks.rows).toHaveLength(4); // the running entry is not a block yet
    expect(blocks.rows.every((b) => b.category === 'Productive' && b.source === 'timetracker')).toBe(true);
    expect((await env.pool.query('SELECT count(*)::int AS n FROM freelance_entries')).rows[0].n).toBe(5);
  });

  it('shows freelance time in the productive totals for its day', async () => {
    await setup();
    env.clock.set('2026-10-26T12:00:00Z');
    await call('POST', '/api/freelance/sync');
    const week = (await call('GET', '/api/reports?range=week')).json();
    const day = week.series.find((d: { date: string }) => d.date === '2026-10-21');
    expect(day.totals.Productive).toBe(2 * 3600);
  });

  it('reports a rejected token clearly', async () => {
    await setup(entries, 'wrong_token_value');
    st.server.close();
    st = await fakeSolidtime(entries); // server expects tok_test_123, app was configured differently below
    await env.cleanup();
    ({ env, cookie } = await makeEnv({ TIMETRACKER_API_URL: st.url, TIMETRACKER_API_TOKEN: 'not_the_token' }));
    const res = await call('POST', '/api/freelance/sync');
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toMatch(/refused the API token/);
  });

  it('pages through more than 500 entries', async () => {
    const many: FakeEntry[] = Array.from({ length: 620 }, (_, i) => ({
      id: `m${i}`, start: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T0${i % 9}:00:00Z`, end: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T0${i % 9}:30:00Z`, project_id: 'p1', billable: true,
    }));
    await setup(many);
    await call('POST', '/api/freelance/sync');
    expect((await env.pool.query('SELECT count(*)::int AS n FROM freelance_entries')).rows[0].n).toBe(620);
  });
});
