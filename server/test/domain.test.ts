import { describe, expect, it } from 'vitest';
import { crewMessages } from '../src/domain/crew.js';
import {
  computeReputation,
  computeStreak,
  dayBonusXp,
  effectiveWakeGoal,
  levelFromXp,
  levelProgress,
  nextRamp,
  rankForLevel,
  rewardPerTask,
  type ResolvedDay,
} from '../src/domain/game.js';
import {
  activeTaskTypes,
  buildPlan,
  goalAnswersSchema,
  pickRotating,
  type StoredGoal,
} from '../src/domain/goalPlan.js';
import {
  addDays,
  cycleFor,
  daysBetween,
  formatHHMM,
  localDateString,
  minutesOfDay,
  zonedToInstant,
} from '../src/domain/time.js';

const days = (spec: string, end = '2026-10-20'): ResolvedDay[] =>
  // spec is oldest->newest, one char per consecutive day: D done, M missed, P paused
  [...spec].map((c, i) => ({
    localDate: addDays(end, -(spec.length - 1 - i)),
    status: c === 'D' ? 'done' : c === 'M' ? 'missed' : 'paused',
  }));

describe('time zones and cycles', () => {
  it('converts local wall time to instants in a fixed-offset zone', () => {
    expect(zonedToInstant('2026-10-26', '23:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-26T17:30:00.000Z');
  });

  it('handles DST changes (New York, spring forward 2026-03-08)', () => {
    expect(zonedToInstant('2026-03-07', '12:00', 'America/New_York').toISOString()).toBe('2026-03-07T17:00:00.000Z');
    expect(zonedToInstant('2026-03-09', '12:00', 'America/New_York').toISOString()).toBe('2026-03-09T16:00:00.000Z');
  });

  it('finds the cycle before and after the end time', () => {
    const tz = 'Asia/Kolkata';
    const before = cycleFor(new Date('2026-10-26T10:00:00Z'), tz, '23:00'); // 15:30 local
    expect(before.localDate).toBe('2026-10-26');
    expect(before.endsAt.toISOString()).toBe('2026-10-26T17:30:00.000Z');
    expect(before.endsAt.getTime() - before.startsAt.getTime()).toBe(86_400_000);

    const after = cycleFor(new Date('2026-10-26T18:00:00Z'), tz, '23:00'); // 23:30 local
    expect(after.localDate).toBe('2026-10-27');
    expect(after.startsAt.toISOString()).toBe('2026-10-26T17:30:00.000Z');
  });

  it('switches to the next cycle exactly at the end instant', () => {
    const tz = 'Asia/Kolkata';
    expect(cycleFor(new Date('2026-10-26T17:29:59Z'), tz, '23:00').localDate).toBe('2026-10-26');
    expect(cycleFor(new Date('2026-10-26T17:30:00Z'), tz, '23:00').localDate).toBe('2026-10-27');
  });

  it('has date helpers that cross month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
    expect(localDateString(new Date('2026-10-26T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-27');
    expect(minutesOfDay('12:30')).toBe(750);
    expect(formatHHMM(-30)).toBe('23:30');
  });
});

describe('rewards, xp and levels', () => {
  it('shrinks the per-task reward as tasks grow, within the cap', () => {
    expect(rewardPerTask(120, 60, 2)).toBe(60);
    expect(rewardPerTask(120, 60, 3)).toBe(40);
    expect(rewardPerTask(120, 60, 4)).toBe(30);
    expect(rewardPerTask(120, 60, 1)).toBe(60);
    expect(rewardPerTask(0, 60, 2)).toBe(0);
    expect(rewardPerTask(120, 60, 0)).toBe(0);
  });

  it('maps xp to levels and ranks', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(49)).toBe(1);
    expect(levelFromXp(50)).toBe(2);
    expect(levelFromXp(200)).toBe(3);
    expect(levelProgress(75)).toEqual({ level: 2, xpIntoLevel: 25, xpForLevel: 150 });
    expect(rankForLevel(1)).toBe('Rookie');
    expect(rankForLevel(6)).toBe('Silver');
    expect(rankForLevel(40)).toBe('Champion');
  });

  it('caps the streak bonus', () => {
    expect(dayBonusXp(0)).toBe(20);
    expect(dayBonusXp(5)).toBe(30);
    expect(dayBonusXp(50)).toBe(40);
  });
});

