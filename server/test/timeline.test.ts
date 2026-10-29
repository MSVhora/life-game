import { describe, expect, it } from 'vitest';
import { domainMatches, makeClassifier, productivePct } from '../src/domain/categories.js';
import { buildTimeline, longestFocus, type TimelineInput } from '../src/domain/timeline.js';

const T0 = Date.parse('2026-10-26T04:30:00Z'); // 10:00 IST
const min = (n: number) => T0 + n * 60_000;
const classifier = makeClassifier(
  {
    rules: [
      { match: { app: 'Code' }, category: 'Productive' },
      { match: { app: 'Slack' }, category: 'Neutral' },
      { match: { app: 'Example Game' }, category: 'Gaming' },
      { match: { domain: 'github.com' }, category: 'Productive' },
      { match: { domain: 'youtube.com' }, category: 'Waste' },
    ],
  },
  [],
);

function input(over: Partial<TimelineInput> = {}): TimelineInput {
  return { range: { start: min(0), end: min(240) }, tz: 'Asia/Kolkata', windows: [], web: [], afk: [], manual: [], classifier, ...over };
}

describe('classifier', () => {
  it('matches apps case-insensitively and domains with subdomains', () => {
    expect(classifier.classifyApp('code')).toBe('Productive');
    expect(classifier.classifyApp('Unknown App')).toBeNull();
    expect(classifier.classifyDomain('m.youtube.com')).toBe('Waste');
    expect(classifier.classifyDomain('notyoutube.com')).toBeNull();
    expect(domainMatches('www.github.com', 'github.com')).toBe(true);
  });
  it('player labels override file rules', () => {
    const c = makeClassifier({ rules: [{ match: { domain: 'youtube.com' }, category: 'Waste' }] }, [{ kind: 'domain', value: 'youtube.com', category: 'Productive' }]);
    expect(c.classifyDomain('youtube.com')).toBe('Productive');
  });
  it('knows browsers and ignores rules with invalid categories', () => {
    expect(classifier.isBrowser('Google Chrome')).toBe(true);
    expect(classifier.isBrowser('Code')).toBe(false);
    expect(makeClassifier({ rules: [{ match: { app: 'X' }, category: 'Nonsense' }] }, []).classifyApp('X')).toBeNull();
  });
  it('computes the productive share from clearly spent time only', () => {
    expect(productivePct({ Productive: 60, Waste: 30, Gaming: 10, Neutral: 999, Away: 999 })).toBe(60);
    expect(productivePct({ Neutral: 100 })).toBeNull();
  });
});

describe('timeline', () => {
  it('turns window events into categorised time', () => {
    const r = buildTimeline(input({ windows: [
      { start: min(0), end: min(30), app: 'Code' },
      { start: min(30), end: min(40), app: 'Slack' },
      { start: min(40), end: min(100), app: 'Example Game' },
      { start: min(100), end: min(110), app: 'Mystery' },
    ] }));
    expect(r.totals).toMatchObject({ Productive: 1800, Neutral: 600, Gaming: 3600, Unlabeled: 600, Away: 0 });
    expect(r.items[0]).toMatchObject({ key: 'Example Game', category: 'Gaming', seconds: 3600 });
    expect(r.activeSeconds).toBe(6600);
  });

  it('removes idle time and reports it as Away', () => {
    const r = buildTimeline(input({
      windows: [{ start: min(0), end: min(60), app: 'Code' }],
      afk: [{ start: min(0), end: min(20), afk: false }, { start: min(20), end: min(50), afk: true }, { start: min(50), end: min(60), afk: false }],
    }));
    expect(r.totals.Productive).toBe(30 * 60);
    expect(r.totals.Away).toBe(30 * 60);
    expect(r.awaySeconds).toBe(1800);
  });

  it('keeps window time that has no afk data at all', () => {
    const r = buildTimeline(input({ windows: [{ start: min(0), end: min(10), app: 'Code' }], afk: [] }));
    expect(r.totals.Productive).toBe(600);
  });

  it('splits browser time by the site that was open', () => {
    const r = buildTimeline(input({
      windows: [{ start: min(0), end: min(60), app: 'Google Chrome' }],
      web: [
        { start: min(0), end: min(20), domain: 'github.com' },
        { start: min(20), end: min(45), domain: 'www.youtube.com' },
        { start: min(45), end: min(50), domain: 'unknown.example' },
      ],
    }));
    expect(r.totals).toMatchObject({ Productive: 1200, Waste: 1500 });
    // 5 min on an unknown site and 10 min with no tab info are both unlabeled.
    expect(r.totals.Unlabeled).toBe(15 * 60);
    expect(r.items.find((i) => i.key === 'youtube.com' || i.key === 'www.youtube.com')?.kind).toBe('domain');
    expect(r.items.some((i) => i.key === 'Google Chrome' && i.category === 'Unlabeled')).toBe(true);
  });

  it('falls back to the browser app rule when a site has no rule', () => {
    const c = makeClassifier({ rules: [{ match: { app: 'Arc' }, category: 'Neutral' }] }, []);
    const r = buildTimeline(input({ classifier: c, windows: [{ start: min(0), end: min(10), app: 'Arc' }], web: [{ start: min(0), end: min(10), domain: 'foo.example' }] }));
    expect(r.totals.Neutral).toBe(600);
  });

  it('lets manual timers override sensors', () => {
    const r = buildTimeline(input({
      windows: [{ start: min(0), end: min(60), app: 'Code' }],
      manual: [{ start: min(20), end: min(50), category: 'Neutral', label: 'lunch' }],
    }));
    expect(r.totals).toMatchObject({ Productive: 1800, Neutral: 1800 });
    expect(r.items.find((i) => i.kind === 'manual')).toMatchObject({ key: 'lunch', seconds: 1800 });
  });

  it('clips everything to the range and never double counts overlaps', () => {
    const r = buildTimeline(input({
      range: { start: min(10), end: min(20) },
      windows: [{ start: min(0), end: min(15), app: 'Code' }, { start: min(5), end: min(30), app: 'Slack' }],
    }));
    const total = Object.values(r.totals).reduce((a, b) => a + b, 0);
    expect(total).toBe(600);
  });

  it('merges adjacent events of the same app into one segment', () => {
    const r = buildTimeline(input({ windows: [{ start: min(0), end: min(5), app: 'Code' }, { start: min(5), end: min(9), app: 'Code' }] }));
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ start: min(0), end: min(9) });
  });

  it('finds the longest focus stretch, bridging short gaps', () => {
    const r = buildTimeline(input({ windows: [
      { start: min(0), end: min(30), app: 'Code' },
      { start: min(30), end: min(31), app: 'Slack' },
      { start: min(31), end: min(50), app: 'Code' },
      { start: min(60), end: min(70), app: 'Code' },
    ] }));
    expect(r.longestFocusMin).toBe(50);
    expect(longestFocus([])).toBe(0);
  });

  it('records when gaming first started, in local minutes of the day', () => {
    const r = buildTimeline(input({ windows: [{ start: min(90), end: min(100), app: 'Example Game' }] }));
    expect(r.firstGamingMin).toBe(11 * 60 + 30); // 10:00 IST + 90 min
    expect(buildTimeline(input()).firstGamingMin).toBeNull();
  });

  it('handles an empty day', () => {
    const r = buildTimeline(input());
    expect(r.segments).toEqual([]);
    expect(r.activeSeconds).toBe(0);
  });
});
