import type { Pressure } from './game.js';

export interface CrewMessage {
  from: string;
  text: string;
}

export interface CrewInput {
  pressure: Pressure;
  /** Seed for stable variety within a day, e.g. the day number. */
  seed: number;
  msLeft: number;
  tasksRequired: number;
  requiredDone: number;
  streak: number;
  reputation: number;
  lastResolved: 'done' | 'missed' | 'paused' | null;
  paused: boolean;
}

/** Fictional teammates. They react to your state; they are not real people and never message anyone. */
export const CREW = ['Maya', 'Dev', 'Rin', 'Sol'] as const;

const pick = <T>(arr: readonly T[], seed: number): T => arr[((seed % arr.length) + arr.length) % arr.length]!;

export function crewMessages(i: CrewInput): CrewMessage[] {
  const out: CrewMessage[] = [];
  const say = (n: number, text: string) => out.push({ from: pick(CREW, i.seed + n), text });
  const left = i.tasksRequired - i.requiredDone;
  const hoursLeft = i.msLeft / 3_600_000;
  const soft = i.pressure === 'data_only' || i.pressure === 'gentle';

  if (i.paused) {
    say(0, 'Day off noted. Nothing counts against you today.');
    return out;
  }

  if (left <= 0) {
    say(0, pick(['All required tasks done. The rest of the day is yours.', 'Done for today. Nice work.', 'That is the day. Enjoy your time.'], i.seed));
  } else if (hoursLeft <= 0.5) {
    say(1, soft ? `${Math.round(i.msLeft / 60000)} minutes left. Even one small task counts.` : `${Math.round(i.msLeft / 60000)} minutes left and ${left} to go. Go now.`);
  } else if (hoursLeft <= 2) {
    say(1, soft ? `About ${Math.ceil(hoursLeft)} hours left. A 10-minute start is enough.` : `${left} task${left > 1 ? 's' : ''} left with ${Math.ceil(hoursLeft)} hours on the clock.`);
  } else if (i.requiredDone === 0) {
    say(1, pick(['Start with the Kickoff. It takes two minutes.', 'Open the laptop first. Everything else follows.', 'Pick the smallest task and begin.'], i.seed));
  } else {
    say(1, `${i.requiredDone} of ${i.tasksRequired} done. Keep going.`);
  }

  if (i.streak >= 3) say(2, `${i.streak}-day streak. Do not let it slip.`);
  if (i.lastResolved === 'missed' && !soft) say(3, 'Yesterday was missed. Today is a clean start.');
  if (i.lastResolved === 'missed' && soft) say(3, 'Yesterday did not go to plan. Today is a fresh one.');
  if (i.lastResolved === 'done') say(3, 'Yesterday was a win. Repeat it.');
  if (i.pressure !== 'data_only' && i.reputation >= 75) say(0, 'The crew thinks highly of you right now.');
  if (i.pressure !== 'data_only' && i.reputation <= 30) say(0, 'The crew is worried. A good day turns it around.');
  return out.slice(0, 4);
}
