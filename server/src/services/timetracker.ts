import { loadConfigFile } from '../config-files.js';
import type { Pool } from '../db.js';
import { addDays, localDateString, zonedToInstant } from '../domain/time.js';
import type { Config } from '../config.js';

export interface TimeTrackerConfig {
  url: string;
  token: string;
  orgId?: string;
}

/** Placeholders from .env.example must not trigger real requests. */
export function timeTrackerConfig(config: Pick<Config, 'TIMETRACKER_API_URL' | 'TIMETRACKER_API_TOKEN' | 'TIMETRACKER_ORG_ID'>): TimeTrackerConfig | null {
  const url = config.TIMETRACKER_API_URL?.trim();
  const token = config.TIMETRACKER_API_TOKEN?.trim();
  if (!url || !token || /example\.(com|org)/i.test(url) || /change-?me/i.test(token)) return null;
  return { url: url.replace(/\/+$/, ''), token, orgId: config.TIMETRACKER_ORG_ID?.trim() || undefined };
}

type Fetcher = typeof fetch;

async function getJson<T>(f: Fetcher, cfg: TimeTrackerConfig, path: string): Promise<T> {
  const res = await f(`${cfg.url}${path}`, { headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new Error(`Time tracker refused the API token (${res.status}). Check TIMETRACKER_API_TOKEN.`);
  if (!res.ok) throw new Error(`Time tracker request failed (${res.status}) for ${path.split('?')[0]}`);
  return (await res.json()) as T;
}

interface Entry { id: string; start: string; end: string | null; duration?: number; project_id?: string | null; billable?: boolean }
interface Named { id: string; name?: string; client_id?: string | null }

async function discoverOrg(f: Fetcher, cfg: TimeTrackerConfig): Promise<string> {
  if (cfg.orgId) return cfg.orgId;
  const r = await getJson<{ data?: Array<{ organization?: { id?: string }; organization_id?: string }> }>(f, cfg, '/v1/users/me/memberships');
  const m = r.data?.[0];
  const id = m?.organization?.id ?? m?.organization_id;
  if (!id) throw new Error('Could not find your organization. Set TIMETRACKER_ORG_ID.');
  return id;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface SyncCtx { pool: Pool; timezone: string; now: Date }

/** Pulls this month's time entries and keeps freelance_entries (and Productive blocks) in step. */
export async function syncTimeEntries(ctx: SyncCtx, cfg: TimeTrackerConfig, f: Fetcher = fetch): Promise<{ entries: number }> {
  const org = await discoverOrg(f, cfg);
  const today = localDateString(ctx.now, ctx.timezone);
  const monthStart = `${today.slice(0, 8)}01`;
  const from = zonedToInstant(addDays(monthStart, -1), '00:00', ctx.timezone); // a day of margin for time-zone edges
  const to = new Date(ctx.now.getTime() + 60_000);

  const entries: Entry[] = [];
  for (let page = 0; page < 20; page++) {
    const q = `?start=${encodeURIComponent(iso(from))}&end=${encodeURIComponent(iso(to))}&limit=500&offset=${page * 500}`;
    const r = await getJson<{ data?: Entry[]; meta?: { total?: number } }>(f, cfg, `/v1/organizations/${org}/time-entries${q}`);
    const batch = r.data ?? [];
    entries.push(...batch);
    if (batch.length < 500 || entries.length >= (r.meta?.total ?? Infinity)) break;
  }

  const projects = new Map<string, Named>();
  const clients = new Map<string, string>();
  try {
    for (const p of (await getJson<{ data?: Named[] }>(f, cfg, `/v1/organizations/${org}/projects?limit=500`)).data ?? []) projects.set(p.id, p);
    for (const c of (await getJson<{ data?: Named[] }>(f, cfg, `/v1/organizations/${org}/clients?limit=500`)).data ?? []) clients.set(c.id, c.name ?? '');
  } catch {
    // names are optional; entries still count by time
  }

  for (const e of entries) {
    const project = e.project_id ? projects.get(e.project_id) : undefined;
    const projectName = project?.name ?? null;
    const clientName = project?.client_id ? clients.get(project.client_id) ?? null : null;
    const startAt = new Date(e.start);
    const endAt = e.end ? new Date(e.end) : null;
    const duration = endAt ? Math.round((endAt.getTime() - startAt.getTime()) / 1000) : Math.max(0, Math.round((ctx.now.getTime() - startAt.getTime()) / 1000));
    await ctx.pool.query(
      `INSERT INTO freelance_entries (external_id, start_at, end_at, duration_s, project_name, client_name, billable, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (external_id) DO UPDATE SET start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
         duration_s = EXCLUDED.duration_s, project_name = EXCLUDED.project_name, client_name = EXCLUDED.client_name,
         billable = EXCLUDED.billable, synced_at = now()`,
      [`st:${e.id}`, startAt, endAt, duration, projectName, clientName, e.billable ?? true],
    );
    if (endAt && endAt > startAt) {
      await ctx.pool.query(
        `INSERT INTO time_blocks (start_at, end_at, category, source, label, external_id)
         VALUES ($1, $2, 'Productive', 'timetracker', $3, $4)
         ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, label = EXCLUDED.label`,
        [startAt, endAt, projectName ?? 'Freelance', `st:${e.id}`],
      );
    }
  }
  return { entries: entries.length };
}

interface ClientsFile { currency?: string; clients?: Array<{ name: string; hourly_rate: number; monthly_cap: number; timetracker_project?: string }> }

export interface FreelanceSummary {
  configured: boolean;
  currency: string;
  month: string;
  syncedAt: string | null;
  clients: Array<{ name: string; hourlyRate: number; hours: number; earned: number; cap: number; capHours: number; remainingHours: number; pctOfCap: number }>;
  unmatched: Array<{ name: string; hours: number }>;
  totals: { hours: number; earned: number; cap: number };
}

/** Hours and money this month per client from clients.*.yml (matched by project or client name). */
export async function freelanceSummary(ctx: SyncCtx, configDir: string, configured: boolean): Promise<FreelanceSummary> {
  let file: ClientsFile = {};
  try {
    file = loadConfigFile<ClientsFile>(configDir, 'clients').data ?? {};
  } catch {
    file = {};
  }
  const today = localDateString(ctx.now, ctx.timezone);
  const month = today.slice(0, 7);
  const start = zonedToInstant(`${month}-01`, '00:00', ctx.timezone);
  const rows = await ctx.pool.query<{ project_name: string | null; client_name: string | null; seconds: string; billable: boolean; synced: Date | null }>(
    `SELECT project_name, client_name, billable, sum(duration_s) AS seconds, max(synced_at) AS synced
       FROM freelance_entries WHERE start_at >= $1 GROUP BY project_name, client_name, billable`,
    [start],
  );
  const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const matched = new Set<number>();
  const clients = (file.clients ?? []).map((c) => {
    let sec = 0;
    rows.rows.forEach((r, i) => {
      if (!r.billable) return;
      const key = lc(c.timetracker_project ?? c.name);
      if (lc(r.project_name) === key || lc(r.client_name) === key) {
        sec += Number(r.seconds);
        matched.add(i);
      }
    });
    const hours = Math.round((sec / 3600) * 100) / 100;
    const earned = Math.round(hours * c.hourly_rate);
    const capHours = c.hourly_rate > 0 ? Math.round((c.monthly_cap / c.hourly_rate) * 100) / 100 : 0;
    return {
      name: c.name, hourlyRate: c.hourly_rate, hours, earned, cap: c.monthly_cap, capHours,
      remainingHours: Math.max(0, Math.round((capHours - hours) * 100) / 100),
      pctOfCap: c.monthly_cap > 0 ? Math.min(100, Math.round((earned / c.monthly_cap) * 100)) : 0,
    };
  });
  const unmatched = rows.rows
    .filter((r, i) => !matched.has(i) && r.billable)
    .map((r) => ({ name: r.project_name ?? r.client_name ?? '(no project)', hours: Math.round((Number(r.seconds) / 3600) * 100) / 100 }));
  const synced = rows.rows.map((r) => r.synced).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    configured, currency: file.currency ?? 'INR', month, syncedAt: synced?.toISOString() ?? null,
    clients, unmatched,
    totals: {
      hours: Math.round(clients.reduce((a, c) => a + c.hours, 0) * 100) / 100,
      earned: clients.reduce((a, c) => a + c.earned, 0),
      cap: clients.reduce((a, c) => a + c.cap, 0),
    },
  };
}
