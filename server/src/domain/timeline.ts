import { emptyTotals, type Category, type Classifier } from './categories.js';
import { localMinutesOfDay } from './time.js';

export interface Interval {
  start: number; // epoch ms
  end: number;
}
export interface WindowEv extends Interval { app: string; title?: string }
export interface WebEv extends Interval { domain: string; url?: string; title?: string }
export interface AfkEv extends Interval { afk: boolean }
export interface ManualBlock extends Interval { category: Category; label: string }

export interface TimelineInput {
  range: Interval;
  tz: string;
  windows: WindowEv[];
  /** Foreground app sessions from the phone. They outrank Mac activity when both overlap. */
  phone?: WindowEv[];
  web: WebEv[];
  afk: AfkEv[];
  manual: ManualBlock[];
  classifier: Classifier;
}

export interface Segment extends Interval {
  category: Category;
  kind: 'app' | 'domain' | 'manual' | 'away';
  key: string;
}

export interface Item {
  kind: 'app' | 'domain' | 'manual';
  key: string;
  category: Category;
  seconds: number;
}

export interface TimelineResult {
  segments: Segment[];
  totals: Record<Category, number>;
  items: Item[];
  activeSeconds: number;
  awaySeconds: number;
  longestFocusMin: number;
  firstGamingMin: number | null;
}

const PRIORITY = { away: 1, sensor: 2, phone: 2.5, manual: 3 } as const;
interface Leaf extends Segment { priority: number }

const clip = (iv: Interval, range: Interval): Interval | null => {
  const start = Math.max(iv.start, range.start);
  const end = Math.min(iv.end, range.end);
  return end > start ? { start, end } : null;
};

/** Merges overlapping or touching intervals. */
function union(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/** `iv` minus every interval in `cuts` (cuts must be merged and sorted). */
function subtract(iv: Interval, cuts: Interval[]): Interval[] {
  let pieces: Interval[] = [iv];
  for (const c of cuts) {
    if (c.end <= iv.start) continue;
    if (c.start >= iv.end) break;
    pieces = pieces.flatMap((p) => {
      if (c.end <= p.start || c.start >= p.end) return [p];
      const out: Interval[] = [];
      if (c.start > p.start) out.push({ start: p.start, end: c.start });
      if (c.end < p.end) out.push({ start: c.end, end: p.end });
      return out;
    });
  }
  return pieces;
}

/** Where `iv` overlaps each of `others` (sorted by start). */
function overlaps<T extends Interval>(iv: Interval, others: T[]): Array<{ part: Interval; src: T }> {
  const out: Array<{ part: Interval; src: T }> = [];
  for (const o of others) {
    if (o.start >= iv.end) break;
    const part = clip(o, iv);
    if (part) out.push({ part, src: o });
  }
  return out;
}

/** Highest priority wins on overlap; ties go to the earlier-starting interval. */
function resolve(leaves: Leaf[]): Segment[] {
  const points = [...new Set(leaves.flatMap((l) => [l.start, l.end]))].sort((a, b) => a - b);
  const byStart = [...leaves].sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let active: Leaf[] = [];
  let next = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    while (next < byStart.length && byStart[next]!.start <= a) active.push(byStart[next++]!);
    active = active.filter((l) => l.end > a);
    if (!active.length) continue;
    const best = active.reduce((x, y) => (y.priority > x.priority || (y.priority === x.priority && y.start < x.start) ? y : x));
    const prev = out[out.length - 1];
    if (prev && prev.end === a && prev.category === best.category && prev.kind === best.kind && prev.key === best.key) prev.end = b;
    else out.push({ start: a, end: b, category: best.category, kind: best.kind, key: best.key });
  }
  return out;
}

export function buildTimeline(input: TimelineInput): TimelineResult {
  const { range, classifier } = input;
  const afkCuts = union(input.afk.filter((e) => e.afk).map((e) => clip(e, range)).filter((x): x is Interval => !!x));
  const web: WebEv[] = [];
  for (const w of input.web) {
    const c = clip(w, range);
    if (c) web.push({ ...w, ...c });
  }
  web.sort((a, b) => a.start - b.start);
  const leaves: Leaf[] = [];

  for (const cut of afkCuts) {
    leaves.push({ ...cut, category: 'Away', kind: 'away', key: 'away', priority: PRIORITY.away });
  }

  for (const w of input.windows) {
    const c = clip(w, range);
    if (!c) continue;
    for (const piece of subtract(c, afkCuts)) {
      const appCategory = classifier.classifyApp(w.app);
      if (classifier.isBrowser(w.app)) {
        const covered = overlaps(piece, web);
        let cursor = piece.start;
        for (const { part, src } of covered) {
          if (part.start > cursor) leaves.push(appLeaf({ start: cursor, end: part.start }, w.app, appCategory));
          const cat = classifier.classifyDomain(src.domain) ?? appCategory ?? 'Unlabeled';
          leaves.push({ ...part, category: cat, kind: 'domain', key: src.domain.toLowerCase(), priority: PRIORITY.sensor });
          cursor = Math.max(cursor, part.end);
        }
        if (cursor < piece.end) leaves.push(appLeaf({ start: cursor, end: piece.end }, w.app, appCategory));
      } else {
        leaves.push(appLeaf(piece, w.app, appCategory));
      }
    }
  }

  for (const p of input.phone ?? []) {
    const c = clip(p, range);
    if (c) leaves.push({ ...appLeaf(c, p.app, classifier.classifyApp(p.app)), priority: PRIORITY.phone });
  }

  for (const m of input.manual) {
    const c = clip(m, range);
    if (c) leaves.push({ ...c, category: m.category, kind: 'manual', key: m.label, priority: PRIORITY.manual });
  }

  const segments = resolve(leaves);
  const totals = emptyTotals();
  const itemMap = new Map<string, Item>();
  for (const s of segments) {
    const sec = (s.end - s.start) / 1000;
    totals[s.category] += sec;
    if (s.kind === 'away') continue;
    const k = `${s.kind}|${s.key}|${s.category}`;
    const item = itemMap.get(k) ?? { kind: s.kind, key: s.key, category: s.category, seconds: 0 };
    item.seconds += sec;
    itemMap.set(k, item);
  }
  for (const c of Object.keys(totals) as Category[]) totals[c] = Math.round(totals[c]);

  const firstGaming = segments.find((s) => s.category === 'Gaming');
  return {
    segments,
    totals,
    items: [...itemMap.values()].map((i) => ({ ...i, seconds: Math.round(i.seconds) })).sort((a, b) => b.seconds - a.seconds),
    activeSeconds: Object.entries(totals).reduce((a, [c, v]) => a + (c === 'Away' ? 0 : v), 0),
    awaySeconds: totals.Away,
    longestFocusMin: longestFocus(segments),
    firstGamingMin: firstGaming ? localMinutesOfDay(new Date(firstGaming.start), input.tz) : null,
  };
}

function appLeaf(iv: Interval, app: string, category: Category | null): Leaf {
  return { ...iv, category: category ?? 'Unlabeled', kind: 'app', key: app, priority: PRIORITY.sensor };
}

/** Longest stretch of Productive time, allowing gaps of up to two minutes. */
export function longestFocus(segments: Segment[], maxGapMs = 120_000): number {
  let best = 0;
  let start: number | null = null;
  let end = 0;
  for (const s of segments) {
    if (s.category !== 'Productive') continue;
    if (start !== null && s.start - end <= maxGapMs) {
      end = s.end;
    } else {
      start = s.start;
      end = s.end;
    }
    best = Math.max(best, end - start);
  }
  return Math.round(best / 60_000);
}
