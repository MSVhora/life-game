import { addDays, daysBetween, formatHHMM, minutesOfDay } from './time.js';

export type Pressure = 'data_only' | 'gentle' | 'gradual' | 'harsh';
export type DayStatus = 'open' | 'done' | 'missed' | 'paused';

/** Gaming minutes per task: the per-task maximum, shrinking so the daily total stays within the cap. */
export function rewardPerTask(dailyCap: number, perTaskMax: number, tasksRequired: number): number {
  if (tasksRequired <= 0 || dailyCap <= 0) return 0;
  return Math.max(0, Math.min(perTaskMax, Math.floor(dailyCap / tasksRequired)));
}

export const levelFromXp = (xp: number): number => Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;

export function levelProgress(xp: number): { level: number; xpIntoLevel: number; xpForLevel: number } {
  const level = levelFromXp(xp);
  const start = 50 * (level - 1) ** 2;
  const next = 50 * level ** 2;
  return { level, xpIntoLevel: Math.max(0, xp) - start, xpForLevel: next - start };
}

const RANKS: Array<[number, string]> = [
  [30, 'Champion'],
  [22, 'Master'],
  [15, 'Crystal'],
  [10, 'Gold'],
  [6, 'Silver'],
  [3, 'Bronze'],
  [1, 'Rookie'],
];
export function rankForLevel(level: number): string {
  return RANKS.find(([min]) => level >= min)![1];
}

export const dayBonusXp = (streak: number): number => 20 + 2 * Math.min(Math.max(streak, 0), 10);

export interface ResolvedDay {
  localDate: string;
  status: Exclude<DayStatus, 'open'>;
}

/**
 * Streak of successful days ending at the most recent resolved day.
 * Paused days are skipped. A missed day is forgiven when fewer than `graceDaysPerWeek`
 * misses were already forgiven in the 7 days starting at that miss. A gap in dates breaks the streak.
 */
export function computeStreak(days: ResolvedDay[], graceDaysPerWeek: number): number {
  const sorted = [...days].sort((a, b) => (a.localDate < b.localDate ? 1 : -1));
  let streak = 0;
  let prevDate: string | null = null;
  const forgiven: string[] = [];
  for (const day of sorted) {
    if (prevDate && daysBetween(day.localDate, prevDate) !== 1) break;
    prevDate = day.localDate;
    if (day.status === 'paused') continue;
    if (day.status === 'done') {
      streak += 1;
      continue;
    }
    const usedInWindow = forgiven.filter((f) => daysBetween(day.localDate, f) <= 6).length;
    if (usedInWindow < graceDaysPerWeek) {
      forgiven.push(day.localDate);
      continue;
    }
    break;
  }
  return streak;
}

const REP_DELTA: Record<Pressure, { win: number; miss: number }> = {
  data_only: { win: 3, miss: 0 },
  gentle: { win: 4, miss: -3 },
  gradual: { win: 4, miss: -6 },
  harsh: { win: 4, miss: -10 },
};

/** "Crew opinion" meter, 0-100, derived from resolved days (starts at 50). */
export function computeReputation(days: ResolvedDay[], pressure: Pressure): number {
  const d = REP_DELTA[pressure];
  let rep = 50;
  for (const day of [...days].sort((a, b) => (a.localDate < b.localDate ? -1 : 1))) {
    if (day.status === 'done') rep += d.win;
    else if (day.status === 'missed') rep += d.miss;
    rep = Math.min(100, Math.max(0, rep));
  }
  return rep;
}

export interface RampState {
  level: number;
  lastRaisedOn: string | null;
}

/**
 * Raise the daily task count by one when enough of the last 7 days were met,
 * at most once a week. Never lowers (the weekly review does that).
 */
export function nextRamp(
  ramp: RampState,
  recent: ResolvedDay[],
  opts: { raiseAfterDaysMet: number; maxLevel: number; today: string },
): RampState {
  if (ramp.level >= opts.maxLevel) return ramp;
  if (ramp.lastRaisedOn && daysBetween(ramp.lastRaisedOn, opts.today) < 7) return ramp;
  const window = recent
    .filter((d) => d.status !== 'paused' && daysBetween(d.localDate, opts.today) <= 7)
    .filter((d) => d.localDate < opts.today);
  const met = window.filter((d) => d.status === 'done').length;
  if (window.length >= opts.raiseAfterDaysMet && met >= opts.raiseAfterDaysMet) {
    return { level: ramp.level + 1, lastRaisedOn: opts.today };
  }
  return ramp;
}

/** Wake goal moves earlier by `rampMinutesPerWeek` each week since `startDate`, never past `finalGoal`. */
export function effectiveWakeGoal(opts: {
  startGoal: string;
  finalGoal: string;
  rampMinutesPerWeek: number;
  startDate: string;
  today: string;
}): string {
  const weeks = Math.max(0, Math.floor(daysBetween(opts.startDate, opts.today) / 7));
  const start = minutesOfDay(opts.startGoal);
  const final = minutesOfDay(opts.finalGoal);
  if (final >= start) return opts.startGoal;
  return formatHHMM(Math.max(final, start - weeks * opts.rampMinutesPerWeek));
}

export { addDays };
