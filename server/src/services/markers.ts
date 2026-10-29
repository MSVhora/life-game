import type { Pool } from '../db.js';
import { domainMatches } from '../domain/categories.js';
import { loadQuestTemplates, type EvidenceRule } from './settings.js';
import { computeRange, loadClassifier, type StatsCtx } from './stats.js';

const STUDY: EvidenceRule[] = [
  { type: 'folder_change', source: 'prep_folder' },
  { type: 'active_time', categories: ['Productive'], min_minutes: 20 },
];

/** Default activity hints for the built-in task types. Players can override per task in quests.*.yml. */
export const BUILTIN_EVIDENCE: Record<string, EvidenceRule[]> = {
  kickoff: [{ type: 'mac_active', min_minutes: 2 }],
  'add-company': [{ type: 'csv_new_row', source: 'targets_csv' }],
  'read-job-post': [{ type: 'csv_new_row', source: 'targets_csv' }],
  'apply-one': [{ type: 'csv_new_row', source: 'applications_csv' }],
  'log-application': [{ type: 'csv_new_row', source: 'applications_csv' }],
  'study-block': STUDY,
  'fix-resume-bullet': STUDY,
  'practice-problem': STUDY,
  'mock-answer': STUDY,
  'company-prep': STUDY,
};

export function evidenceFor(templateId: string | null, plannedMinutes: number | null, fromConfig: Map<string, EvidenceRule[]>): EvidenceRule[] {
  if (!templateId || templateId === 'bonus') return [];
  const configured = fromConfig.get(templateId);
  if (configured?.length) return configured;
  const builtin = BUILTIN_EVIDENCE[templateId];
  if (builtin) return builtin;
  const minutes = Math.max(5, Math.round((plannedMinutes ?? 15) * 0.8));
  return [{ type: 'active_time', categories: ['Productive'], min_minutes: minutes }];
}

interface Ev { ts: Date; payload: Record<string, unknown> }

async function eventsOfKind(pool: Pool, kind: string, from: Date, to: Date): Promise<Ev[]> {
  const { rows } = await pool.query<Ev>(
    `SELECT ts, payload FROM events WHERE kind = $1 AND ts >= $2 AND ts < $3 ORDER BY ts`,
    [kind, from, to],
  );
  return rows;
}

export interface Marker { type: string; ref: string }

/**
 * Looks for activity that matches a task's evidence rules during the current cycle.
 * Markers are hints only: they never complete a task by themselves.
 */
