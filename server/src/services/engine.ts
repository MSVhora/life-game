import type { PoolClient } from 'pg';
import type { Pool } from '../db.js';
import {
  computeStreak,
  dayBonusXp,
  effectiveWakeGoal,
  nextRamp,
  rewardPerTask,
  type RampState,
  type ResolvedDay,
} from '../domain/game.js';
import { activeTaskTypes, pickRotating } from '../domain/goalPlan.js';
import {
  addDays,
  cycleFor,
  daysBetween,
  localDateString,
  localMinutesOfDay,
  minutesOfDay,
} from '../domain/time.js';
import { TIMER_CATEGORY, type TimerKind } from '../domain/timers.js';
import { finishIfDue, getBaseline } from './baseline.js';
import {
  getGoals,
  getSetting,
  loadQuestTemplates,
  putSetting,
  rampStartDate,
  type Settings,
} from './settings.js';

export interface EngineCtx {
  pool: Pool;
  settings: Settings;
  configDir: string;
  now: Date;
}

export { TIMER_KINDS, TIMER_CATEGORY, type TimerKind } from '../domain/timers.js';

export class EngineError extends Error {
  constructor(
    public code: 'not_found' | 'day_closed' | 'already_done' | 'not_done' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function getRamp(pool: Pool, settings: Settings): Promise<RampState> {
  const stored = await getSetting<RampState>(pool, 'ramp');
  const level = Math.min(settings.maxTasksPerDay, Math.max(stored?.level ?? settings.startTasksPerDay, settings.startTasksPerDay));
  return { level, lastRaisedOn: stored?.lastRaisedOn ?? null };
}

export async function resolvedDays(pool: Pool | PoolClient, limit = 400): Promise<ResolvedDay[]> {
  const { rows } = await pool.query<{ local_date: string; status: ResolvedDay['status'] }>(
    `SELECT to_char(local_date, 'YYYY-MM-DD') AS local_date, status
       FROM days WHERE status <> 'open' ORDER BY local_date DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ localDate: r.local_date, status: r.status }));
}

/** Creates the current cycle if missing and deals its tasks. Safe to call repeatedly. */
export async function ensureDay(ctx: EngineCtx): Promise<number> {
  const { pool, settings, now } = ctx;
  const cycle = cycleFor(now, settings.timezone, settings.dayEndsAt);

  const existing = await pool.query<{ id: string }>('SELECT id FROM days WHERE local_date = $1', [cycle.localDate]);
  if (existing.rows[0]) return Number(existing.rows[0].id);

  const goals = await getGoals(pool);
  const templates = loadQuestTemplates(ctx.configDir);
  const ramp = await getRamp(pool, settings);
  const history = await resolvedDays(pool, 3);
  const prev = history.find((d) => d.localDate === addDays(cycle.localDate, -1));

  let cap = settings.dailyCapMinutes;
  if (prev?.status === 'missed' && settings.pressure !== 'data_only') {
    if (settings.lossPenalty === 'halve_next_day') cap = Math.floor(cap / 2);
    if (settings.lossPenalty === 'zero_next_day') cap = 0;
  }

  const dayNumber = daysBetween('2026-01-01', cycle.localDate);
  const candidates = goals.length
    ? activeTaskTypes(goals, cycle.localDate, daysBetween)
    : templates.filter((t) => t.id !== 'kickoff').map((t) => ({ ...t, goalId: undefined as string | undefined, goalTitle: '' }));
  const picks = pickRotating(candidates, ramp.level, dayNumber);
  const reward = rewardPerTask(cap, settings.perTaskMaxMinutes, picks.length);
  const kickoff = templates.find((t) => t.id === 'kickoff');

  return tx(pool, async (c) => {
    const paused = await c.query('SELECT 1 FROM pause_days WHERE local_date = $1', [cycle.localDate]);
    const baseline = await getBaseline(ctx);
    const inBaseline = !!baseline && baseline.status === 'active' && cycle.localDate >= baseline.startedOn && daysBetween(baseline.startedOn, cycle.localDate) < baseline.totalDays;
    const ins = await c.query<{ id: string }>(
      `INSERT INTO days (local_date, starts_at, ends_at, status, tasks_required)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (local_date) DO NOTHING RETURNING id`,
      [cycle.localDate, cycle.startsAt, cycle.endsAt, paused.rowCount || inBaseline ? 'paused' : 'open', picks.length],
    );
    if (!ins.rows[0]) {
      const again = await c.query<{ id: string }>('SELECT id FROM days WHERE local_date = $1', [cycle.localDate]);
      return Number(again.rows[0]!.id);
    }
    const dayId = Number(ins.rows[0].id);
    await c.query('INSERT INTO budget_days (day_id, cap_minutes) VALUES ($1, $2)', [dayId, cap]);
    if (kickoff) {
      await c.query(
        `INSERT INTO tasks (day_id, template_id, title, planned_minutes, xp, reward_minutes, required)
         VALUES ($1, 'kickoff', $2, $3, $4, 0, false)`,
        [dayId, kickoff.title, kickoff.minutes, kickoff.xp],
      );
    }
    for (const p of picks) {
      await c.query(
        `INSERT INTO tasks (day_id, template_id, goal_id, title, planned_minutes, xp, reward_minutes, required)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [dayId, p.id, p.goalId ?? null, p.title, p.minutes, p.xp, reward],
      );
    }
    return dayId;
  });
}

