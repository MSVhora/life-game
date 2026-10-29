import { crewMessages } from '../domain/crew.js';
import {
  computeReputation,
  computeStreak,
  effectiveWakeGoal,
  levelProgress,
  rankForLevel,
} from '../domain/game.js';
import { daysBetween, cycleFor, localDateString } from '../domain/time.js';
import { describeBaseline, getBaseline } from './baseline.js';
import { getRamp, resolvedDays, tick, type EngineCtx } from './engine.js';
import { markersByTask } from './markers.js';
import { getGoals, getSetting, rampStartDate } from './settings.js';

interface TaskOut {
  markers?: Array<{ type: string; ref: string }>;
  id: number;
  title: string;
  plannedMinutes: number | null;
  xp: number;
  rewardMinutes: number;
  required: boolean;
  status: 'pending' | 'done' | 'skipped';
  templateId: string | null;
}

export async function buildState(ctx: EngineCtx) {
  const { pool, settings, now } = ctx;
  const { dayId } = await tick(ctx);
  const cycle = cycleFor(now, settings.timezone, settings.dayEndsAt);
  const today = localDateString(now, settings.timezone);

  const dayRes = await pool.query<{ id: string; status: string; tasks_required: number; starts_at: Date; ends_at: Date }>(
    'SELECT id, status, tasks_required, starts_at, ends_at FROM days WHERE id = $1',
    [dayId],
  );
  const day = dayRes.rows[0]!;

  const tasksRes = await pool.query<{
    id: string; title: string; planned_minutes: number | null; xp: number; reward_minutes: number;
    required: boolean; status: TaskOut['status']; template_id: string | null;
  }>(
    `SELECT id, title, planned_minutes, xp, reward_minutes, required, status, template_id
       FROM tasks WHERE day_id = $1 ORDER BY required, id`,
    [dayId],
  );
  const tasks: TaskOut[] = tasksRes.rows.map((t) => ({
    id: Number(t.id), title: t.title, plannedMinutes: t.planned_minutes, xp: t.xp,
    rewardMinutes: t.reward_minutes, required: t.required, status: t.status, templateId: t.template_id,
  }));
  const markers = await markersByTask(pool, tasks.map((t) => t.id));
  for (const t of tasks) t.markers = markers.get(t.id) ?? [];
  const requiredDone = tasks.filter((t) => t.required && t.status === 'done').length;

  const budgetRes = await pool.query<{ cap_minutes: number; earned_minutes: number }>(
    'SELECT cap_minutes, earned_minutes FROM budget_days WHERE day_id = $1',
    [dayId],
  );
  const budget = budgetRes.rows[0] ?? { cap_minutes: 0, earned_minutes: 0 };
  const gamingRes = await pool.query<{ minutes: string }>(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(end_at, $2::timestamptz) - GREATEST(start_at, $1::timestamptz))) / 60), 0) AS minutes
       FROM time_blocks WHERE category = 'Gaming' AND end_at > $1 AND start_at < $2`,
    [day.starts_at, day.ends_at],
  );
  const timerRes = await pool.query<{ id: string; kind: string; label: string | null; started_at: Date }>(
    'SELECT id, kind, label, started_at FROM timers WHERE stopped_at IS NULL',
  );
  const running = timerRes.rows[0];
  let usedMinutes = Number(gamingRes.rows[0]!.minutes);
  if (running?.kind === 'gaming') usedMinutes += Math.max(0, (now.getTime() - running.started_at.getTime()) / 60000);

  const xpRes = await pool.query<{ total: string }>('SELECT COALESCE(SUM(delta), 0) AS total FROM xp_ledger');
  const xp = Number(xpRes.rows[0]!.total);
  const lp = levelProgress(xp);

  const history = await resolvedDays(pool);
  const streak = computeStreak(history, settings.graceDaysPerWeek);
  const reputation = computeReputation(history, settings.pressure);
  const lastResolved = history[0]?.status ?? null;

  const start = await rampStartDate(pool, settings.timezone, now);
  const wakeGoal = effectiveWakeGoal({
    startGoal: settings.wakeGoalBefore, finalGoal: settings.wakeGoalFinal,
    rampMinutesPerWeek: settings.wakeRampMinutesPerWeek, startDate: start, today,
  });
  const wakeRes = await pool.query<{ woke_at: Date }>('SELECT woke_at FROM wake_logs WHERE local_date = $1', [today]);

  const recentTimers = await pool.query<{ id: string; kind: string; label: string | null; started_at: Date; stopped_at: Date | null }>(
    `SELECT id, kind, label, started_at, stopped_at FROM timers
      WHERE started_at >= $1 ORDER BY started_at DESC LIMIT 30`,
    [day.starts_at],
  );

  const goals = await getGoals(pool);
  const goalProgress = [];
  for (const g of goals) {
    const counting = g.plan.phases.flatMap((p) => p.taskTypes.filter((t) => t.countsTowardTarget).map((t) => t.id));
    let done = 0;
    if (g.answers.doneWhen && counting.length) {
      const r = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM tasks WHERE goal_id = $1 AND status = 'done' AND template_id = ANY($2)`,
        [g.id, counting],
      );
      done = Number(r.rows[0]!.n);
    }
    const week = Math.floor(daysBetween(g.createdOn, today) / 7) + 1;
    const phase = g.plan.phases.find((p) => week >= p.startWeek && week <= p.endWeek) ?? g.plan.phases[g.plan.phases.length - 1];
    goalProgress.push({
      id: g.id, outcome: g.answers.outcome, template: g.answers.template, week, totalWeeks: g.plan.totalWeeks,
      phase: phase?.title ?? null, target: g.answers.doneWhen, done, warnings: g.plan.warnings,
    });
  }

  const msLeft = Math.max(0, day.ends_at.getTime() - now.getTime());
  const baseline = describeBaseline(await getBaseline(ctx), cycle.localDate);
  const inBaseline = !!baseline?.active;
  const paused = day.status === 'paused';
  const crew = crewMessages({
    pressure: settings.pressure,
    seed: daysBetween('2026-01-01', cycle.localDate),
    msLeft, tasksRequired: day.tasks_required, requiredDone, streak, reputation,
    lastResolved: lastResolved === 'done' || lastResolved === 'missed' || lastResolved === 'paused' ? lastResolved : null,
    paused: paused && !inBaseline,
    baseline: inBaseline,
  });
  const ramp = await getRamp(pool, settings);

  return {
    now: now.toISOString(),
    baseline,
    onboarded: (await getSetting(pool, 'profile')) !== undefined || goals.length > 0,
    day: {
      id: Number(day.id), localDate: cycle.localDate, status: day.status,
      startsAt: day.starts_at.toISOString(), endsAt: day.ends_at.toISOString(), msLeft,
      tasksRequired: day.tasks_required, requiredDone,
      success: requiredDone >= day.tasks_required,
    },
    tasks,
    budget: {
      capMinutes: budget.cap_minutes, earnedMinutes: budget.earned_minutes,
      usedMinutes: Math.round(usedMinutes),
      remainingMinutes: Math.max(0, budget.earned_minutes - Math.round(usedMinutes)),
    },
    player: {
      xp, level: lp.level, xpIntoLevel: lp.xpIntoLevel, xpForLevel: lp.xpForLevel,
      rank: rankForLevel(lp.level), streak, reputation, tasksPerDay: ramp.level,
    },
    wake: { goal: wakeGoal, today: wakeRes.rows[0]?.woke_at.toISOString() ?? null },
    timer: running ? { id: Number(running.id), kind: running.kind, label: running.label, startedAt: running.started_at.toISOString() } : null,
    timers: recentTimers.rows.map((t) => ({
      id: Number(t.id), kind: t.kind, label: t.label,
      startedAt: t.started_at.toISOString(), stoppedAt: t.stopped_at?.toISOString() ?? null,
    })),
    goals: goalProgress,
    crew,
    settings: {
      timezone: settings.timezone, dayEndsAt: settings.dayEndsAt, pressure: settings.pressure,
      dailyCapMinutes: settings.dailyCapMinutes,
    },
  };
}

export async function buildHistory(ctx: EngineCtx, days: number) {
  const { pool } = ctx;
  const { rows } = await pool.query<{
    local_date: string; status: string; tasks_required: number; done: string; earned: number | null; woke_at: Date | null;
  }>(
    `SELECT to_char(d.local_date, 'YYYY-MM-DD') AS local_date, d.status, d.tasks_required,
            (SELECT count(*) FROM tasks t WHERE t.day_id = d.id AND t.required AND t.status = 'done') AS done,
            b.earned_minutes AS earned,
            (SELECT w.woke_at FROM wake_logs w WHERE w.local_date = d.local_date) AS woke_at
       FROM days d LEFT JOIN budget_days b ON b.day_id = d.id
      ORDER BY d.local_date DESC LIMIT $1`,
    [days],
  );
  return rows.map((r) => ({
    localDate: r.local_date, status: r.status, tasksRequired: r.tasks_required,
    requiredDone: Number(r.done), earnedMinutes: r.earned ?? 0, wokeAt: r.woke_at?.toISOString() ?? null,
  }));
}
