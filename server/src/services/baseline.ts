import { daysBetween, addDays, localDateString, minutesOfDay } from '../domain/time.js';
import { emptyTotals, productivePct, type Category } from '../domain/categories.js';
import { getSetting, putSetting } from './settings.js';
import { ensureStats, recomputeDay, type StatsCtx } from './stats.js';
import { median } from './reports.js';

export interface BaselineState {
  startedOn: string;
  totalDays: number;
  status: 'active' | 'done' | 'skipped';
  endedOn?: string;
}

export const BASELINE_DAYS = 7;

export async function getBaseline(ctx: StatsCtx): Promise<BaselineState | null> {
  return (await getSetting<BaselineState>(ctx.pool, 'baseline')) ?? null;
}

/** The public shape used by the app: null when there is nothing to show. */
export interface BaselineInfo {
  active: boolean;
  dayNumber: number;
  totalDays: number;
  endsOn: string;
  status: BaselineState['status'];
}

export function describeBaseline(b: BaselineState | null, today: string): BaselineInfo | null {
  if (!b) return null;
  const dayNumber = Math.min(b.totalDays, daysBetween(b.startedOn, today) + 1);
  return { active: b.status === 'active', dayNumber, totalDays: b.totalDays, endsOn: addDays(b.startedOn, b.totalDays - 1), status: b.status };
}

/** Days during the baseline are tracked but never counted: they are created as paused. */
export async function isBaselineDay(ctx: StatsCtx, localDate: string): Promise<boolean> {
  const b = await getBaseline(ctx);
  return !!b && b.status === 'active' && localDate >= b.startedOn && localDate <= addDays(b.startedOn, b.totalDays - 1);
}

/** Ends an active baseline once its last day has passed. Returns true if it just finished. */
export async function finishIfDue(ctx: StatsCtx): Promise<boolean> {
  const b = await getBaseline(ctx);
  if (!b || b.status !== 'active') return false;
  const today = localDateString(ctx.now, ctx.settings.timezone);
  if (today <= addDays(b.startedOn, b.totalDays - 1)) return false;
  await putSetting(ctx.pool, 'baseline', { ...b, status: 'done', endedOn: today });
  await reopenPausedDay(ctx);
  return true;
}

export async function startBaseline(ctx: StatsCtx): Promise<BaselineState> {
  const existing = await getBaseline(ctx);
  if (existing?.status === 'active') return existing;
  const startedOn = localDateString(ctx.now, ctx.settings.timezone);
  const state: BaselineState = { startedOn, totalDays: BASELINE_DAYS, status: 'active' };
  await putSetting(ctx.pool, 'baseline', state);
  // The current cycle (if already created) becomes a tracking-only day too.
  await ctx.pool.query(`UPDATE days SET status = 'paused' WHERE status = 'open' AND starts_at <= $1 AND ends_at > $1`, [ctx.now]);
  return state;
}

export async function endBaseline(ctx: StatsCtx, skipped: boolean): Promise<void> {
  const b = await getBaseline(ctx);
  if (!b || b.status !== 'active') return;
  await putSetting(ctx.pool, 'baseline', { ...b, status: skipped ? 'skipped' : 'done', endedOn: localDateString(ctx.now, ctx.settings.timezone) });
  await reopenPausedDay(ctx);
}

/** Ending the baseline mid-day gives the player a normal current day, unless they paused it themselves. */
async function reopenPausedDay(ctx: StatsCtx) {
  await ctx.pool.query(
    `UPDATE days SET status = 'open'
      WHERE status = 'paused' AND starts_at <= $1 AND ends_at > $1
        AND NOT EXISTS (SELECT 1 FROM pause_days p WHERE p.local_date = days.local_date)`,
    [ctx.now],
  );
}

export async function baselineSummary(ctx: StatsCtx) {
  const b = await getBaseline(ctx);
  if (!b) return null;
  const { pool, settings, now } = ctx;
  const today = localDateString(now, settings.timezone);
  const last = today < addDays(b.startedOn, b.totalDays - 1) ? today : addDays(b.startedOn, b.totalDays - 1);
  const dates: string[] = [];
  for (let d = b.startedOn; d <= last; d = addDays(d, 1)) dates.push(d);

  await recomputeDay(ctx, today);
  await ensureStats(ctx, dates.filter((d) => d !== today));
  const stats = await pool.query<{
    d: string; totals: Record<Category, number>; items: Array<{ kind: string; key: string; category: Category; seconds: number }>;
    longest_focus_min: number; first_gaming_min: number | null; active_seconds: number;
  }>(
    `SELECT to_char(local_date, 'YYYY-MM-DD') AS d, totals, items, longest_focus_min, first_gaming_min, active_seconds
       FROM daily_stats WHERE local_date = ANY($1::date[]) ORDER BY local_date`,
    [dates],
  );
  const wake = await pool.query<{ woke_at: Date }>('SELECT woke_at FROM wake_logs WHERE local_date = ANY($1::date[])', [dates]);
  const wakeMinutes = wake.rows.map((w) => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(w.woke_at);
    return minutesOfDay(p);
  });

  const totals = emptyTotals();
  const items = new Map<string, { kind: string; key: string; category: Category; seconds: number }>();
  for (const s of stats.rows) {
    for (const c of Object.keys(totals) as Category[]) totals[c] += s.totals[c] ?? 0;
    for (const it of s.items) {
      const k = `${it.kind}|${it.key}|${it.category}`;
      const cur = items.get(k) ?? { ...it, seconds: 0 };
      cur.seconds += it.seconds;
      items.set(k, cur);
    }
  }
  const focus = stats.rows.map((s) => s.longest_focus_min).filter((m) => m > 0);
  const gaming = stats.rows.map((s) => s.first_gaming_min).filter((m): m is number => m !== null);
  const medianFocus = median(focus);

  return {
    startedOn: b.startedOn,
    status: b.status,
    daysCovered: stats.rows.filter((s) => s.active_seconds > 0).length,
    totals,
    productivePct: productivePct(totals),
    topItems: [...items.values()].sort((a, c) => c.seconds - a.seconds).filter((i) => i.category !== 'Unlabeled').slice(0, 10),
    wake: {
      loggedDays: wakeMinutes.length,
      medianMinutes: median(wakeMinutes),
      spreadMinutes: wakeMinutes.length ? Math.max(...wakeMinutes) - Math.min(...wakeMinutes) : null,
    },
    longestFocusMedianMin: medianFocus,
    longestFocusMaxMin: focus.length ? Math.max(...focus) : null,
    gamingStartMedianMinutes: median(gaming),
    suggestedTaskMinutes: medianFocus ? Math.min(25, Math.max(10, Math.round(medianFocus / 2))) : null,
  };
}
