/** Reads buckets and events from a local ActivityWatch server and converts them for the Life Game API. */

export interface AwBucket { id: string; type: string; client?: string }
export interface AwEvent { id?: number; timestamp: string; duration: number; data: Record<string, unknown> }

export interface OutEvent {
  source: 'activitywatch' | 'folder';
  kind: string;
  ts: string;
  durationSec: number;
  key: string;
  data: Record<string, unknown>;
}

export interface Privacy { sendTitles: boolean; fullUrlDomains: string[] }

export class AwClient {
  constructor(private base: string, private fetcher: typeof fetch = fetch) {}

  async buckets(): Promise<AwBucket[]> {
    const res = await this.fetcher(`${this.base}/api/0/buckets/`);
    if (!res.ok) throw new Error(`ActivityWatch answered ${res.status} for the bucket list`);
    const map = (await res.json()) as Record<string, { id?: string; type?: string; client?: string }>;
    return Object.entries(map).map(([id, b]) => ({ id: b.id ?? id, type: b.type ?? '', client: b.client }));
  }

  /** The most recent event of a bucket. It may still be growing as heartbeats merge into it. */
  async latest(bucketId: string): Promise<AwEvent | null> {
    const res = await this.fetcher(`${this.base}/api/0/buckets/${encodeURIComponent(bucketId)}/events?limit=1`);
    if (!res.ok) return null;
    const list = (await res.json()) as AwEvent[];
    return list[0] ?? null;
  }

  /** Events that started at or after `start`, oldest first. */
  async events(bucketId: string, start: Date): Promise<AwEvent[]> {
    const url = `${this.base}/api/0/buckets/${encodeURIComponent(bucketId)}/events?start=${encodeURIComponent(start.toISOString())}&limit=-1`;
    const res = await this.fetcher(url);
    if (!res.ok) throw new Error(`ActivityWatch answered ${res.status} for bucket ${bucketId}`);
    const list = (await res.json()) as AwEvent[];
    return list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }
}

const hostOf = (raw: string): string | null => {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; // chrome://, about:, file:, extensions
    return u.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
};

const domainAllowed = (domain: string, allow: string[]) => allow.some((d) => domain === d || domain.endsWith(`.${d}`));

/** Converts one ActivityWatch event, dropping anything the player has not allowed us to send. */
export function convertEvent(bucket: AwBucket, e: AwEvent, privacy: Privacy): OutEvent | null {
  if (!(e.duration > 0) || !e.timestamp || Number.isNaN(Date.parse(e.timestamp))) return null;
  const key = `${bucket.id}:${e.id ?? e.timestamp}`;
  const base = { source: 'activitywatch' as const, ts: new Date(e.timestamp).toISOString(), durationSec: Math.round(e.duration * 1000) / 1000, key };

  if (bucket.type === 'currentwindow') {
    const app = typeof e.data.app === 'string' ? e.data.app.trim() : '';
    if (!app) return null;
    const data: Record<string, unknown> = { app };
    if (privacy.sendTitles && typeof e.data.title === 'string') data.title = e.data.title.slice(0, 200);
    return { ...base, kind: 'window', data };
  }

  if (bucket.type === 'afkstatus') {
    const status = e.data.status === 'afk' ? 'afk' : e.data.status === 'not-afk' ? 'not-afk' : null;
    return status ? { ...base, kind: 'afk', data: { status } } : null;
  }

  if (bucket.type === 'web.tab.current') {
    if (e.data.incognito === true) return { ...base, kind: 'web', data: { domain: '(private)' } };
    const url = typeof e.data.url === 'string' ? e.data.url : '';
    const domain = hostOf(url);
    if (!domain) return null; // new tab pages, about:blank, extensions
    const data: Record<string, unknown> = { domain };
    if (domainAllowed(domain, privacy.fullUrlDomains)) {
      data.url = url.slice(0, 500);
      if (typeof e.data.title === 'string') data.title = e.data.title.slice(0, 200);
    } else if (privacy.sendTitles && typeof e.data.title === 'string') {
      data.title = e.data.title.slice(0, 200);
    }
    return { ...base, kind: 'web', data };
  }

  return null;
}

export const SUPPORTED_BUCKET_TYPES = ['currentwindow', 'afkstatus', 'web.tab.current'];
