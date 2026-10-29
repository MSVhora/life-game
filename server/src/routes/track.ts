import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from '../db.js';
import { CATEGORIES } from '../domain/categories.js';
import { localDateString } from '../domain/time.js';
import { baselineSummary, describeBaseline, endBaseline, getBaseline, startBaseline } from '../services/baseline.js';
import { buildReport, RANGES } from '../services/reports.js';
import { freelanceSummary, syncTimeEntries, type TimeTrackerConfig } from '../services/timetracker.js';
import { loadSettings } from '../services/settings.js';
import { datesTouched, markDirty, recomputeDirty, type StatsCtx } from '../services/stats.js';

export interface TrackDeps {
  pool: Pool;
  configDir: string;
  clock: () => Date;
  timeTracker: TimeTrackerConfig | null;
  fetcher?: typeof fetch;
}

const eventSchema = z.object({
  source: z.enum(['activitywatch', 'folder', 'android']),
  kind: z.string().trim().min(1).max(40),
  ts: z.string().datetime({ offset: true }),
  durationSec: z.number().min(0).max(172_800).default(0),
  key: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()).default({}),
});
const ingestBody = z.object({ events: z.array(eventSchema).min(1).max(1000) });

const labelBody = z.object({
  kind: z.enum(['app', 'domain']),
  value: z.string().trim().min(1).max(200),
  category: z.enum(CATEGORIES),
});

export async function trackRoutes(app: FastifyInstance, deps: TrackDeps) {
  const { pool, configDir, clock, timeTracker, fetcher } = deps;
  const ctx = async (): Promise<StatsCtx> => ({ pool, configDir, now: clock(), settings: await loadSettings(pool, configDir) });

  // Devices (the Mac agent) send batches of events. Re-sending the same key updates it, because
  // ActivityWatch merges heartbeats into one event whose duration keeps growing.
  app.post('/api/ingest/events', { preHandler: app.requireDevice, bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const body = ingestBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues.slice(0, 5) });
    const { events } = body.data;
    const c = await ctx();

    const res = await pool.query<{ inserted: boolean }>(
      `INSERT INTO events (device_id, source, kind, payload, ts, idempotency_key)
       SELECT $1, t.source, t.kind, t.payload::jsonb, t.ts::timestamptz, t.key
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS t(source, kind, payload, ts, key)
       ON CONFLICT (device_id, idempotency_key) DO UPDATE
         SET payload = EXCLUDED.payload, ts = EXCLUDED.ts, received_at = now()
         WHERE events.payload IS DISTINCT FROM EXCLUDED.payload OR events.ts IS DISTINCT FROM EXCLUDED.ts
       RETURNING (xmax = 0) AS inserted`,
      [
        req.device!.id,
        events.map((e) => e.source),
        events.map((e) => e.kind),
        events.map((e) => JSON.stringify({ ...e.data, duration: e.durationSec })),
        events.map((e) => e.ts),
        events.map((e) => e.key),
      ],
    );

    const dirty = new Set<string>();
    for (const e of events) {
      const start = Date.parse(e.ts);
      for (const d of datesTouched(start, start + e.durationSec * 1000, c.settings.timezone)) dirty.add(d);
    }
    await markDirty(pool, [...dirty]);
    const inserted = res.rows.filter((r) => r.inserted).length;
    return { received: events.length, inserted, updated: res.rows.length - inserted };
  });

  app.get('/api/reports', { preHandler: app.requireUser }, async (req, reply) => {
    const q = z.object({ range: z.enum(RANGES).default('today') }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_range' });
    return buildReport(await ctx(), q.data.range);
  });

  app.get('/api/labels', { preHandler: app.requireUser }, async () => {
    const { rows } = await pool.query('SELECT kind, value, category FROM app_labels ORDER BY kind, value');
    return { labels: rows };
  });

  app.post('/api/labels', { preHandler: app.requireUser }, async (req, reply) => {
    const body = labelBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const value = body.data.kind === 'domain' ? body.data.value.toLowerCase().replace(/^www\./, '') : body.data.value;
    await pool.query(
      `INSERT INTO app_labels (kind, value, category) VALUES ($1, $2, $3)
       ON CONFLICT (kind, value) DO UPDATE SET category = EXCLUDED.category`,
      [body.data.kind, value, body.data.category],
    );
    await relabel(await ctx());
    return reply.code(204).send();
  });

  app.delete('/api/labels', { preHandler: app.requireUser }, async (req, reply) => {
    const q = z.object({ kind: z.enum(['app', 'domain']), value: z.string().min(1).max(200) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const r = await pool.query('DELETE FROM app_labels WHERE kind = $1 AND value = $2', [q.data.kind, q.data.value]);
    if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
    await relabel(await ctx());
    return reply.code(204).send();
  });

  app.get('/api/baseline', { preHandler: app.requireUser }, async () => {
    const c = await ctx();
    const b = await getBaseline(c);
    const info = describeBaseline(b, localDateString(c.now, c.settings.timezone));
    return { baseline: info, summary: b ? await baselineSummary(c) : null };
  });
  app.post('/api/baseline/start', { preHandler: app.requireUser }, async () => {
    const c = await ctx();
    const b = await startBaseline(c);
    return { baseline: describeBaseline(b, localDateString(c.now, c.settings.timezone)) };
  });
  app.post('/api/baseline/end', { preHandler: app.requireUser }, async (req) => {
    const body = z.object({ skip: z.boolean().default(false) }).parse(req.body ?? {});
    const c = await ctx();
    await endBaseline(c, body.skip);
    const b = await getBaseline(c);
    return { baseline: describeBaseline(b, localDateString(c.now, c.settings.timezone)), summary: b ? await baselineSummary(c) : null };
  });

  app.get('/api/freelance', { preHandler: app.requireUser }, async () => {
    const c = await ctx();
    return freelanceSummary({ pool, timezone: c.settings.timezone, now: c.now }, configDir, !!timeTracker);
  });
  app.post('/api/freelance/sync', { preHandler: app.requireUser }, async (_req, reply) => {
    if (!timeTracker) return reply.code(503).send({ error: 'not_configured', message: 'Set TIMETRACKER_API_URL and TIMETRACKER_API_TOKEN in .env.' });
    const c = await ctx();
    try {
      await syncTimeEntries({ pool, timezone: c.settings.timezone, now: c.now }, timeTracker, fetcher);
    } catch (e) {
      return reply.code(502).send({ error: 'sync_failed', message: (e as Error).message });
    }
    return freelanceSummary({ pool, timezone: c.settings.timezone, now: c.now }, configDir, true);
  });

  /** After a label change every stored day may classify differently: mark them and redo the newest ones now. */
  async function relabel(c: StatsCtx) {
    const { rows } = await pool.query<{ d: string }>(
      `SELECT to_char(local_date, 'YYYY-MM-DD') AS d FROM daily_stats WHERE local_date >= $1::date - 400`,
      [localDateString(c.now, c.settings.timezone)],
    );
    await markDirty(pool, rows.map((r) => r.d));
    await recomputeDirty(c, 8);
  }
}