async function recomputeEarned(c: PoolClient, dayId: number): Promise<void> {
  await c.query(
    `UPDATE budget_days b SET earned_minutes = LEAST(b.cap_minutes, COALESCE((
        SELECT SUM(t.reward_minutes) FROM tasks t WHERE t.day_id = b.day_id AND t.status = 'done'), 0))
      WHERE b.day_id = $1`,
    [dayId],
  );
}

interface TaskRow { id: string; day_id: string; status: string; xp: number; starts_at: Date; ends_at: Date; day_status: string }

async function lockTask(c: PoolClient, taskId: number): Promise<TaskRow> {
  const { rows } = await c.query<TaskRow>(
    `SELECT t.id, t.day_id, t.status, t.xp, d.starts_at, d.ends_at, d.status AS day_status
       FROM tasks t JOIN days d ON d.id = t.day_id WHERE t.id = $1 FOR UPDATE OF t`,
    [taskId],
  );
  if (!rows[0]) throw new EngineError('not_found', 'Task not found');
  return rows[0];
}

export async function completeTask(ctx: EngineCtx, taskId: number): Promise<void> {
  await tx(ctx.pool, async (c) => {
    const t = await lockTask(c, taskId);
    if (t.day_status === 'paused') throw new EngineError('day_closed', 'This day is paused');
    if (t.day_status !== 'open' || ctx.now >= t.ends_at || ctx.now < t.starts_at) {
      throw new EngineError('day_closed', 'That day has ended');
    }
    if (t.status === 'done') throw new EngineError('already_done', 'Task is already done');
    await c.query(`UPDATE tasks SET status = 'done', completion_kind = 'manual', completed_at = $2 WHERE id = $1`, [taskId, ctx.now]);
    await c.query(`INSERT INTO xp_ledger (delta, reason, task_id, ts) VALUES ($1, 'task', $2, $3)`, [t.xp, taskId, ctx.now]);
    await recomputeEarned(c, Number(t.day_id));
  });
}

export async function undoTask(ctx: EngineCtx, taskId: number): Promise<void> {
  await tx(ctx.pool, async (c) => {
    const t = await lockTask(c, taskId);
    if (t.day_status !== 'open' || ctx.now >= t.ends_at) throw new EngineError('day_closed', 'That day has ended');
    if (t.status !== 'done') throw new EngineError('not_done', 'Task is not done');
    await c.query(`UPDATE tasks SET status = 'pending', completion_kind = NULL, completed_at = NULL WHERE id = $1`, [taskId]);
    await c.query(`INSERT INTO xp_ledger (delta, reason, task_id, ts) VALUES ($1, 'undo', $2, $3)`, [-t.xp, taskId, ctx.now]);
    await recomputeEarned(c, Number(t.day_id));
  });
}

/** An extra task the player adds to today. Earns XP but no gaming minutes, and is not required. */
export async function addBonusTask(ctx: EngineCtx, title: string, minutes: number | null): Promise<number> {
  const dayId = await ensureDay(ctx);
  const { rows } = await ctx.pool.query<{ id: string; status: string }>(
    `INSERT INTO tasks (day_id, template_id, title, planned_minutes, xp, reward_minutes, required)
     SELECT $1, 'bonus', $2, $3, 10, 0, false FROM days WHERE id = $1 AND status = 'open' AND ends_at > $4
     RETURNING id`,
    [dayId, title, minutes, ctx.now],
  );
  if (!rows[0]) throw new EngineError('day_closed', 'Today is not open');
  return Number(rows[0].id);
}

