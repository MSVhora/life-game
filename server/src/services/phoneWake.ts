import { logWake, type EngineCtx } from './engine.js';

export const MIN_SLEEP_GAP_MS = 3 * 3_600_000;
const LOOKBACK_MS = 40 * 3_600_000;
/** A wake older than this is not announced any more (the player has long been up). */
const RECENT_MS = 18 * 3_600_000;

export interface Span { start: number; end: number }

/**
 * Finds the end of the most recent quiet gap of at least `minGapMs` between phone activity spans.
 * Long app sessions count as activity for their whole length, so reading for hours is not "sleep".
 * Returns the time phone use resumed (the wake time), or null.
 */
export function findWakeAfterGap(spans: Span[], now: number, minGapMs = MIN_SLEEP_GAP_MS, recentMs = RECENT_MS): number | null {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let reach = -Infinity;
  let wake: number | null = null;
  for (const s of sorted) {
    if (reach !== -Infinity && s.start - reach >= minGapMs && s.start <= now && s.start >= now - recentMs) wake = s.start;
    reach = Math.max(reach, s.end);
  }
  return wake;
}

/** With wakeSource "phone": the first phone use after a long quiet gap becomes today's wake-up. */
export async function detectPhoneWake(ctx: EngineCtx) {
  if (ctx.settings.wakeSource !== 'phone') return null;
  const now = ctx.now.getTime();
  const { rows } = await ctx.pool.query<{ ts: Date; duration: string | null }>(
    `SELECT ts, payload->>'duration' AS duration FROM events
      WHERE source = 'android' AND kind IN ('unlock', 'screen_on', 'screen_off', 'app_usage')
        AND ts >= $1 AND ts <= $2 ORDER BY ts`,
    [new Date(now - LOOKBACK_MS), ctx.now],
  );
  const spans = rows.map((r) => ({ start: r.ts.getTime(), end: r.ts.getTime() + Math.max(0, Number(r.duration ?? 0)) * 1000 }));
  const wake = findWakeAfterGap(spans, now);
  if (wake === null) return null;
  return logWake(ctx, new Date(wake), 'phone');
}
