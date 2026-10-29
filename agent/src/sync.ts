import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AwClient, convertEvent, SUPPORTED_BUCKET_TYPES, type OutEvent } from './aw.js';
import type { AgentConfig } from './config.js';
import { collectFolderEvents, emptyFolderState, type FolderState } from './folders.js';

export interface AgentState {
  /** Per ActivityWatch bucket: epoch ms up to which events were delivered. */
  buckets: Record<string, number>;
  folders: FolderState;
}

export const emptyState = (): AgentState => ({ buckets: {}, folders: emptyFolderState() });

export function loadState(dir: string): AgentState {
  const file = path.join(dir, 'state.json');
  if (!existsSync(file)) return emptyState();
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AgentState>;
    return { buckets: raw.buckets ?? {}, folders: { ...emptyFolderState(), ...(raw.folders ?? {}) } };
  } catch {
    return emptyState(); // a damaged state file only means a re-send, which the server de-duplicates
  }
}

export function saveState(dir: string, state: AgentState): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'state.json');
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

/** The server rejected our token: retrying is pointless until the player fixes it. */
export class FatalError extends Error {}

const OVERLAP_MS = 10 * 60_000; // ActivityWatch merges heartbeats, so recent events can still grow
const BATCH = 500;

async function post(cfg: AgentConfig, events: OutEvent[], f: typeof fetch): Promise<void> {
  for (let i = 0; i < events.length; i += BATCH) {
    const res = await f(`${cfg.serverUrl}/api/ingest/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ events: events.slice(i, i + BATCH) }),
    });
    if (res.status === 401) throw new FatalError('The server refused the device token. Create a new one in the app (More > Connect a device).');
    if (!res.ok) throw new Error(`Server answered ${res.status} while sending events`);
  }
}

export interface SyncResult { sent: number; buckets: number; awReachable: boolean; errors: string[] }

/** One pass: ActivityWatch buckets, then folders. State only advances for what the server accepted. */
export async function syncOnce(cfg: AgentConfig, state: AgentState, deps: { now?: Date; fetcher?: typeof fetch } = {}): Promise<SyncResult> {
  const now = deps.now ?? new Date();
  const f = deps.fetcher ?? fetch;
  const result: SyncResult = { sent: 0, buckets: 0, awReachable: true, errors: [] };
  const aw = new AwClient(cfg.awUrl, f);
  const privacy = { sendTitles: cfg.sendTitles, fullUrlDomains: cfg.fullUrlDomains };

  let buckets: Awaited<ReturnType<AwClient['buckets']>>;
  try {
    buckets = (await aw.buckets()).filter((b) => SUPPORTED_BUCKET_TYPES.includes(b.type));
  } catch (e) {
    result.awReachable = false;
    result.errors.push(`ActivityWatch is not reachable at ${cfg.awUrl} (${(e as Error).message})`);
    buckets = [];
  }

  for (const bucket of buckets) {
    try {
      const checkpoint = state.buckets[bucket.id];
      const start = new Date(checkpoint !== undefined ? checkpoint - OVERLAP_MS : now.getTime() - cfg.backfillDays * 86_400_000);
      const raw = await aw.events(bucket.id, start);
      // The newest event can be one that began long ago and is still growing; always re-send it.
      const latest = await aw.latest(bucket.id);
      if (latest && !raw.some((e) => e.id !== undefined ? e.id === latest.id : e.timestamp === latest.timestamp)) raw.push(latest);
      const out = raw.map((e) => convertEvent(bucket, e, privacy)).filter((e): e is OutEvent => e !== null);
      if (out.length) await post(cfg, out, f);
      const newest = raw.length ? raw.reduce((m, e) => Math.max(m, Date.parse(e.timestamp) + e.duration * 1000), 0) : (checkpoint ?? now.getTime());
      state.buckets[bucket.id] = Math.max(newest, checkpoint ?? 0);
      result.sent += out.length;
      result.buckets++;
    } catch (e) {
      if (e instanceof FatalError) throw e;
      result.errors.push(`${bucket.id}: ${(e as Error).message}`);
    }
  }

  try {
    const next: FolderState = structuredClone(state.folders);
    const events = await collectFolderEvents(cfg, next, now);
    if (events.length) await post(cfg, events, f);
    state.folders = next; // only after the server accepted the events
    result.sent += events.length;
  } catch (e) {
    if (e instanceof FatalError) throw e;
    result.errors.push(`folders: ${(e as Error).message}`);
  }
  return result;
}
