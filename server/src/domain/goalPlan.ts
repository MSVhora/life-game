import { z } from 'zod';

export const GOAL_TEMPLATES = ['get_job', 'learn_skill', 'freelance', 'health', 'project', 'custom'] as const;
export const START_BLOCKERS = ['dont_open_it', 'drift', 'overwhelmed', 'stall', 'fear_of_rejection'] as const;

export const goalAnswersSchema = z.object({
  template: z.enum(GOAL_TEMPLATES),
  outcome: z.string().trim().min(1).max(200),
  /** Weeks until done; null means no deadline (a 12-week rolling plan is used). */
  deadlineWeeks: z.number().int().min(1).max(104).nullable().default(null),
  doneWhen: z
    .object({ unit: z.string().trim().min(1).max(40), target: z.number().int().min(1).max(100000) })
    .nullable()
    .default(null),
  startState: z.enum(['nothing', 'some_prep', 'ready']).default('nothing'),
  hoursPerWeek: z.number().min(0.5).max(80),
  startBlocker: z.enum(START_BLOCKERS).default('drift'),
});
export type GoalAnswers = z.infer<typeof goalAnswersSchema>;

export interface TaskType {
  id: string;
  title: string;
  minutes: number;
  xp: number;
  /** Completing this task type counts toward the goal's "done when" number. */
  countsTowardTarget?: boolean;
}

export interface Phase {
  id: string;
  title: string;
  startWeek: number; // 1-based, inclusive
  endWeek: number; // inclusive
  taskTypes: TaskType[];
}

export interface GoalPlan {
  totalWeeks: number;
  phases: Phase[];
  taskMinutes: number;
  sustainableTasksPerDay: number;
  warnings: string[];
}

interface PhaseTemplate {
  id: string;
  title: string;
  weight: number;
  tasks: Array<Omit<TaskType, 'minutes'> & { minutes?: number }>;
}

const T = (id: string, title: string, xp = 30, extra: Partial<TaskType> = {}) => ({ id, title, xp, ...extra });

const TEMPLATES: Record<(typeof GOAL_TEMPLATES)[number], PhaseTemplate[]> = {
  get_job: [
    { id: 'research_targets', title: 'Research targets', weight: 1, tasks: [T('add-company', 'Add 1 target company to your list', 20), T('read-job-post', 'Read 1 job post and note what they want', 20)] },
    { id: 'prepare', title: 'Prepare', weight: 2, tasks: [T('study-block', 'One focused study block', 30), T('fix-resume-bullet', 'Improve 1 resume or profile bullet', 25)] },
    { id: 'apply', title: 'Apply', weight: 3, tasks: [T('apply-one', 'Apply to 1 role', 40, { countsTowardTarget: true, minutes: 20 }), T('study-block', 'One focused study block', 30)] },
    { id: 'interview_prep', title: 'Interview prep', weight: 2, tasks: [T('practice-problem', 'Solve 1 practice problem', 35), T('mock-answer', 'Say 1 interview answer out loud', 30), T('apply-one', 'Apply to 1 role', 40, { countsTowardTarget: true, minutes: 20 })] },
    { id: 'interviews', title: 'Interviews', weight: 1, tasks: [T('company-prep', 'Prepare for the next interview', 40), T('follow-up', 'Send 1 follow-up message', 20)] },
  ],
  learn_skill: [
    { id: 'plan', title: 'Plan', weight: 1, tasks: [T('outline', 'Outline what to learn, in order', 20)] },
    { id: 'learn', title: 'Learn', weight: 4, tasks: [T('study-block', 'One focused study block', 30, { countsTowardTarget: true }), T('notes', 'Write 5 lines of notes from memory', 20)] },
    { id: 'practice', title: 'Practice', weight: 3, tasks: [T('exercise', 'Do 1 practice exercise', 35, { countsTowardTarget: true }), T('study-block', 'One focused study block', 30)] },
    { id: 'review', title: 'Review', weight: 1, tasks: [T('review', 'Review and test yourself', 30)] },
  ],
  freelance: [
    { id: 'offer', title: 'Shape your offer', weight: 1, tasks: [T('write-offer', 'Write or improve your one-line offer', 25)] },
    { id: 'outreach', title: 'Outreach', weight: 3, tasks: [T('send-outreach', 'Send 1 outreach message', 35, { countsTowardTarget: true, minutes: 15 }), T('portfolio', 'Improve 1 portfolio item', 30)] },
    { id: 'deliver', title: 'Deliver', weight: 2, tasks: [T('client-work', 'One focused block on client work', 30), T('follow-up', 'Follow up with 1 lead', 25)] },
  ],
  health: [
    { id: 'baseline', title: 'Set a baseline', weight: 1, tasks: [T('log-routine', 'Write down your current routine', 15)] },
    { id: 'build', title: 'Build the habit', weight: 4, tasks: [T('routine-step', 'Do today\'s routine step', 25, { countsTowardTarget: true }), T('wind-down', 'Start winding down at your target time', 25)] },
  ],
  project: [
    { id: 'scope', title: 'Scope', weight: 1, tasks: [T('define-scope', 'Define the smallest useful version', 25)] },
    { id: 'build', title: 'Build', weight: 4, tasks: [T('build-block', 'One focused build block', 30, { countsTowardTarget: true }), T('small-fix', 'Finish 1 small task', 25)] },
    { id: 'ship', title: 'Ship', weight: 1, tasks: [T('polish', 'Polish and test', 30), T('publish', 'Publish or hand it over', 40)] },
  ],
  custom: [
    { id: 'work', title: 'Work toward it', weight: 1, tasks: [T('work-block', 'One focused block on this goal', 30, { countsTowardTarget: true })] },
  ],
};

