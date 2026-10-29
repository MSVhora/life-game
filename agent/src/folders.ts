import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AgentConfig, FolderSource } from './config.js';
import type { OutEvent } from './aw.js';

const exec = promisify(execFile);

export interface FolderState {
  /** Last row count reported per CSV id. */
  csvRows: Record<string, number>;
  /** Newest file modification time (ms) already reported per folder id. */
  folderMtime: Record<string, number>;
  /** Time (ms) up to which git commits were already reported per folder id. */
  gitSince: Record<string, number>;
}

export const emptyFolderState = (): FolderState => ({ csvRows: {}, folderMtime: {}, gitSince: {} });

/** Matches a single path segment against patterns where `*` is a wildcard. Never reads file contents. */
export function isIgnored(name: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
    return re.test(name);
  });
}

/** Number of data rows in a CSV: non-empty lines minus the header. Quoted multi-line cells are not special-cased. */
export function countCsvRows(file: string): number {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  return Math.max(0, lines.length - 1);
}

/** Newest modification time under `dir` and how many files changed after `sinceMs`. Only stats files. */
export function scanFolder(dir: string, ignore: string[], sinceMs: number, maxDepth = 4): { newest: number; changed: number } {
  let newest = 0;
  let changed = 0;
  const walk = (d: string, depth: number) => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (isIgnored(name, ignore)) continue;
      const full = path.join(d, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth < maxDepth) walk(full, depth + 1);
      } else {
        newest = Math.max(newest, st.mtimeMs);
        if (st.mtimeMs > sinceMs) changed++;
      }
    }
  };
  walk(dir, 0);
  return { newest, changed };
}

export async function gitCommitsSince(repo: string, sinceMs: number): Promise<Array<{ sha: string; ts: string }>> {
  try {
    const { stdout } = await exec('git', ['-C', repo, 'log', `--since=${new Date(sinceMs).toISOString()}`, '--format=%H|%cI', '--no-merges'], { timeout: 15_000 });
    return stdout.split('\n').filter(Boolean).map((l) => {
      const [sha, ts] = l.split('|');
      return { sha: sha!, ts: new Date(ts!).toISOString() };
    });
  } catch {
    return []; // not a git repo, or git is missing
  }
}

/** Collects evidence from the player's folders. Only the CSV files listed in the config are read; nothing else is opened. */
export async function collectFolderEvents(cfg: AgentConfig, state: FolderState, now: Date): Promise<OutEvent[]> {
  const out: OutEvent[] = [];
  const nowIso = now.toISOString();

  for (const c of cfg.csv) {
    let rows: number;
    let mtime: number;
    try {
      rows = countCsvRows(c.path);
      mtime = statSync(c.path).mtimeMs;
    } catch {
      continue; // file missing: report nothing rather than guess
    }
    if (state.csvRows[c.id] === rows) continue;
    out.push({ source: 'folder', kind: 'csv_rows', ts: nowIso, durationSec: 0, key: `${c.id}:${rows}:${Math.round(mtime)}`, data: { source: c.id, rows } });
    state.csvRows[c.id] = rows;
  }

  for (const f of cfg.folders) {
    out.push(...(await collectFolder(cfg, f, state, now)));
  }
  return out;
}

async function collectFolder(cfg: AgentConfig, f: FolderSource, state: FolderState, now: Date): Promise<OutEvent[]> {
  const out: OutEvent[] = [];
  const first = state.folderMtime[f.id] === undefined;
  const since = state.folderMtime[f.id] ?? now.getTime();
  const { newest, changed } = scanFolder(f.path, cfg.ignore, since);
  if (first) {
    state.folderMtime[f.id] = Math.max(newest, 0); // the first run only sets a baseline
  } else if (changed > 0) {
    out.push({ source: 'folder', kind: 'folder_change', ts: new Date(newest).toISOString(), durationSec: 0, key: `${f.id}:${Math.round(newest)}`, data: { source: f.id, files: changed } });
    state.folderMtime[f.id] = newest;
  }

  if (f.watchGit) {
    const sinceGit = state.gitSince[f.id] ?? now.getTime() - cfg.backfillDays * 86_400_000;
    for (const c of await gitCommitsSince(f.path, sinceGit)) {
      out.push({ source: 'folder', kind: 'git_commit', ts: c.ts, durationSec: 0, key: `${f.id}:${c.sha}`, data: { repo: f.id } });
    }
    state.gitSince[f.id] = now.getTime() - 60_000; // small overlap; keys make repeats harmless
  }
  return out;
}
