import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from '../db.js';
import { buildPlan, goalAnswersSchema, type StoredGoal } from '../domain/goalPlan.js';
import { addDays, cycleFor, localDateString } from '../domain/time.js';
import {
  addBonusTask, clearPause, completeTask, EngineError, logWake, setPause, startTimer, stopTimer,
  TIMER_KINDS, undoTask, type EngineCtx,
} from '../services/engine.js';
import {
  defaultSettings, getGoals, loadSettings, profilePatchSchema, putGoals, saveProfilePatch,
} from '../services/settings.js';
import { buildHistory, buildState } from '../services/state.js';

export interface GameRouteDeps {
  pool: Pool;
  configDir: string;
  clock: () => Date;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });
const dateParam = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const PAUSE_REASONS = ['family', 'travel', 'festival', 'illness', 'other'] as const;

export async function gameRoutes(app: FastifyInstance, deps: GameRouteDeps) {
  const { pool, configDir, clock } = deps;
  const guard = { preHandler: app.requireUser };

  const ctx = async (): Promise<EngineCtx> => ({
    pool, configDir, now: clock(), settings: await loadSettings(pool, configDir),
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof EngineError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'invalid' ? 400 : 409;
      return reply.code(status).send({ error: err.code, message: err.message });
    }
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_body', issues: err.issues });
    app.log.error(err);
    return reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: 'server_error' });
  });

  /** Drop today's cycle if nothing was done in it, so changes to goals/schedule apply immediately. */
  async function resetOpenDay(c: EngineCtx) {
    await pool.query(
      `DELETE FROM days d WHERE d.status = 'open' AND d.ends_at > $1
         AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.day_id = d.id AND t.status = 'done')`,
      [c.now],
    );
  }

  app.get('/api/state', guard, async () => buildState(await ctx()));

  app.post('/api/tasks/:id/complete', guard, async (req, reply) => {
    await completeTask(await ctx(), idParam.parse(req.params).id);
    return reply.code(204).send();
  });
  app.post('/api/tasks/:id/undo', guard, async (req, reply) => {
    await undoTask(await ctx(), idParam.parse(req.params).id);
    return reply.code(204).send();
  });
  app.post('/api/tasks', guard, async (req, reply) => {
    const body = z.object({ title: z.string().trim().min(1).max(120), minutes: z.number().int().min(1).max(600).nullable().default(null) }).parse(req.body);
    const id = await addBonusTask(await ctx(), body.title, body.minutes);
    return reply.code(201).send({ id });
  });

  app.post('/api/wake', guard, async () => {
    const r = await logWake(await ctx());
    return { wokeAt: r.wokeAt.toISOString(), beforeGoal: r.beforeGoal, xp: r.xp, alreadyLogged: r.alreadyLogged };
  });

  app.post('/api/timers/start', guard, async (req, reply) => {
    const body = z.object({ kind: z.enum(TIMER_KINDS), label: z.string().trim().max(60).nullable().default(null) }).parse(req.body);
    await startTimer(await ctx(), body.kind, body.label);
    return reply.code(204).send();
  });
  app.post('/api/timers/stop', guard, async () => {
    const r = await stopTimer(await ctx());
    return { stopped: r };
  });

  app.get('/api/profile', guard, async () => {
    const settings = await loadSettings(pool, configDir);
    return { settings, defaults: defaultSettings(configDir) };
  });
  app.put('/api/profile', guard, async (req) => {
    const patch = profilePatchSchema.strict().parse(req.body);
    const c = await ctx();
    const settings = await saveProfilePatch(pool, configDir, patch);
    await resetOpenDay({ ...c, settings });
    return { settings };
  });

  app.get('/api/goals', guard, async () => ({ goals: await getGoals(pool) }));
  app.post('/api/goals/preview', guard, async (req) => ({ plan: buildPlan(goalAnswersSchema.parse(req.body)) }));
  app.post('/api/goals', guard, async (req, reply) => {
    const answers = goalAnswersSchema.parse(req.body);
    const c = await ctx();
    const goals = await getGoals(pool);
    if (goals.length >= 3) return reply.code(409).send({ error: 'too_many_goals', message: 'Keep it to 3 goals at a time.' });
    const goal: StoredGoal = {
      id: randomUUID().slice(0, 8),
      createdOn: localDateString(c.now, c.settings.timezone),
      answers,
      plan: buildPlan(answers),
    };
    await putGoals(pool, [...goals, goal]);
    await resetOpenDay(c);
    // If today still exists, the player already did something in it: the goal starts with tomorrow's tasks.
    const kept = await pool.query('SELECT 1 FROM days WHERE status = \'open\' AND starts_at <= $1 AND ends_at > $1', [c.now]);
    return reply.code(201).send({ goal, appliesFrom: kept.rowCount ? 'tomorrow' : 'today' });
  });
  app.delete('/api/goals/:id', guard, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const goals = await getGoals(pool);
    if (!goals.some((g) => g.id === id)) return reply.code(404).send({ error: 'not_found' });
    await putGoals(pool, goals.filter((g) => g.id !== id));
    await resetOpenDay(await ctx());
    return reply.code(204).send();
  });

  app.get('/api/pause', guard, async () => {
    const { rows } = await pool.query(
      `SELECT to_char(local_date, 'YYYY-MM-DD') AS "localDate", reason, note FROM pause_days ORDER BY local_date DESC LIMIT 60`,
    );
    return { pauses: rows };
  });
  app.post('/api/pause', guard, async (req, reply) => {
    const c = await ctx();
    // "Today" means the current 24h cycle, which can already be labelled tomorrow's date late in the evening.
    const today = cycleFor(c.now, c.settings.timezone, c.settings.dayEndsAt).localDate;
    const body = z.object({
      localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(today),
      reason: z.enum(PAUSE_REASONS),
      note: z.string().trim().max(200).nullable().default(null),
    }).parse(req.body);
    if (body.localDate < addDays(today, -1)) return reply.code(400).send({ error: 'invalid', message: 'Cannot pause days that are long past.' });
    await setPause(c, body.localDate, body.reason, body.note);
    return reply.code(204).send();
  });
  app.delete('/api/pause/:date', guard, async (req, reply) => {
    await clearPause(await ctx(), dateParam.parse(req.params).date);
    return reply.code(204).send();
  });

  app.get('/api/history', guard, async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(400).default(14) }).parse(req.query);
    return { days: await buildHistory(await ctx(), days) };
  });
}
