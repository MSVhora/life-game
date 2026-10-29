export const CATEGORIES = ['Productive', 'Neutral', 'Waste', 'Gaming', 'Leisure'] as const;
export type LabelCategory = (typeof CATEGORIES)[number];
/** Everything that can appear in a report. `Unlabeled` = no rule matched; `Away` = idle at the computer. */
export type Category = LabelCategory | 'Unlabeled' | 'Away';

export interface RuleFile {
  rules?: Array<{ match?: { app?: string; domain?: string }; category?: string; counts_as?: string }>;
  browsers?: string[];
}

export interface Label {
  kind: 'app' | 'domain';
  value: string;
  category: LabelCategory;
}

export interface Classifier {
  classifyApp(app: string): Category | null;
  classifyDomain(domain: string): Category | null;
  isBrowser(app: string): boolean;
}

export const DEFAULT_BROWSERS = [
  'Google Chrome', 'Chromium', 'Arc', 'Safari', 'Firefox', 'Brave Browser', 'Microsoft Edge', 'Vivaldi', 'Opera',
];

const isLabelCategory = (c: unknown): c is LabelCategory => CATEGORIES.includes(c as LabelCategory);
const norm = (s: string) => s.trim().toLowerCase();

export function domainMatches(domain: string, rule: string): boolean {
  const d = norm(domain).replace(/^www\./, '');
  const r = norm(rule).replace(/^www\./, '');
  return d === r || d.endsWith(`.${r}`);
}

/** Player labels win over file rules; within the file the first matching rule wins. */
export function makeClassifier(file: RuleFile | undefined, labels: Label[]): Classifier {
  const appLabels = new Map(labels.filter((l) => l.kind === 'app').map((l) => [norm(l.value), l.category]));
  const domainLabels = labels.filter((l) => l.kind === 'domain');
  const rules = (file?.rules ?? []).filter((r) => isLabelCategory(r.category));
  const browsers = new Set((file?.browsers ?? DEFAULT_BROWSERS).map(norm));

  return {
    classifyApp(app) {
      const label = appLabels.get(norm(app));
      if (label) return label;
      const hit = rules.find((r) => r.match?.app && norm(r.match.app) === norm(app));
      return hit ? (hit.category as LabelCategory) : null;
    },
    classifyDomain(domain) {
      const label = domainLabels.find((l) => domainMatches(domain, l.value));
      if (label) return label.category;
      const hit = rules.find((r) => r.match?.domain && domainMatches(domain, r.match.domain));
      return hit ? (hit.category as LabelCategory) : null;
    },
    isBrowser: (app) => browsers.has(norm(app)),
  };
}

/** Productive share of the time that is clearly "spent": productive / (productive + waste + gaming + leisure). */
export function productivePct(totals: Partial<Record<Category, number>>): number | null {
  const p = totals.Productive ?? 0;
  const denom = p + (totals.Waste ?? 0) + (totals.Gaming ?? 0) + (totals.Leisure ?? 0);
  return denom > 0 ? Math.round((p / denom) * 100) : null;
}

export function emptyTotals(): Record<Category, number> {
  return { Productive: 0, Neutral: 0, Waste: 0, Gaming: 0, Leisure: 0, Unlabeled: 0, Away: 0 };
}