const BLOCKER_MINUTES: Record<(typeof START_BLOCKERS)[number], number> = {
  overwhelmed: 10,
  dont_open_it: 15,
  fear_of_rejection: 15,
  drift: 20,
  stall: 20,
};

/** Splits `total` weeks across weights, at least one week each when possible (largest remainder). */
function distributeWeeks(weights: number[], total: number): number[] {
  const n = weights.length;
  if (total <= n) return weights.map((_, i) => (i < total ? 1 : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * total);
  const base = raw.map((r) => Math.max(1, Math.floor(r)));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) base[order[k]!.i]! += 1;
  while (left < 0) {
    // Over-allocated by the one-week minimum: take a week from the longest phase.
    const longest = base.indexOf(Math.max(...base));
    base[longest]! -= 1;
    left += 1;
  }
  return base;
}

/** Deterministic breakdown of a goal into phases and task types (no AI). */
export function buildPlan(answers: GoalAnswers): GoalPlan {
  const phasesT = TEMPLATES[answers.template];
  const totalWeeks = answers.deadlineWeeks ?? 12;
  const skip = answers.startState === 'ready' ? Math.min(2, phasesT.length - 1) : answers.startState === 'some_prep' ? Math.min(1, phasesT.length - 1) : 0;
  const active = phasesT.slice(skip);
  const weeks = distributeWeeks(active.map((p) => p.weight), totalWeeks);

  const taskMinutes = BLOCKER_MINUTES[answers.startBlocker];
  let cursor = 1;
  const phases: Phase[] = [];
  active.forEach((p, i) => {
    const w = weeks[i] ?? 0;
    if (w === 0) return;
    phases.push({
      id: p.id,
      title: p.title,
      startWeek: cursor,
      endWeek: cursor + w - 1,
      taskTypes: p.tasks.map(({ minutes, ...t }) => ({ ...t, minutes: minutes ?? taskMinutes })),
    });
    cursor += w;
  });

  const warnings: string[] = [];
  const sustainable = Math.floor((answers.hoursPerWeek * 60) / (taskMinutes * 7));
  if (sustainable < 1) {
    warnings.push(`${answers.hoursPerWeek} h/week fits about ${Math.floor((answers.hoursPerWeek * 60) / taskMinutes)} tasks a week, so some days will have none. That is fine to start, or raise the hours.`);
  }
  if (answers.doneWhen) {
    const applyMinutes = Math.max(...phases.flatMap((p) => p.taskTypes.filter((t) => t.countsTowardTarget).map((t) => t.minutes)), taskMinutes);
    const countingWeeks = phases.filter((p) => p.taskTypes.some((t) => t.countsTowardTarget)).reduce((a, p) => a + (p.endWeek - p.startWeek + 1), 0);
    if (countingWeeks > 0) {
      const minutesPerWeek = (answers.doneWhen.target / countingWeeks) * applyMinutes;
      if (minutesPerWeek > answers.hoursPerWeek * 60 * 0.6) {
        warnings.push(`${answers.doneWhen.target} ${answers.doneWhen.unit} in ${countingWeeks} weeks needs about ${Math.round(minutesPerWeek / 60 * 10) / 10} h/week for that alone. Consider a longer deadline or a smaller number.`);
      }
    }
  }
  return { totalWeeks, phases, taskMinutes, sustainableTasksPerDay: Math.max(sustainable, 0), warnings };
}

export interface StoredGoal {
  id: string;
  createdOn: string; // local date YYYY-MM-DD
  answers: GoalAnswers;
  plan: GoalPlan;
}

/** Task types due now across all goals (the phase containing today's week of each goal). */
export function activeTaskTypes(goals: StoredGoal[], today: string, daysBetween: (a: string, b: string) => number): Array<TaskType & { goalId: string; goalTitle: string }> {
  const out: Array<TaskType & { goalId: string; goalTitle: string }> = [];
  for (const g of goals) {
    const week = Math.floor(daysBetween(g.createdOn, today) / 7) + 1;
    const last = g.plan.phases[g.plan.phases.length - 1];
    const phase = g.plan.phases.find((p) => week >= p.startWeek && week <= p.endWeek) ?? (last && week > last.endWeek ? last : g.plan.phases[0]);
    if (!phase) continue;
    for (const t of phase.taskTypes) out.push({ ...t, goalId: g.id, goalTitle: g.answers.outcome });
  }
  return out;
}

/** Picks `count` distinct candidates, rotating start position by `seed` (e.g. day number). */
export function pickRotating<T extends { id: string }>(candidates: T[], count: number, seed: number): T[] {
  const unique: T[] = [];
  for (const c of candidates) if (!unique.some((u) => u.id === c.id)) unique.push(c);
  if (unique.length === 0 || count <= 0) return [];
  const start = ((seed % unique.length) + unique.length) % unique.length;
  const out: T[] = [];
  for (let i = 0; i < Math.min(count, unique.length); i++) out.push(unique[(start + i) % unique.length]!);
  return out;
}