describe('streak', () => {
  it('counts consecutive done days', () => {
    expect(computeStreak(days('DDD'), 0)).toBe(3);
  });
  it('breaks on a miss without grace', () => {
    expect(computeStreak(days('DDMDD'), 0)).toBe(2);
  });
  it('forgives one miss per week with grace', () => {
    expect(computeStreak(days('DDMDD'), 1)).toBe(4);
  });
  it('does not forgive two misses in one week with one grace day', () => {
    expect(computeStreak(days('DMDMDD'), 1)).toBe(2 + 1); // newest DD, forgives latest M, then D, then 2nd M breaks
  });
  it('skips paused days without breaking or counting', () => {
    expect(computeStreak(days('DDPPDD'), 0)).toBe(4);
  });
  it('breaks on a date gap', () => {
    const d = days('DDD');
    d.splice(1, 1);
    expect(computeStreak(d, 0)).toBe(1);
  });
  it('is zero with no history', () => {
    expect(computeStreak([], 1)).toBe(0);
  });
});

describe('reputation', () => {
  it('moves by pressure level and stays within 0-100', () => {
    expect(computeReputation(days('DD'), 'gradual')).toBe(58);
    expect(computeReputation(days('MM'), 'gradual')).toBe(38);
    expect(computeReputation(days('MM'), 'data_only')).toBe(50);
    expect(computeReputation(days('M'.repeat(30)), 'harsh')).toBe(0);
    expect(computeReputation(days('D'.repeat(30)), 'gentle')).toBe(100);
  });
});

describe('ramp', () => {
  const opts = { raiseAfterDaysMet: 5, maxLevel: 5, today: '2026-10-21' };
  it('raises after enough met days in the last week', () => {
    const r = nextRamp({ level: 1, lastRaisedOn: null }, days('DDDDDMD'), opts);
    expect(r).toEqual({ level: 2, lastRaisedOn: '2026-10-21' });
  });
  it('does not raise with too few met days', () => {
    expect(nextRamp({ level: 1, lastRaisedOn: null }, days('DMDMDMD'), opts).level).toBe(1);
  });
  it('raises at most once a week', () => {
    expect(nextRamp({ level: 2, lastRaisedOn: '2026-10-18' }, days('DDDDDDD'), opts).level).toBe(2);
  });
  it('stops at the maximum level', () => {
    expect(nextRamp({ level: 5, lastRaisedOn: null }, days('DDDDDDD'), opts).level).toBe(5);
  });
  it('ignores paused days when counting', () => {
    expect(nextRamp({ level: 1, lastRaisedOn: null }, days('DDPPPPD'), opts).level).toBe(1);
  });
});

describe('wake goal ramp', () => {
  const base = { startGoal: '12:00', finalGoal: '09:00', rampMinutesPerWeek: 15, startDate: '2026-10-01' };
  it('starts at the start goal and moves earlier weekly', () => {
    expect(effectiveWakeGoal({ ...base, today: '2026-10-05' })).toBe('12:00');
    expect(effectiveWakeGoal({ ...base, today: '2026-10-08' })).toBe('11:45');
    expect(effectiveWakeGoal({ ...base, today: '2026-10-29' })).toBe('11:00');
  });
  it('never passes the final goal', () => {
    expect(effectiveWakeGoal({ ...base, today: '2027-10-01' })).toBe('09:00');
  });
  it('does not move later when the final goal is later', () => {
    expect(effectiveWakeGoal({ ...base, finalGoal: '14:00', today: '2026-12-01' })).toBe('12:00');
  });
});

