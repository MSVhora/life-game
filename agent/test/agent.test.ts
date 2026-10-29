import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { convertEvent, type AwBucket, type OutEvent } from '../src/aw.js';
import { DEFAULT_IGNORE, loadConfig, type AgentConfig } from '../src/config.js';
import { countCsvRows, emptyFolderState, gitCommitsSince, isIgnored, scanFolder } from '../src/folders.js';
import { emptyState, FatalError, loadState, saveState, syncOnce } from '../src/sync.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'lg-agent-'));
const T0 = Date.parse('2026-10-26T04:30:00Z');
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();

interface AwEvt { id: number; timestamp: string; duration: number; data: Record<string, unknown> }

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

async function fakeAw(buckets: Record<string, { type: string; events: AwEvt[] }>) {
  const requests: string[] = [];
  const state = { buckets };
  const h = await listen((req, res) => {
    requests.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/api/0/buckets/') {
      return res.end(JSON.stringify(Object.fromEntries(Object.entries(state.buckets).map(([id, b]) => [id, { id, type: b.type, client: 'test' }]))));
    }
    const m = /^\/api\/0\/buckets\/([^/]+)\/events$/.exec(url.pathname);
    const bucket = m && state.buckets[decodeURIComponent(m[1]!)];
    if (!bucket) { res.statusCode = 404; return res.end('{}'); }
    const start = url.searchParams.get('start');
    const limit = Number(url.searchParams.get('limit') ?? -1);
    let list = [...bucket.events].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)); // newest first, like AW
    if (start) list = list.filter((e) => Date.parse(e.timestamp) >= Date.parse(start));
    if (limit >= 0) list = list.slice(0, limit);
    res.end(JSON.stringify(list));
  });
  return { ...h, state, requests };
}

async function fakeServer() {
  const batches: OutEvent[][] = [];
  const control = { status: 200, auth: '' };
  const h = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      control.auth = req.headers.authorization ?? '';
      res.statusCode = control.status;
      if (control.status === 200) batches.push((JSON.parse(body) as { events: OutEvent[] }).events);
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  return { ...h, batches, control, all: () => batches.flat() };
}

function baseConfig(over: Partial<AgentConfig> = {}): AgentConfig {
  return {
    serverUrl: 'http://127.0.0.1:1', token: 'lg_test_token', awUrl: 'http://127.0.0.1:1', stateDir: tmp(),
    intervalSeconds: 60, backfillDays: 7, sendTitles: false, fullUrlDomains: [], folders: [], csv: [], ignore: DEFAULT_IGNORE, ...over,
  };
}

describe('privacy conversion', () => {
  const win: AwBucket = { id: 'w', type: 'currentwindow' };
  const web: AwBucket = { id: 'b', type: 'web.tab.current' };
  const ev = (data: Record<string, unknown>, duration = 30): { id: number; timestamp: string; duration: number; data: Record<string, unknown> } => ({ id: 7, timestamp: iso(0), duration, data });

  it('drops window titles unless allowed', () => {
    expect(convertEvent(win, ev({ app: 'Code', title: 'secret.md' }), { sendTitles: false, fullUrlDomains: [] })!.data).toEqual({ app: 'Code' });
    expect(convertEvent(win, ev({ app: 'Code', title: 'notes.md' }), { sendTitles: true, fullUrlDomains: [] })!.data).toEqual({ app: 'Code', title: 'notes.md' });
  });

  it('sends only the domain for sites, and the full URL only for allow-listed domains', () => {
    const p = { sendTitles: false, fullUrlDomains: ['example-jobs.com'] };
    expect(convertEvent(web, ev({ url: 'https://www.news.example/a/b?token=abc#x', title: 'Private thing' }), p)!.data).toEqual({ domain: 'news.example' });
    expect(convertEvent(web, ev({ url: 'https://jobs.example-jobs.com/role/9?x=1', title: 'Android role' }), p)!.data).toMatchObject({ domain: 'jobs.example-jobs.com', url: 'https://jobs.example-jobs.com/role/9?x=1', title: 'Android role' });
  });

  it('hides private browsing and skips non-web pages', () => {
    const p = { sendTitles: true, fullUrlDomains: ['x.com'] };
    expect(convertEvent(web, ev({ url: 'https://x.com/secret', incognito: true }), p)!.data).toEqual({ domain: '(private)' });
    expect(convertEvent(web, ev({ url: 'about:blank' }), p)).toBeNull();
    expect(convertEvent(web, ev({ url: 'chrome://newtab' }), p)).toBeNull();
  });

  it('strips invisible characters from app names', () => {
    const p = { sendTitles: false, fullUrlDomains: [] };
    expect(convertEvent(win, ev({ app: '\u200eWhatsApp' }), p)!.data).toEqual({ app: 'WhatsApp' });
    expect(convertEvent(win, ev({ app: '\u200e\u200f' }), p)).toBeNull();
  });

  it('skips zero-length, malformed and unknown events and keeps stable keys', () => {
    const p = { sendTitles: false, fullUrlDomains: [] };
    expect(convertEvent(win, ev({ app: 'Code' }, 0), p)).toBeNull();
    expect(convertEvent(win, ev({ app: '' }), p)).toBeNull();
    expect(convertEvent(win, { id: 1, timestamp: 'garbage', duration: 5, data: { app: 'Code' } }, p)).toBeNull();
    expect(convertEvent({ id: 'x', type: 'something-else' }, ev({}), p)).toBeNull();
    expect(convertEvent(win, ev({ app: 'Code' }), p)!.key).toBe('w:7');
    expect(convertEvent({ id: 'a', type: 'afkstatus' }, ev({ status: 'afk' }), p)!.data).toEqual({ status: 'afk' });
    expect(convertEvent({ id: 'a', type: 'afkstatus' }, ev({ status: 'weird' }), p)).toBeNull();
  });
});

