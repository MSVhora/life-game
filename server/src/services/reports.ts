import { emptyTotals, productivePct, type Category } from '../domain/categories.js';
import { addDays, localDateString } from '../domain/time.js';
import { ensureStats, recomputeDay, type StatsCtx } from './stats.js';

export const RANGES = ['today', 'week', 'month', '6months'] as const;
export type RangeName = (typeof RANGES)[number];
const DAYS: Record<RangeName, number> = { today: 1, week: 7, month: 30, '6months': 182 };

interface StatRow {
  d: string;
  totals: Record<Category, number>;
  items: Array<{ kind: string; key: string; category: Category; seconds: number }>;
  active_seconds: number;
  away_seconds: number;
  longest_focus_min: number;
  first_gaming_min: number | null;
}

const weekStart = (date: string): string => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7)); // Monday
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

export async function buildReport(ctx: StatsCtx, range: RangeName) {
  const { pool, settings, now } = ctx;
  const today = localDateString(now, settings.timezone);
  const dates = Array.from({ length: DAYS[range] }, (_, i) => addDays(today, i - (DAYS[range] - 1)));

  await recomputeDay(ctx, today); // today is always live
  await ensureStats(ctx, dates.slice(0, -1));

  const rows = await pool.query<StatRow>(
    `SELECT to_char(local_date, 'YYYY-MM-DD') AS d, totals, items, active_seconds, away_seconds, longest_focus_min, first_gaming_min
       FROM daily_stats WHERE local_date = ANY($1::date[]) ORDER BY local_date`,
    [dates],
  );

  const totals = emptyTotals();
  const itemMap = new Map<string, { kind: string; key: string; category: Category; seconds: number }>();
  const byDay = rows.rows.map((r) => {
    for (const c of Object.keys(totals) as Category[]) totals[c] += r.totals[c] ?? 0;
    for (const it of r.items) {
      const k = `${it.kind}|${it.key}|${it.category}`;
      const cur = itemMap.get(k) ?? { ...it, seconds: 0 };
      cur.seconds += it.seconds;
      itemMap.set(k, cur);
    }
    return { date: r.d, totals: r.totals, productivePct: productivePct(r.totals), activeSeconds: r.active_seconds, longestFocusMin: r.longest_focus_min };
  });

  // One point per day (or per week for 6 months), including days with no data so charts show gaps.
  const dayTotals = new Map(byDay.map((d) => [d.date, d.totals]));
  const emptyPoint = () => emptyTotals();
  let series: Array<{ label: string; date: string; totals: Record<Category, number>; productivePct: number | null }>;
  if (range === '6months') {
    const weeks = new Map<string, Record<Category, number>>();
    for (const date of dates) {
      const w = weekStart(date);
      const t = weeks.get(w) ?? emptyPoint();
      const day = dayTotals.get(date);
      if (day) for (const c of Object.keys(t) as Category[]) t[c] += day[c] ?? 0;
      weeks.set(w, t);
    }
    series = [...weeks.entries()].map(([date, t]) => ({ label: date, date, totals: t, productivePct: productivePct(t) }));
  } else {
    series = dates.map((date) => {
      const t = dayTotals.get(date) ?? emptyPoint();
      return { label: date, date, totals: t, productivePct: productivePct(t) };
    });
  }

  const items = [...itemMap.values()].sort((a, b) => b.seconds - a.seconds);

  const wake = await pool.query<{ d: string; woke_at: Date }>(
    `SELECT to_char(local_date, 'YYYY-MM-DD') AS d, woke_at FROM wake_logs WHERE local_date = ANY($1::date[]) ORDER BY local_date`,
    [dates],
  );
  const taskRows = await pool.query<{ d: string; status: string; tasks_required: number; done: string }>(
    `SELECT to_char(d.local_date, 'YYYY-MM-DD') AS d, d.status, d.tasks_required,
            (SELECT count(*) FROM tasks t WHERE t.day_id = d.id AND t.required AND t.status = 'done') AS done
       FROM days d WHERE d.local_date = ANY($1::date[]) ORDER BY d.local_date`,
    [dates],
  );

  return {
    range,
    from: dates[0]!,
    to: today,
    timezone: settings.timezone,
    totals,
    productivePct: productivePct(totals),
    activeSeconds: byDay.reduce((a, d) => a + d.activeSeconds, 0),
    daysWithData: byDay.filter((d) => d.activeSeconds > 0 || Object.values(d.totals).some((v) => v > 0)).length,
    series,
    topItems: items.filter((i) => i.category !== 'Unlabeled').slice(0, 15),
    unlabeled: items.filter((i) => i.category === 'Unlabeled' && i.kind !== 'manual').slice(0, 12),
    longestFocusMin: Math.max(0, ...byDay.map((d) => d.longestFocusMin)),
    wake: wake.rows.map((w) => ({ date: w.d, wokeAt: w.woke_at.toISOString() })),
    tasks: {
      days: taskRows.rows.length,
      won: taskRows.rows.filter((t) => t.status === 'done').length,
      missed: taskRows.rows.filter((t) => t.status === 'missed').length,
      paused: taskRows.rows.filter((t) => t.status === 'paused').length,
      completed: taskRows.rows.reduce((a, t) => a + Number(t.done), 0),
    },
  };
}

export { median };
