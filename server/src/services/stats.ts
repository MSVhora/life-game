import { loadConfigFile } from '../config-files.js';
import type { Pool } from '../db.js';
import { makeClassifier, type Category, type Classifier, type Label, type RuleFile } from '../domain/categories.js';
import { buildTimeline, type Interval, type TimelineResult } from '../domain/timeline.js';
import { addDays, localDateString, zonedToInstant } from '../domain/time.js';
import { TIMER_CATEGORY, type TimerKind } from '../domain/timers.js';
import type { Settings } from './settings.js';

export interface StatsCtx {
  pool: Pool;
  settings: Settings;
  configDir: string;
  now: Date;
}

const VALID_CATEGORIES: Category[] = ['Productive', 'Neutral', 'Waste', 'Gaming', 'Leisure', 'Unlabeled', 'Away'];

export async function loadClassifier(pool: Pool, configDir: string): Promise<Classifier> {
  let file: RuleFile | undefined;
  try {
    file = loadConfigFile<RuleFile>(configDir, 'categories', 'json').data;
  } catch {
    file = undefined; // no rules file: everything is Unlabeled until the player labels it
  }
  const { rows } = await pool.query<Label>('SELECT kind, value, category FROM app_labels');
  return makeClassifier(file, rows);
}

export function dayRange(date: string, tz: string): Interval {
  return {
    start: zonedToInstant(date, '00:00', tz).getTime(),
    end: zonedToInstant(addDays(date, 1), '00:00', tz).getTime(),
  };
}

interface EventRow { kind: string; ts: Date; payload: Record<string, unknown> }

/** Rolls the raw events and manual timers of one calendar day into a timeline. */
export async function computeDay(ctx: StatsCtx, date: string, classifier?: Classifier): Promise<TimelineResult> {
  return computeRange(ctx, dayRange(date, ctx.settings.timezone), classifier);
}

/** Rolls the events and manual timers inside any time range into a timeline. */
export async function computeRange(ctx: StatsCtx, range: Interval, classifier?: Classifier): Promise<TimelineResult> {
  const { pool, settings } = ctx;
  const cls = classifier ?? (await loadClassifier(pool, ctx.configDir));

  const ev = await pool.query<EventRow>(
    `SELECT kind, ts, payload FROM events
      WHERE source = 'activitywatch' AND kind IN ('window', 'web', 'afk')
        AND ts < $2 AND ts >= $1::timestamptz - interval '1 day'`,
    [new Date(range.start), new Date(range.end)],
  );
  const iv = (r: EventRow): Interval => {
    const start = r.ts.getTime();
    return { start, end: start + Math.max(0, Number(r.payload.duration ?? 0)) * 1000 };
  };
  const windows: Parameters<typeof buildTimeline>[0]['windows'] = [];
  const web: Parameters<typeof buildTimeline>[0]['web'] = [];
  const afk: Parameters<typeof buildTimeline>[0]['afk'] = [];
  for (const r of ev.rows) {
    const i = iv(r);
    if (i.end <= range.start || i.end <= i.start) continue;
    if (r.kind === 'window' && typeof r.payload.app === 'string') windows.push({ ...i, app: r.payload.app });
    else if (r.kind === 'web' && typeof r.payload.domain === 'string') web.push({ ...i, domain: r.payload.domain, url: r.payload.url as string | undefined });
    else if (r.kind === 'afk') afk.push({ ...i, afk: r.payload.status === 'afk' });
  }

  const blocks = await pool.query<{ start_at: Date; end_at: Date; category: string; label: string | null }>(
    `SELECT start_at, end_at, category, label FROM time_blocks
      WHERE source IN ('manual', 'timetracker') AND end_at > $1 AND start_at < $2`,
    [new Date(range.start), new Date(range.end)],
  );
  const manual = blocks.rows
    .filter((b) => VALID_CATEGORIES.includes(b.category as Category))
    .map((b) => ({ start: b.start_at.getTime(), end: b.end_at.getTime(), category: b.category as Category, label: b.label ?? b.category }));

  // A timer that is still running counts up to now.
  const running = await pool.query<{ kind: TimerKind; label: string | null; started_at: Date }>(
    'SELECT kind, label, started_at FROM timers WHERE stopped_at IS NULL',
  );
  const r0 = running.rows[0];
  if (r0 && ctx.now.getTime() > r0.started_at.getTime()) {
    manual.push({ start: r0.started_at.getTime(), end: ctx.now.getTime(), category: TIMER_CATEGORY[r0.kind], label: r0.label ?? r0.kind });
  }

  return buildTimeline({ range, tz: settings.timezone, windows, web, afk, manual, classifier: cls });
}