describe('folder helpers', () => {
  it('matches ignore patterns', () => {
    expect(isIgnored('.env', DEFAULT_IGNORE)).toBe(true);
    expect(isIgnored('.env.local', DEFAULT_IGNORE)).toBe(true);
    expect(isIgnored('server.key', DEFAULT_IGNORE)).toBe(true);
    expect(isIgnored('id_ed25519', DEFAULT_IGNORE)).toBe(true);
    expect(isIgnored('notes.md', DEFAULT_IGNORE)).toBe(false);
    expect(isIgnored('A.B', ['a.b'])).toBe(true); // dots are literal, case-insensitive
    expect(isIgnored('aXb', ['a.b'])).toBe(false);
  });

  it('counts CSV data rows', () => {
    const d = tmp();
    const f = (name: string, text: string) => { writeFileSync(path.join(d, name), text); return path.join(d, name); };
    expect(countCsvRows(f('a.csv', 'id,company\n'))).toBe(0);
    expect(countCsvRows(f('b.csv', 'id,company\n1,A\n2,B\n'))).toBe(2);
    expect(countCsvRows(f('c.csv', 'id,company\r\n1,A\r\n\r\n2,B'))).toBe(2);
    expect(countCsvRows(f('d.csv', ''))).toBe(0);
  });

  it('scans folders without reading files and skips ignored names', () => {
    const d = tmp();
    mkdirSync(path.join(d, 'sub'));
    writeFileSync(path.join(d, 'a.md'), 'x');
    writeFileSync(path.join(d, 'sub', 'b.md'), 'y');
    writeFileSync(path.join(d, '.env'), 'SECRET=1');
    mkdirSync(path.join(d, 'node_modules'));
    writeFileSync(path.join(d, 'node_modules', 'junk.js'), 'z');
    const old = new Date('2020-01-01');
    utimesSync(path.join(d, 'a.md'), old, old);
    const r = scanFolder(d, DEFAULT_IGNORE, Date.parse('2021-01-01'));
    expect(r.changed).toBe(1); // only sub/b.md is newer; .env and node_modules are skipped
    expect(r.newest).toBeGreaterThan(Date.parse('2021-01-01'));
    expect(scanFolder(path.join(d, 'missing'), [], 0)).toEqual({ newest: 0, changed: 0 });
  });

  it('reads recent commits from a real git repository and survives non-repos', async () => {
    const d = tmp();
    const git = (...a: string[]) => execFileSync('git', ['-C', d, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { stdio: 'pipe' });
    git('init', '-q');
    writeFileSync(path.join(d, 'f.txt'), '1');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    const commits = await gitCommitsSince(d, Date.now() - 3_600_000);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await gitCommitsSince(d, Date.now() + 3_600_000)).toEqual([]);
    expect(await gitCommitsSince(tmp(), 0)).toEqual([]);
  });
});