export async function runMarkers(ctx: StatsCtx): Promise<number> {
  const { pool, now } = ctx;
  const day = await pool.query<{ id: string; starts_at: Date; ends_at: Date }>(
    `SELECT id, starts_at, ends_at FROM days WHERE status = 'open' AND starts_at <= $1 AND ends_at > $1`,
    [now],
  );
  const d = day.rows[0];
  if (!d) return 0;
  const tasks = await pool.query<{ id: string; template_id: string | null; planned_minutes: number | null }>(
    `SELECT id, template_id, planned_minutes FROM tasks WHERE day_id = $1 AND status = 'pending'`,
    [d.id],
  );
  if (!tasks.rows.length) return 0;

  const configured = new Map(loadQuestTemplates(ctx.configDir).filter((t) => t.evidence).map((t) => [t.id, t.evidence!]));
  const plan = tasks.rows.map((t) => ({ id: Number(t.id), rules: evidenceFor(t.template_id, t.planned_minutes, configured) }));
  const needed = new Set(plan.flatMap((p) => p.rules.map((r) => r.type)));
  if (!needed.size) return 0;

  const range = { start: d.starts_at.getTime(), end: Math.min(d.ends_at.getTime(), now.getTime()) };
  const timeline = needed.has('mac_active') || needed.has('active_time')
    ? await computeRange(ctx, range, await loadClassifier(pool, ctx.configDir))
    : null;
  const web = needed.has('site_visit') ? await eventsOfKind(pool, 'web', d.starts_at, now) : [];
  const csv = needed.has('csv_new_row') ? await eventsOfKind(pool, 'csv_rows', d.starts_at, now) : [];
  const folder = needed.has('folder_change') ? await eventsOfKind(pool, 'folder_change', d.starts_at, now) : [];
  const git = needed.has('git_commit') ? await eventsOfKind(pool, 'git_commit', d.starts_at, now) : [];

  const evaluate = async (rule: EvidenceRule): Promise<string | null> => {
    switch (rule.type) {
      case 'mac_active': {
        const active = timeline!.segments.filter((s) => s.kind !== 'away' && s.kind !== 'manual').reduce((a, s) => a + (s.end - s.start), 0);
        return active >= (rule.min_minutes ?? 2) * 60_000 ? 'Mac in use' : null;
      }
      case 'active_time': {
        const cats = rule.categories ?? ['Productive'];
        const sec = cats.reduce((a, c) => a + ((timeline!.totals as Record<string, number>)[c] ?? 0), 0);
        return sec >= (rule.min_minutes ?? 10) * 60 ? `${Math.round(sec / 60)} min ${cats.join('/').toLowerCase()}` : null;
      }
      case 'site_visit': {
        const doms = rule.domains ?? [];
        const hit = web.filter((e) => typeof e.payload.domain === 'string' && doms.some((x) => domainMatches(String(e.payload.domain), x)));
        const sec = hit.reduce((a, e) => a + Number(e.payload.duration ?? 0), 0);
        if (!hit.length || sec < (rule.min_seconds ?? 20)) return null;
        const longest = hit.reduce((x, y) => (Number(y.payload.duration ?? 0) > Number(x.payload.duration ?? 0) ? y : x));
        return String(longest.payload.domain);
      }
      case 'csv_new_row': {
        const rows = csv.filter((e) => e.payload.source === rule.source).map((e) => Number(e.payload.rows));
        if (rows.length === 0) return null;
        const before = await pool.query<{ rows: string }>(
          `SELECT payload->>'rows' AS rows FROM events WHERE kind = 'csv_rows' AND payload->>'source' = $1 AND ts < $2 ORDER BY ts DESC LIMIT 1`,
          [rule.source, d.starts_at],
        );
        const baseline = before.rows[0] ? Number(before.rows[0].rows) : rows[0]!;
        const delta = rows[rows.length - 1]! - baseline;
        return delta > 0 ? `${delta} new row${delta > 1 ? 's' : ''}` : null;
      }
      case 'folder_change': {
        const hit = folder.find((e) => e.payload.source === rule.source);
        return hit ? `files changed in ${rule.source}` : null;
      }
      case 'git_commit': {
        const n = git.filter((e) => e.payload.repo === rule.source).length;
        return n ? `${n} commit${n > 1 ? 's' : ''}` : null;
      }
      default:
        return null;
    }
  };

  let added = 0;
  for (const t of plan) {
    for (const rule of t.rules) {
      const ref = await evaluate(rule);
      if (!ref) continue;
      const r = await pool.query(
        `INSERT INTO task_markers (task_id, type, ref) VALUES ($1, $2, $3) ON CONFLICT (task_id, type) DO NOTHING`,
        [t.id, rule.type, ref],
      );
      added += r.rowCount ?? 0;
    }
  }
  return added;
}

export async function markersByTask(pool: Pool, taskIds: number[]): Promise<Map<number, Marker[]>> {
  const out = new Map<number, Marker[]>();
  if (!taskIds.length) return out;
  const { rows } = await pool.query<{ task_id: string; type: string; ref: string | null }>(
    'SELECT task_id, type, ref FROM task_markers WHERE task_id = ANY($1::bigint[]) ORDER BY id',
    [taskIds],
  );
  for (const r of rows) {
    const list = out.get(Number(r.task_id)) ?? [];
    list.push({ type: r.type, ref: r.ref ?? '' });
    out.set(Number(r.task_id), list);
  }
  return out;
}