describe('goal plan', () => {
  const answers = goalAnswersSchema.parse({
    template: 'get_job',
    outcome: 'Get a new role',
    deadlineWeeks: 8,
    doneWhen: { unit: 'applications', target: 30 },
    startState: 'some_prep',
    hoursPerWeek: 6,
    startBlocker: 'dont_open_it',
  });

  it('covers every week with ordered phases that fit the deadline', () => {
    const plan = buildPlan(answers);
    expect(plan.totalWeeks).toBe(8);
    expect(plan.phases[0]!.startWeek).toBe(1);
    expect(plan.phases[plan.phases.length - 1]!.endWeek).toBe(8);
    for (let i = 1; i < plan.phases.length; i++) {
      expect(plan.phases[i]!.startWeek).toBe(plan.phases[i - 1]!.endWeek + 1);
    }
    expect(plan.phases[0]!.id).toBe('prepare'); // some_prep skips research
  });

  it('sizes tasks from the start blocker', () => {
    expect(buildPlan({ ...answers, startBlocker: 'overwhelmed' }).taskMinutes).toBe(10);
    expect(buildPlan({ ...answers, startBlocker: 'drift' }).taskMinutes).toBe(20);
  });

  it('warns when the target does not fit the hours', () => {
    const plan = buildPlan({ ...answers, doneWhen: { unit: 'applications', target: 400 }, hoursPerWeek: 3 });
    expect(plan.warnings.join(' ')).toMatch(/applications/);
  });

  it('handles tiny deadlines and every template', () => {
    for (const template of ['get_job', 'learn_skill', 'freelance', 'health', 'project', 'custom'] as const) {
      const plan = buildPlan({ ...answers, template, deadlineWeeks: 2, startState: 'nothing', doneWhen: null });
      expect(plan.phases.length).toBeGreaterThan(0);
      expect(plan.phases[plan.phases.length - 1]!.endWeek).toBe(2);
    }
  });

  it('finds the active phase by week and rotates picks', () => {
    const plan = buildPlan(answers);
    const goal: StoredGoal = { id: 'g1', createdOn: '2026-10-01', answers, plan };
    const early = activeTaskTypes([goal], '2026-10-02', daysBetween);
    expect(early.every((t) => t.goalId === 'g1')).toBe(true);
    const picks = [0, 1, 2].map((s) => pickRotating(early, 1, s)[0]!.id);
    expect(new Set(picks).size).toBeGreaterThan(1);
    expect(pickRotating(early, 10, 0).length).toBeLessThanOrEqual(early.length);
    expect(pickRotating([], 2, 0)).toEqual([]);
  });

  it('stays on the last phase after the plan ends', () => {
    const plan = buildPlan(answers);
    const goal: StoredGoal = { id: 'g1', createdOn: '2026-01-01', answers, plan };
    const late = activeTaskTypes([goal], '2026-10-01', daysBetween);
    expect(late.length).toBeGreaterThan(0);
  });

  it('rejects invalid answers', () => {
    expect(() => goalAnswersSchema.parse({ template: 'nope', outcome: 'x', hoursPerWeek: 5 })).toThrow();
    expect(() => goalAnswersSchema.parse({ template: 'custom', outcome: '', hoursPerWeek: 5 })).toThrow();
  });
});

describe('crew messages', () => {
  const base = {
    pressure: 'gradual' as const,
    seed: 3,
    msLeft: 10 * 3_600_000,
    tasksRequired: 2,
    requiredDone: 0,
    streak: 0,
    reputation: 50,
    lastResolved: null,
    paused: false,
  };
  it('encourages a start at the beginning of the day', () => {
    const m = crewMessages(base);
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((x) => x.from && x.text)).toBe(true);
  });
  it('is gentler in gentle mode near the deadline', () => {
    const harsh = crewMessages({ ...base, msLeft: 20 * 60_000 })[0]!.text;
    const gentle = crewMessages({ ...base, msLeft: 20 * 60_000, pressure: 'gentle' })[0]!.text;
    expect(harsh).not.toBe(gentle);
  });
  it('says nothing demanding on a paused day or when done', () => {
    expect(crewMessages({ ...base, paused: true })[0]!.text).toMatch(/Day off/);
    expect(crewMessages({ ...base, requiredDone: 2 })[0]!.text).not.toMatch(/left/);
  });
});