describe('state and config', () => {
  it('saves state privately and recovers from damage', () => {
    const dir = path.join(tmp(), 'nested');
    const s = emptyState();
    s.buckets.x = 5;
    saveState(dir, s);
    expect(statSync(path.join(dir, 'state.json')).mode & 0o777).toBe(0o600);
    expect(loadState(dir).buckets.x).toBe(5);
    writeFileSync(path.join(dir, 'state.json'), '{not json');
    expect(loadState(dir)).toEqual(emptyState());
    expect(loadState(path.join(tmp(), 'none'))).toEqual(emptyState());
  });

  it('loads config from env, token file and sources file', () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'token'), 'lg_abc123\n');
    writeFileSync(path.join(dir, 'sources.local.yml'), `activitywatch:\n  send_titles: true\n  full_url_domains: [Example-Jobs.com]\n  backfill_days: 3\nfolders:\n  - { id: prep_folder, path: "~/x/prep" }\n  - { id: work_folder, path: /w, watch_git: true }\ncsv:\n  applications_csv: /w/applications.csv\nignore: ["*.secret"]\n`);
    const cfg = loadConfig({ LIFE_GAME_URL: 'https://life.example.net/', LIFE_GAME_STATE_DIR: dir, LIFE_GAME_CONFIG_DIR: dir });
    expect(cfg).toMatchObject({ serverUrl: 'https://life.example.net', token: 'lg_abc123', sendTitles: true, fullUrlDomains: ['example-jobs.com'], backfillDays: 3, awUrl: 'http://localhost:5600' });
    expect(cfg.folders).toEqual([{ id: 'prep_folder', path: path.join(process.env.HOME!, 'x/prep'), watchGit: false }, { id: 'work_folder', path: '/w', watchGit: true }]);
    expect(cfg.csv).toEqual([{ id: 'applications_csv', path: '/w/applications.csv' }]);
    expect(cfg.ignore).toContain('*.secret');
    expect(cfg.ignore).toContain('.env');
  });

  it('explains what is missing', () => {
    const dir = tmp();
    expect(() => loadConfig({ LIFE_GAME_STATE_DIR: dir, LIFE_GAME_CONFIG_DIR: dir })).toThrow(/LIFE_GAME_URL/);
    expect(() => loadConfig({ LIFE_GAME_URL: 'https://x.example', LIFE_GAME_STATE_DIR: dir, LIFE_GAME_CONFIG_DIR: dir })).toThrow(/device token/);
    expect(() => loadConfig({ LIFE_GAME_URL: 'https://x.example', LIFE_GAME_TOKEN: 'not-a-token', LIFE_GAME_STATE_DIR: dir, LIFE_GAME_CONFIG_DIR: dir })).toThrow(/device token/);
  });
});

