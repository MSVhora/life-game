import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from '../db.js';
import { EngineError, logWake, startTimer, stopTimer, TIMER_KINDS, type EngineCtx } from '../services/engine.js';
import { loadSettings } from '../services/settings.js';
import { gamingAppNames } from '../services/stats.js';
import { buildState } from '../services/state.js';

export interface CompanionDeps { pool: Pool; configDir: string; clock: () => Date }

/** Endpoints for the Android companion app. They use the device token, not the browser session. */
export async function companionRoutes(app: FastifyInstance, deps: CompanionDeps) {
  const { pool, configDir, clock } = deps;
  const guard = { preHandler: app.requireDevice };
  const ctx = async (): Promise<EngineCtx> => ({ pool, configDir, now: clock(), settings: await loadSettings(pool, configDir) });

  // Everything the phone needs for its countdown notification and nudges, in one small call.
  app.get('/api/device/status', guard, async () => {
    const c = await ctx();
    const s = await buildState(c);
    return {
      serverTime: s.now,
      timezone: c.settings.timezone,
      day: s.day,
      budget: s.budget,
      wake: { goal: s.wake.goal, today: s.wake.today, source: c.settings.wakeSource },
      timer: s.timer,
      baseline: !!s.baseline?.active,
      pressure: c.settings.pressure,
      gamingApps: await gamingAppNames(pool, configDir),
    };
  });

  app.post('/api/device/wake', guard, async () => {
    const r = await logWake(await ctx());
    return { wokeAt: r.wokeAt.toISOString(), beforeGoal: r.beforeGoal, xp: r.xp, alreadyLogged: r.alreadyLogged };
  });

  app.post('/api/device/timers/start', guard, async (req, reply) => {
    const body = z.object({ kind: z.enum(TIMER_KINDS) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    await startTimer(await ctx(), body.data.kind, null);
    return reply.code(204).send();
  });

  app.post('/api/device/timers/stop', guard, async () => ({ stopped: await stopTimer(await ctx()) }));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof EngineError) return reply.code(409).send({ error: err.code, message: err.message });
    app.log.error(err);
    return reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: 'server_error' });
  });
}
