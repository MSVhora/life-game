import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface FolderSource { id: string; path: string; watchGit: boolean }

export interface AgentConfig {
  serverUrl: string;
  token: string;
  awUrl: string;
  stateDir: string;
  intervalSeconds: number;
  backfillDays: number;
  /** Window and tab titles can be private; they are dropped unless this is true. */
  sendTitles: boolean;
  /** Full page URLs are only sent for these domains (e.g. public job boards). */
  fullUrlDomains: string[];
  folders: FolderSource[];
  csv: Array<{ id: string; path: string }>;
  ignore: string[];
}

interface SourcesFile {
  activitywatch?: { url?: string; send_titles?: boolean; full_url_domains?: string[]; backfill_days?: number };
  folders?: Array<{ id?: string; path?: string; watch_git?: boolean }>;
  csv?: Record<string, string>;
  ignore?: string[];
}

export const DEFAULT_IGNORE = ['.env', '.env.*', '*.key', '*.pem', 'id_*', '*.p12', '.git', 'node_modules', '.DS_Store'];

const expandHome = (p: string) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

/** Finds `<dir>/sources.local.yml`, falling back to `sources.example.yml`. */
export function findSourcesFile(dir: string): string | null {
  for (const name of ['sources.local.yml', 'sources.example.yml']) {
    const f = path.join(dir, name);
    if (existsSync(f)) return f;
  }
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const stateDir = expandHome(env.LIFE_GAME_STATE_DIR ?? '~/.life-game-agent');
  const serverUrl = (env.LIFE_GAME_URL ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(serverUrl)) throw new Error('Set LIFE_GAME_URL to your server address, e.g. https://life.yourdomain.tld');

  const tokenFile = expandHome(env.LIFE_GAME_TOKEN_FILE ?? path.join(stateDir, 'token'));
  const token = (env.LIFE_GAME_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8') : '')).trim();
  if (!token.startsWith('lg_')) throw new Error(`No device token found. Put it in ${tokenFile} (chmod 600) or set LIFE_GAME_TOKEN.`);

  const sourcesDir = expandHome(env.LIFE_GAME_CONFIG_DIR ?? path.resolve(process.cwd(), '../config'));
  const file = env.LIFE_GAME_SOURCES ? expandHome(env.LIFE_GAME_SOURCES) : findSourcesFile(sourcesDir);
  const src: SourcesFile = file && existsSync(file) ? ((parseYaml(readFileSync(file, 'utf8')) as SourcesFile) ?? {}) : {};
  const aw = src.activitywatch ?? {};

  return {
    serverUrl,
    token,
    awUrl: (env.AW_URL ?? aw.url ?? 'http://localhost:5600').replace(/\/+$/, ''),
    stateDir,
    intervalSeconds: Math.max(15, Number(env.LIFE_GAME_INTERVAL ?? 60)),
    backfillDays: Math.min(30, Math.max(0, aw.backfill_days ?? 7)),
    sendTitles: aw.send_titles === true,
    fullUrlDomains: (aw.full_url_domains ?? []).map((d) => d.toLowerCase()),
    folders: (src.folders ?? [])
      .filter((f): f is { id: string; path: string; watch_git?: boolean } => !!f.id && !!f.path)
      .map((f) => ({ id: f.id, path: expandHome(f.path), watchGit: f.watch_git === true })),
    csv: Object.entries(src.csv ?? {}).map(([id, p]) => ({ id, path: expandHome(p) })),
    ignore: [...new Set([...DEFAULT_IGNORE, ...(src.ignore ?? [])])],
  };
}