describe('syncOnce with a fake ActivityWatch and a fake server', () => {
  let aw: Awaited<ReturnType<typeof fakeAw>>;
  let srv: Awaited<ReturnType<typeof fakeServer>>;
  let cfg: AgentConfig;
  const NOW = new Date(T0 + 120 * 60_000);

  const windowEvents: AwEvt[] = [
    { id: 1, timestamp: iso(0), duration: 600, data: { app: 'Code', title: 'private-notes.md' } },
    { id: 2, timestamp: iso(10), duration: 300, data: { app: 'Google Chrome', title: 'Inbox' } },
  ];

  beforeEach(async () => {
    aw = await fakeAw({
      'aw-watcher-window_h': { type: 'currentwindow', events: windowEvents.map((e) => ({ ...e })) },
      'aw-watcher-afk_h': { type: 'afkstatus', events: [{ id: 1, timestamp: iso(15), duration: 900, data: { status: 'afk' } }] },
      'aw-watcher-web_h': { type: 'web.tab.current', events: [{ id: 1, timestamp: iso(10), duration: 300, data: { url: 'https://jobs.example-jobs.com/r/1', title: 'Role', incognito: false } }] },
      'aw-stopwatch': { type: 'general.stopwatch', events: [{ id: 1, timestamp: iso(0), duration: 100, data: { label: 'x' } }] },
    });
    srv = await fakeServer();
    cfg = baseConfig({ awUrl: aw.url, serverUrl: srv.url, fullUrlDomains: ['example-jobs.com'] });
  });
  afterEach(() => { aw.server.close(); srv.server.close(); });

  it('sends converted events, keeps titles private and ignores unrelated buckets', async () => {
    const state = emptyState();
    const r = await syncOnce(cfg, state, { now: NOW });
    expect(r).toMatchObject({ sent: 4, buckets: 3, awReachable: true, errors: [] });
    const sent = srv.all();
    expect(sent.map((e) => e.kind).sort()).toEqual(['afk', 'web', 'window', 'window']);
    expect(sent.find((e) => e.kind === 'window' && (e.data as { app: string }).app === 'Code')!.data).toEqual({ app: 'Code' });
    expect(sent.find((e) => e.kind === 'web')!.data).toMatchObject({ domain: 'jobs.example-jobs.com', url: 'https://jobs.example-jobs.com/r/1' });
    expect(srv.control.auth).toBe('Bearer lg_test_token');
    expect(state.buckets['aw-watcher-window_h']).toBe(T0 + 15 * 60_000);
  });

  it('on the next pass resumes near the checkpoint and re-sends the growing latest event', async () => {
    const state = emptyState();
    await syncOnce(cfg, state, { now: NOW });
    srv.batches.length = 0;
    aw.requests.length = 0;

    // The last window event keeps growing as heartbeats merge into it, and a new event starts.
    const bucket = aw.state.buckets['aw-watcher-window_h']!;
    bucket.events[1]!.duration = 3600;
    bucket.events.push({ id: 3, timestamp: iso(70), duration: 120, data: { app: 'Slack' } });
    await syncOnce(cfg, state, { now: new Date(T0 + 180 * 60_000) });

    const winReq = aw.requests.find((u) => u.includes('aw-watcher-window_h') && u.includes('start='))!;
    const startParam = new URL(winReq, 'http://x').searchParams.get('start')!;
    expect(Date.parse(startParam)).toBe(T0 + 15 * 60_000 - 10 * 60_000); // checkpoint minus the 10 minute overlap
    const win = srv.all().filter((e) => e.kind === 'window');
    expect(win.map((e) => e.key).sort()).toEqual(['aw-watcher-window_h:2', 'aw-watcher-window_h:3']);
    expect(win.find((e) => e.key.endsWith(':2'))!.durationSec).toBe(3600);
  });

  it('always re-sends the newest event even if it began before the overlap window', async () => {
    const state = emptyState();
    await syncOnce(cfg, state, { now: NOW });
    srv.batches.length = 0;
    const bucket = aw.state.buckets['aw-watcher-window_h']!;
    bucket.events[1]!.duration = 9 * 3600; // started long ago, still growing
    state.buckets['aw-watcher-window_h'] = T0 + 600 * 60_000; // checkpoint far ahead: the overlap start is after the event began
    await syncOnce(cfg, state, { now: new Date(T0 + 700 * 60_000) });
    expect(srv.all().find((e) => e.key === 'aw-watcher-window_h:2')!.durationSec).toBe(32400);
  });

  it('does not advance past events the server did not accept', async () => {
    const state = emptyState();
    srv.control.status = 500;
    const r = await syncOnce(cfg, state, { now: NOW });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(state.buckets['aw-watcher-window_h']).toBeUndefined();
    srv.control.status = 200;
    const again = await syncOnce(cfg, state, { now: NOW });
    expect(again.errors).toEqual([]);
    expect(srv.all()).toHaveLength(4);
  });

  it('stops with a clear error when the token is refused', async () => {
    srv.control.status = 401;
    await expect(syncOnce(cfg, emptyState(), { now: NOW })).rejects.toBeInstanceOf(FatalError);
  });

  it('reports ActivityWatch as unreachable but still collects folder evidence', async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'apps.csv'), 'id,co\n1,A\n2,B\n');
    const c = baseConfig({ awUrl: 'http://127.0.0.1:1', serverUrl: srv.url, csv: [{ id: 'applications_csv', path: path.join(dir, 'apps.csv') }] });
    const r = await syncOnce(c, emptyState(), { now: NOW });
    expect(r.awReachable).toBe(false);
    expect(r.errors[0]).toMatch(/not reachable/);
    expect(srv.all().map((e) => e.kind)).toEqual(['csv_rows']);
  });

  it('splits large batches', async () => {
    const many: AwEvt[] = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, timestamp: iso(i), duration: 30, data: { app: `App${i % 5}` } }));
    aw.state.buckets['aw-watcher-window_h']!.events = many;
    await syncOnce(cfg, emptyState(), { now: new Date(T0 + 1300 * 60_000), });
    expect(srv.batches.filter((b) => b.some((e) => e.kind === 'window')).length).toBeGreaterThanOrEqual(3);
    expect(srv.batches.every((b) => b.length <= 500)).toBe(true);
  });
});