export async function saveDay(pool: Pool, date: string, r: TimelineResult): Promise<void> {
  await pool.query(
    `INSERT INTO daily_stats (local_date, totals, items, active_seconds, away_seconds, longest_focus_min, first_gaming_min, computed_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, now())
     ON CONFLICT (local_date) DO UPDATE SET totals = EXCLUDED.totals, items = EXCLUDED.items,
       active_seconds = EXCLUDED.active_seconds, away_seconds = EXCLUDED.away_seconds,
       longest_focus_min = EXCLUDED.longest_focus_min, first_gaming_min = EXCLUDED.first_gaming_min, computed_at = now()`,
    [date, JSON.stringify(r.totals), JSON.stringify(r.items.slice(0, 60)), r.activeSeconds, r.awaySeconds, r.longestFocusMin, r.firstGamingMin],
  );
}

export async function recomputeDay(ctx: StatsCtx, date: string, classifier?: Classifier): Promise<TimelineResult> {
  const r = await computeDay(ctx, date, classifier);
  await saveDay(ctx.pool, date, r);
  return r;
}

export async function markDirty(pool: Pool, dates: string[]): Promise<void> {
  if (!dates.length) return;
  await pool.query(
    `INSERT INTO stats_dirty (local_date) SELECT unnest($1::date[]) ON CONFLICT (local_date) DO NOTHING`,
    [dates],
  );
}

/** Recomputes up to `max` dirty days, newest first. Returns how many were done. */
export async function recomputeDirty(ctx: StatsCtx, max = 10): Promise<number> {
  const { rows } = await ctx.pool.query<{ d: string }>(
    `SELECT to_char(local_date, 'YYYY-MM-DD') AS d FROM stats_dirty ORDER BY local_date DESC LIMIT $1`,
    [max],
  );
  if (!rows.length) return 0;
  const cls = await loadClassifier(ctx.pool, ctx.configDir);
  for (const { d } of rows) {
    await recomputeDay(ctx, d, cls);
    await ctx.pool.query('DELETE FROM stats_dirty WHERE local_date = $1', [d]);
  }
  return rows.length;
}

/** Calendar dates (player time zone) an event spanning [start, end] touches. */
export function datesTouched(startMs: number, endMs: number, tz: string): string[] {
  const out: string[] = [];
  let d = localDateString(new Date(startMs), tz);
  const last = localDateString(new Date(Math.max(startMs, endMs)), tz);
  for (let i = 0; i < 4 && d <= last; i++) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** Makes sure every date that has data also has a stats row (computes missing ones). */
export async function ensureStats(ctx: StatsCtx, dates: string[]): Promise<void> {
  if (!dates.length) return;
  const { pool, settings } = ctx;
  const have = await pool.query<{ d: string }>(`SELECT to_char(local_date, 'YYYY-MM-DD') AS d FROM daily_stats WHERE local_date = ANY($1::date[])`, [dates]);
  const haveSet = new Set(have.rows.map((r) => r.d));
  const missing = dates.filter((d) => !haveSet.has(d));
  if (!missing.length) return;
  const lo = dayRange(missing[0]!, settings.timezone).start;
  const hi = dayRange(missing[missing.length - 1]!, settings.timezone).end;
  const withData = await pool.query<{ d: string }>(
    `SELECT DISTINCT to_char((ts AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d FROM events WHERE ts >= $2 AND ts < $3
     UNION
     SELECT DISTINCT to_char((start_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') FROM time_blocks WHERE start_at >= $2 AND start_at < $3`,
    [settings.timezone, new Date(lo), new Date(hi)],
  );
  const dataSet = new Set(withData.rows.map((r) => r.d));
  const cls = await loadClassifier(pool, ctx.configDir);
  for (const d of missing) if (dataSet.has(d)) await recomputeDay(ctx, d, cls);
}
