export const TIMER_KINDS = ['wash', 'bath', 'lunch', 'dinner', 'sleep', 'out', 'reading', 'gaming', 'work', 'other'] as const;
export type TimerKind = (typeof TIMER_KINDS)[number];

export const TIMER_CATEGORY: Record<TimerKind, 'Productive' | 'Neutral' | 'Waste' | 'Gaming' | 'Leisure'> = {
  wash: 'Neutral', bath: 'Neutral', lunch: 'Neutral', dinner: 'Neutral', sleep: 'Neutral', out: 'Neutral', other: 'Neutral',
  reading: 'Leisure', gaming: 'Gaming', work: 'Productive',
};