/** Resolves every open cycle whose end has passed. Returns how many were resolved. */
export async function resolveDueDays(ctx: EngineCtx): Promise<number> {
  const { pool, settings, now } = ctx;
  const due = await pool.query<{ id: string }>(
    `SELECT id FROM days WHERE status = 'open' AND ends_at <= $1 ORDER BY local_date`,
    [now],
  );
  let resolved = 0;
  for (const row of due.rows) {
    const done = await tx(pool, async (c) => {
      const d = await c.query<{ id: string; local_date: string; tasks_required: number; status: string }>(
        `SELECT id, to_char(local_date, 'YYYY-MM-DD') AS local_date, tasks_required, status
           FROM days WHERE id = $1 FOR UPDATE`,
        [row.id],
      );
      const day = d.rows[0];
      if (!day || day.status !== 'open') return false;
      const cnt = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM tasks WHERE day_id = $1 AND required AND status = 'done'`,
        [day.id],
      );
      const success = Number(cnt.rows[0]!.n) >= day.tasks_required;
      await c.query(`UPDATE days SET status = $2, resolved_at = $3 WHERE id = $1`, [day.id, success ? 'done' : 'missed', now]);
      if (success) {
        const history = await resolvedDays(c);
        const streak = computeStreak(history, settings.graceDaysPerWeek);
        await c.query(
          `INSERT INTO xp_ledger (delta, reason, day_id) VALUES ($1, 'day_bonus', $2) ON CONFLICT DO NOTHING`,
          [dayBonusXp(streak - 1), day.id],
        );
      }
      return true;
    });
    if (done) resolved++;
  }
  if (resolved) {
    const history = await resolvedDays(pool, 30);
    const today = cycleFor(now, settings.timezone, settings.dayEndsAt).localDate;
    const ramp = await getRamp(pool, settings);
    const next = nextRamp(ramp, history, { raiseAfterDaysMet: settings.raiseAfterDaysMet, maxLevel: settings.maxTasksPerDay, today });
    if (next.level !== ramp.level) await putSetting(pool, 'ramp', next);
  }
  return resolved;
}

/** One scheduler step: resolve finished days, then make sure the current one exists. */
export async function tick(ctx: EngineCtx): Promise<{ dayId: number; resolved: number }> {
  await finishIfDue(ctx);
  const resolved = await resolveDueDays(ctx);
  const dayId = await ensureDay(ctx);
  return { dayId, resolved };
}

export async function setPause(ctx: EngineCtx, localDate: string, reason: string, note: string | null): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO pause_days (local_date, reason, note) VALUES ($1, $2, $3)
     ON CONFLICT (local_date) DO UPDATE SET reason = EXCLUDED.reason, note = EXCLUDED.note`,
    [localDate, reason, note],
  );
  await ctx.pool.query(
    `UPDATE days SET status = 'paused' WHERE local_date = $1 AND status = 'open'`,
    [localDate],
  );
}

export async function clearPause(ctx: EngineCtx, localDate: string): Promise<void> {
  await ctx.pool.query('DELETE FROM pause_days WHERE local_date = $1', [localDate]);
  await ctx.pool.query(
    `UPDATE days SET status = 'open' WHERE local_date = $1 AND status = 'paused' AND ends_at > $2`,
    [localDate, ctx.now],
  );
}

async function stopRunning(c: PoolClient, now: Date): Promise<{ kind: TimerKind; minutes: number } | null> {
  const { rows } = await c.query<{ id: string; kind: TimerKind; started_at: Date; label: string | null }>(
    `UPDATE timers SET stopped_at = GREATEST($1::timestamptz, started_at) WHERE stopped_at IS NULL
     RETURNING id, kind, started_at, label`,
    [now],
  );
  const t = rows[0];
  if (!t) return null;
  const ms = now.getTime() - t.started_at.getTime();
  if (ms >= 1000) {
    await c.query(
      `INSERT INTO time_blocks (start_at, end_at, category, source, label) VALUES ($1, $2, $3, 'manual', $4)`,
      [t.started_at, now, TIMER_CATEGORY[t.kind], t.label ?? t.kind],
    );
  }
  return { kind: t.kind, minutes: Math.round(ms / 60000) };
}

export async function startTimer(ctx: EngineCtx, kind: TimerKind, label: string | null): Promise<void> {
  await tx(ctx.pool, async (c) => {
    await stopRunning(c, ctx.now);
    await c.query('INSERT INTO timers (kind, label, started_at) VALUES ($1, $2, $3)', [kind, label, ctx.now]);
  });
}

export async function stopTimer(ctx: EngineCtx): Promise<{ kind: TimerKind; minutes: number } | null> {
  return tx(ctx.pool, (c) => stopRunning(c, ctx.now));
}

/** "I'm up": ends a running sleep timer, records today's wake time once, and awards XP. */
export async function logWake(ctx: EngineCtx): Promise<{ wokeAt: Date; beforeGoal: boolean; xp: number; alreadyLogged: boolean }> {
  const { pool, settings, now } = ctx;
  const date = localDateString(now, settings.timezone);
  const start = await rampStartDate(pool, settings.timezone, now);
  const goal = effectiveWakeGoal({
    startGoal: settings.wakeGoalBefore,
    finalGoal: settings.wakeGoalFinal,
    rampMinutesPerWeek: settings.wakeRampMinutesPerWeek,
    startDate: start,
    today: date,
  });
  return tx(pool, async (c) => {
    const running = await c.query<{ kind: string }>(`SELECT kind FROM timers WHERE stopped_at IS NULL`);
    if (running.rows[0]?.kind === 'sleep') await stopRunning(c, now);
    const ins = await c.query(
      `INSERT INTO wake_logs (local_date, woke_at) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING local_date`,
      [date, now],
    );
    const existing = await c.query<{ woke_at: Date }>('SELECT woke_at FROM wake_logs WHERE local_date = $1', [date]);
    const wokeAt = existing.rows[0]!.woke_at;
    const beforeGoal = localMinutesOfDay(wokeAt, settings.timezone) <= minutesOfDay(goal);
    if (!ins.rowCount) return { wokeAt, beforeGoal, xp: 0, alreadyLogged: true };
    const xp = beforeGoal ? 15 : 5;
    await c.query(`INSERT INTO xp_ledger (delta, reason, ts) VALUES ($1, 'wake', $2)`, [xp, now]);
    return { wokeAt, beforeGoal, xp, alreadyLogged: false };
  });
}