describe('folder evidence in a full pass', () => {
  let srv: Awaited<ReturnType<typeof fakeServer>>;
  beforeEach(async () => { srv = await fakeServer(); });
  afterEach(() => srv.server.close());

  it('reports CSV changes once, file changes after a baseline, and never ignored files', async () => {
    const root = tmp();
    const prep = path.join(root, 'prep');
    mkdirSync(prep);
    writeFileSync(path.join(prep, 'old.md'), 'x');
    writeFileSync(path.join(root, 'apps.csv'), 'id,co\n1,A\n');
    const git = (...a: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { stdio: 'pipe' });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const cfg = baseConfig({
      awUrl: 'http://127.0.0.1:1', serverUrl: srv.url,
      csv: [{ id: 'applications_csv', path: path.join(root, 'apps.csv') }],
      folders: [{ id: 'prep_folder', path: prep, watchGit: false }, { id: 'work_folder', path: root, watchGit: true }],
    });
    const state = emptyState();
    const now1 = new Date();

    await syncOnce(cfg, state, { now: now1 });
    const first = srv.all();
    expect(first.filter((e) => e.kind === 'csv_rows')).toHaveLength(1);
    expect(first.filter((e) => e.kind === 'git_commit')).toHaveLength(1);
    expect(first.filter((e) => e.kind === 'folder_change')).toHaveLength(0); // baseline only

    srv.batches.length = 0;
    await syncOnce(cfg, state, { now: new Date(now1.getTime() + 60_000) });
    expect(srv.all().filter((e) => e.kind !== 'git_commit')).toEqual([]); // quiet when nothing changed

    // New activity: a note, a secret file, and a new CSV row.
    const future = new Date(Date.now() + 5000);
    writeFileSync(path.join(prep, 'new.md'), 'y');
    writeFileSync(path.join(prep, '.env'), 'SECRET=1');
    writeFileSync(path.join(root, 'apps.csv'), 'id,co\n1,A\n2,B\n');
    utimesSync(path.join(prep, 'new.md'), future, future);
    srv.batches.length = 0;
    await syncOnce(cfg, state, { now: new Date(now1.getTime() + 120_000) });
    const later = srv.all();
    expect(later.find((e) => e.kind === 'csv_rows')!.data).toEqual({ source: 'applications_csv', rows: 2 });
    const change = later.find((e) => e.kind === 'folder_change' && (e.data as { source: string }).source === 'prep_folder')!;
    expect(change.data).toMatchObject({ files: 1 }); // new.md only
    expect(JSON.stringify(later)).not.toMatch(/SECRET/);
  });

  it('does not lose folder evidence when the server is down', async () => {
    const root = tmp();
    writeFileSync(path.join(root, 'apps.csv'), 'id,co\n1,A\n');
    const cfg = baseConfig({ awUrl: 'http://127.0.0.1:1', serverUrl: srv.url, csv: [{ id: 'applications_csv', path: path.join(root, 'apps.csv') }] });
    const state = emptyState();
    srv.control.status = 503;
    await syncOnce(cfg, state, { now: new Date() });
    expect(state.folders).toEqual(emptyFolderState()); // nothing was marked as delivered
    srv.control.status = 200;
    await syncOnce(cfg, state, { now: new Date() });
    expect(srv.all().filter((e) => e.kind === 'csv_rows')).toHaveLength(1);
  });
});
