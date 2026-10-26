import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_YAML, login, makeClock, makeConfigDir, setupApp, testDatabaseUrl, type TestClock, type TestEnv,
} from './helpers.js';

type Env = TestEnv & { clock: TestClock };
const HOUR = 3_600_000;

class Client {
  constructor(private env: Env, private cookie: string) {}
  async req(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
    const res = await this.env.app.inject({ method, url, headers: { cookie: this.cookie }, payload: payload as object });
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null };
  }
  state = async () => (await this.req('GET', '/api/state')).body as State;
}
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

interface State {
  day: { id: number; localDate: string; status: string; msLeft: number; tasksRequired: number; requiredDone: number; success: boolean; endsAt: string };
  tasks: Array<{ id: number; title: string; required: boolean; status: string; xp: number; rewardMinutes: number; templateId: string }>;
  budget: { capMinutes: number; earnedMinutes: number; usedMinutes: number; remainingMinutes: number };
  player: { xp: number; level: number; streak: number; reputation: number; tasksPerDay: number };
  wake: { goal: string; today: string | null };
  timer: { kind: string } | null;
  goals: Array<{ id: string; phase: string | null; done: number }>;
  crew: Array<{ from: string; text: string }>;
}

/** Plays one cycle: completes `count` required tasks (or none), then moves past the day's end. */
async function playDay(c: Client, env: Env, count: number) {
  const s = await c.state();
  const required = s.tasks.filter((t) => t.required);
  for (const t of required.slice(0, count)) await c.req('POST', `/api/tasks/${t.id}/complete`);
  env.clock.set(s.day.endsAt);
  env.clock.advanceMs(60_000); // just past the end
  return s;
}

describe.skipIf(!testDatabaseUrl)('game engine and API', () => {
  let env: Env;
  let c: Client;

  beforeEach(async () => {
    env = (await setupApp({ clock: makeClock('2026-10-26T06:00:00Z'), configDir: makeConfigDir() })) as Env;
    c = new Client(env, await login(env.app));
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it('requires login for every game route', async () => {
    for (const [m, u] of [['GET', '/api/state'], ['POST', '/api/wake'], ['GET', '/api/history'], ['GET', '/api/goals'], ['GET', '/api/profile']] as const) {
      const res = await env.app.inject({ method: m, url: u });
      expect(res.statusCode, `${m} ${u}`).toBe(401);
    }
  });

  it('deals a kickoff plus required tasks with rewards and a countdown', async () => {
    const s = await c.state();
    expect(s.day.status).toBe('open');
    expect(s.day.localDate).toBe('2026-10-26');
    expect(s.day.msLeft).toBe(11.5 * HOUR); // 06:00Z (11:30 IST) until 23:00 IST (17:30Z)
    expect(s.tasks[0]!.templateId).toBe('kickoff');
    expect(s.tasks[0]!.required).toBe(false);
    const required = s.tasks.filter((t) => t.required);
    expect(required).toHaveLength(2);
    expect(required.every((t) => t.rewardMinutes === 60)).toBe(true);
    expect(s.budget).toMatchObject({ capMinutes: 120, earnedMinutes: 0, usedMinutes: 0 });
    expect(s.crew.length).toBeGreaterThan(0);
  });

  it('creates exactly one day under concurrent requests', async () => {
    await Promise.all([1, 2, 3, 4, 5].map(() => c.state()));
    const { rows } = await env.pool.query('SELECT count(*)::int AS n FROM days');
    expect(rows[0].n).toBe(1);
    const t = await env.pool.query('SELECT count(*)::int AS n FROM tasks');
    expect(t.rows[0].n).toBe(3);
  });

  it('completing tasks earns xp and gaming minutes, and undo reverses it', async () => {
    const s = await c.state();
    const [a] = s.tasks.filter((t) => t.required);
    expect((await c.req('POST', `/api/tasks/${a!.id}/complete`)).status).toBe(204);
    let after = await c.state();
    expect(after.player.xp).toBe(a!.xp);
    expect(after.budget.earnedMinutes).toBe(60);
    expect(after.day.requiredDone).toBe(1);

    expect((await c.req('POST', `/api/tasks/${a!.id}/complete`)).status).toBe(409); // already done
    expect((await c.req('POST', `/api/tasks/${a!.id}/undo`)).status).toBe(204);
    after = await c.state();
    expect(after.player.xp).toBe(0);
    expect(after.budget.earnedMinutes).toBe(0);
    expect((await c.req('POST', `/api/tasks/${a!.id}/undo`)).status).toBe(409); // not done
    expect((await c.req('POST', '/api/tasks/999999/complete')).status).toBe(404);
  });

  it('rejects completing a task after the day has ended', async () => {
    const s = await c.state();
    const t = s.tasks.find((x) => x.required)!;
    env.clock.set(s.day.endsAt);
    env.clock.advanceMs(1000);
    const res = await c.req('POST', `/api/tasks/${t.id}/complete`);
    expect(res.status).toBe(409);
  });

  it('a won day gets a bonus, a streak and a fresh next day', async () => {
    const dealt = await playDay(c, env, 2);
    const next = await c.state();
    expect(next.day.localDate).toBe('2026-10-27');
    expect(next.player.streak).toBe(1);
    const taskXp = dealt.tasks.filter((t) => t.required).reduce((a, t) => a + t.xp, 0);
    expect(next.player.xp).toBe(taskXp + 20); // two tasks + first-day bonus
    const days = await env.pool.query(`SELECT status FROM days ORDER BY local_date`);
    expect(days.rows.map((r) => r.status)).toEqual(['done', 'open']);
    expect(next.budget.capMinutes).toBe(120);
  });

  it('a missed day halves the next day budget and shrinks rewards', async () => {
    await playDay(c, env, 1); // one of two required: missed
    const next = await c.state();
    expect(next.player.streak).toBe(0);
    expect(next.budget.capMinutes).toBe(60);
    expect(next.tasks.filter((t) => t.required).every((t) => t.rewardMinutes === 30)).toBe(true);
    const days = await env.pool.query(`SELECT status FROM days ORDER BY local_date`);
    expect(days.rows[0].status).toBe('missed');
  });

  it('data_only pressure removes the budget penalty', async () => {
    await c.req('PUT', '/api/profile', { pressure: 'data_only' });
    await playDay(c, env, 0);
    const next = await c.state();
    expect(next.budget.capMinutes).toBe(120);
  });

  it('one miss a week is forgiven for the streak', async () => {
    await playDay(c, env, 2);
    await playDay(c, env, 0); // miss
    await playDay(c, env, 2);
    const s = await c.state();
    expect(s.player.streak).toBe(2);
  });

  it('paused days block completion, are not penalised and keep the streak', async () => {
    await playDay(c, env, 2);
    const s = await c.state();
    expect((await c.req('POST', '/api/pause', { reason: 'family', note: 'visit' })).status).toBe(204);
    const paused = await c.state();
    expect(paused.day.status).toBe('paused');
    const t = s.tasks.find((x) => x.required)!;
    expect((await c.req('POST', `/api/tasks/${t.id}/complete`)).status).toBe(409);
    expect(paused.crew[0]!.text).toMatch(/Day off/);

    await playDay(c, env, 0);
    const after = await c.state();
    expect(after.player.streak).toBe(1);
    expect(after.budget.capMinutes).toBe(120);
    expect((await c.req('DELETE', `/api/pause/${paused.day.localDate}`)).status).toBe(204);
  });

  it('rejects pausing long-past days and bad reasons', async () => {
    expect((await c.req('POST', '/api/pause', { reason: 'family', localDate: '2020-01-01' })).status).toBe(400);
    expect((await c.req('POST', '/api/pause', { reason: 'bored' })).status).toBe(400);
  });

  it('adds a task per day after enough good days (ramp) and lowers rewards', async () => {
    // Rebuild with a 1-task start and a 90 minute cap.
    await env.cleanup();
    const player = DEFAULT_PLAYER_YAML.replace('tasks_required: 2', 'tasks_required: 1').replace('daily_cap_minutes: 120', 'daily_cap_minutes: 90');
    env = (await setupApp({ configDir: makeConfigDir(player) })) as Env;
    c = new Client(env, await login(env.app));

    let s = await c.state();
    expect(s.tasks.filter((t) => t.required)).toHaveLength(1);
    expect(s.tasks.find((t) => t.required)!.rewardMinutes).toBe(60);
    for (let i = 0; i < 5; i++) await playDay(c, env, 1);
    s = await c.state();
    expect(s.player.tasksPerDay).toBe(2);
    const req = s.tasks.filter((t) => t.required);
    expect(req).toHaveLength(2);
    expect(req.every((t) => t.rewardMinutes === 45)).toBe(true);
    expect(s.day.tasksRequired).toBe(2);
  });

  it('timers: one at a time, blocks recorded, gaming counts against the budget', async () => {
    expect((await c.req('POST', '/api/timers/start', { kind: 'lunch' })).status).toBe(204);
    env.clock.advanceMs(45 * 60_000);
    expect((await c.state()).timer!.kind).toBe('lunch');
    expect((await c.req('POST', '/api/timers/start', { kind: 'gaming' })).status).toBe(204); // stops lunch
    env.clock.advanceMs(30 * 60_000);
    let s = await c.state();
    expect(s.timer!.kind).toBe('gaming');
    expect(s.budget.usedMinutes).toBe(30);
    const stop = await c.req('POST', '/api/timers/stop');
    expect((stop.body as { stopped: { kind: string; minutes: number } }).stopped).toEqual({ kind: 'gaming', minutes: 30 });
    s = await c.state();
    expect(s.timer).toBeNull();
    expect(s.budget.usedMinutes).toBe(30);
    const blocks = await env.pool.query(`SELECT category, label FROM time_blocks ORDER BY start_at`);
    expect(blocks.rows).toEqual([{ category: 'Neutral', label: 'lunch' }, { category: 'Gaming', label: 'gaming' }]);
    expect((await c.req('POST', '/api/timers/stop')).body).toEqual({ stopped: null });
    expect((await c.req('POST', '/api/timers/start', { kind: 'nonsense' })).status).toBe(400);
  });

  it('wake: logged once per day, ends a sleep timer, xp depends on the goal', async () => {
    await c.req('POST', '/api/timers/start', { kind: 'sleep' });
    env.clock.set('2026-10-26T05:00:00Z'); // 10:30 IST, before the 12:00 goal
    const first = await c.req('POST', '/api/wake');
    expect(first.body).toMatchObject({ beforeGoal: true, xp: 15, alreadyLogged: false });
    const again = await c.req('POST', '/api/wake');
    expect(again.body).toMatchObject({ alreadyLogged: true, xp: 0 });
    const s = await c.state();
    expect(s.timer).toBeNull();
    expect(s.wake.today).not.toBeNull();
    expect(s.player.xp).toBe(15);
  });

  it('wake after the goal earns less', async () => {
    env.clock.set('2026-10-26T09:30:00Z'); // 15:00 IST
    const r = await c.req('POST', '/api/wake');
    expect(r.body).toMatchObject({ beforeGoal: false, xp: 5 });
  });

  it('goals: preview, create, deal from the plan, progress, limits and delete', async () => {
    const answers = {
      template: 'get_job', outcome: 'Get an Android role', deadlineWeeks: 8,
      doneWhen: { unit: 'applications', target: 30 }, startState: 'ready', hoursPerWeek: 6, startBlocker: 'dont_open_it',
    };
    const preview = await c.req('POST', '/api/goals/preview', answers);
    expect(preview.status).toBe(200);
    expect((preview.body as { plan: { phases: unknown[] } }).plan.phases.length).toBeGreaterThan(0);
    expect((await c.req('POST', '/api/goals/preview', { ...answers, hoursPerWeek: -1 })).status).toBe(400);

    await c.state(); // deal default tasks first
    const created = await c.req('POST', '/api/goals', answers);
    expect(created.status).toBe(201);
    const s = await c.state(); // today re-dealt from the goal (nothing was done yet)
    const titles = s.tasks.filter((t) => t.required).map((t) => t.title);
    expect(titles.some((t) => /Apply to 1 role|focused study block/i.test(t))).toBe(true);
    expect(s.goals).toHaveLength(1);
    expect(s.goals[0]!.phase).toBe('Apply');

    const apply = s.tasks.find((t) => t.templateId === 'apply-one');
    if (apply) {
      await c.req('POST', `/api/tasks/${apply.id}/complete`);
      expect((await c.state()).goals[0]!.done).toBe(1);
    }

    await c.req('POST', '/api/goals', { ...answers, outcome: 'second' });
    await c.req('POST', '/api/goals', { ...answers, outcome: 'third' });
    expect((await c.req('POST', '/api/goals', { ...answers, outcome: 'fourth' })).status).toBe(409);

    const list = (await c.req('GET', '/api/goals')).body as { goals: Array<{ id: string }> };
    expect((await c.req('DELETE', `/api/goals/${list.goals[0]!.id}`)).status).toBe(204);
    expect((await c.req('DELETE', '/api/goals/nope')).status).toBe(404);
  });

  it('profile: validates input, applies changes and rejects unknown keys', async () => {
    expect((await c.req('PUT', '/api/profile', { dayEndsAt: '25:99' })).status).toBe(400);
    expect((await c.req('PUT', '/api/profile', { timezone: 'Mars/Base' })).status).toBe(400);
    expect((await c.req('PUT', '/api/profile', { hacker: true })).status).toBe(400);
    const ok = await c.req('PUT', '/api/profile', { dayEndsAt: '22:00', dailyCapMinutes: 90 });
    expect(ok.status).toBe(200);
    const s = await c.state();
    expect(s.budget.capMinutes).toBe(90);
    expect(new Date(s.day.endsAt).toISOString()).toBe('2026-10-26T16:30:00.000Z');
    const prof = (await c.req('GET', '/api/profile')).body as { settings: { dayEndsAt: string }; defaults: { dayEndsAt: string } };
    expect(prof.settings.dayEndsAt).toBe('22:00');
    expect(prof.defaults.dayEndsAt).toBe('23:00');
  });

  it('bonus tasks give xp but no gaming minutes', async () => {
    const r = await c.req('POST', '/api/tasks', { title: 'Tidy desk', minutes: 10 });
    expect(r.status).toBe(201);
    const s = await c.state();
    const bonus = s.tasks.find((t) => t.title === 'Tidy desk')!;
    expect(bonus.required).toBe(false);
    await c.req('POST', `/api/tasks/${bonus.id}/complete`);
    const after = await c.state();
    expect(after.player.xp).toBe(10);
    expect(after.budget.earnedMinutes).toBe(0);
    expect(after.day.requiredDone).toBe(0);
  });

  it('history lists resolved days with counts', async () => {
    await playDay(c, env, 2);
    await playDay(c, env, 1);
    await c.state();
    const h = (await c.req('GET', '/api/history?days=7')).body as { days: Array<{ localDate: string; status: string; requiredDone: number }> };
    expect(h.days.map((d) => d.status)).toEqual(['open', 'missed', 'done']);
    expect(h.days[2]!.requiredDone).toBe(2);
  });

  it('is safe if the server skipped days (catch-up resolves old cycles)', async () => {
    await c.state();
    env.clock.advanceMs(3 * 24 * HOUR);
    const s = await c.state();
    expect(s.day.status).toBe('open');
    const days = await env.pool.query(`SELECT status FROM days ORDER BY local_date`);
    expect(days.rows.map((r) => r.status)).toEqual(['missed', 'open']);
  });
});
