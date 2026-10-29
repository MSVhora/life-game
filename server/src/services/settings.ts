import path from 'node:path';
import { z } from 'zod';
import { loadConfigFile } from '../config-files.js';
import type { Pool } from '../db.js';
import { localDateString, parseHHMM } from '../domain/time.js';
import type { StoredGoal } from '../domain/goalPlan.js';

const hhmm = z.string().refine((v) => {
  try { parseHHMM(v); return true; } catch { return false; }
}, 'Use HH:MM');

const timezone = z.string().refine((v) => {
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
}, 'Unknown timezone');

export const settingsSchema = z.object({
  timezone,
  dayEndsAt: hhmm,
  startTasksPerDay: z.number().int().min(0).max(8),
  maxTasksPerDay: z.number().int().min(1).max(8),
  raiseAfterDaysMet: z.number().int().min(1).max(7),
  dailyCapMinutes: z.number().int().min(0).max(1440),
  perTaskMaxMinutes: z.number().int().min(0).max(600),
  lossPenalty: z.enum(['none', 'halve_next_day', 'zero_next_day']),
  graceDaysPerWeek: z.number().int().min(0).max(3),
  pressure: z.enum(['data_only', 'gentle', 'gradual', 'harsh']),
  wakeGoalBefore: hhmm,
  wakeGoalFinal: hhmm,
  wakeRampMinutesPerWeek: z.number().int().min(0).max(180),
  sleepGoalBy: hhmm,
});
export type Settings = z.infer<typeof settingsSchema>;
export const profilePatchSchema = settingsSchema.partial();

export interface EvidenceRule {
  type: string;
  source?: string;
  domains?: string[];
  categories?: string[];
  min_minutes?: number;
  min_seconds?: number;
}

export interface QuestTemplate {
  id: string;
  title: string;
  minutes: number;
  xp: number;
  evidence?: EvidenceRule[];
}

interface PlayerFile {
  timezone?: string;
  day?: { ends_at?: string; tasks_required?: number; grace_days_per_week?: number };
  gaming?: { daily_cap_minutes?: number; minutes_per_task?: number; loss_penalty?: string };
  wake?: { goal_before?: string; final_goal?: string; ramp_minutes_per_week?: number };
  sleep?: { goal_by?: string };
  pressure?: { level?: string };
  ramp?: { max_tasks_per_day?: number; raise_after_days_met?: number };
}

export function defaultSettings(configDir: string): Settings {
  const f = loadConfigFile<PlayerFile>(configDir, 'player').data ?? {};
  return settingsSchema.parse({
    timezone: f.timezone ?? 'UTC',
    dayEndsAt: f.day?.ends_at ?? '23:00',
    startTasksPerDay: f.day?.tasks_required ?? 2,
    maxTasksPerDay: f.ramp?.max_tasks_per_day ?? 5,
    raiseAfterDaysMet: f.ramp?.raise_after_days_met ?? 5,
    dailyCapMinutes: f.gaming?.daily_cap_minutes ?? 120,
    perTaskMaxMinutes: f.gaming?.minutes_per_task ?? 60,
    lossPenalty: f.gaming?.loss_penalty ?? 'halve_next_day',
    graceDaysPerWeek: f.day?.grace_days_per_week ?? 1,
    pressure: f.pressure?.level ?? 'gradual',
    wakeGoalBefore: f.wake?.goal_before ?? '12:00',
    wakeGoalFinal: f.wake?.final_goal ?? f.wake?.goal_before ?? '12:00',
    wakeRampMinutesPerWeek: f.wake?.ramp_minutes_per_week ?? 0,
    sleepGoalBy: f.sleep?.goal_by ?? '03:00',
  });
}

export function loadQuestTemplates(configDir: string): QuestTemplate[] {
  const f = loadConfigFile<{ templates?: Array<Partial<QuestTemplate>> }>(configDir, 'quests').data;
  return (f?.templates ?? [])
    .filter((t): t is QuestTemplate => !!t.id && !!t.title)
    .map((t) => ({ id: t.id, title: t.title, minutes: t.minutes ?? 15, xp: t.xp ?? 20, evidence: t.evidence }));
}

export async function getSetting<T>(pool: Pool, key: string): Promise<T | undefined> {
  const { rows } = await pool.query<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value;
}

export async function putSetting(pool: Pool, key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function loadSettings(pool: Pool, configDir: string): Promise<Settings> {
  const overrides = (await getSetting<Partial<Settings>>(pool, 'profile')) ?? {};
  return settingsSchema.parse({ ...defaultSettings(configDir), ...overrides });
}

export async function saveProfilePatch(pool: Pool, configDir: string, patch: Partial<Settings>): Promise<Settings> {
  const current = (await getSetting<Partial<Settings>>(pool, 'profile')) ?? {};
  const merged = { ...current, ...patch };
  const effective = settingsSchema.parse({ ...defaultSettings(configDir), ...merged }); // validates the combination
  await putSetting(pool, 'profile', merged);
  return effective;
}

/** Date the wake-goal ramp started; set the first time it is needed. */
export async function rampStartDate(pool: Pool, tz: string, now: Date): Promise<string> {
  const meta = await getSetting<{ startedOn: string }>(pool, 'meta');
  if (meta?.startedOn) return meta.startedOn;
  const startedOn = localDateString(now, tz);
  await putSetting(pool, 'meta', { startedOn });
  return startedOn;
}

export async function getGoals(pool: Pool): Promise<StoredGoal[]> {
  return (await getSetting<StoredGoal[]>(pool, 'goals')) ?? [];
}

export async function putGoals(pool: Pool, goals: StoredGoal[]): Promise<void> {
  await putSetting(pool, 'goals', goals);
}

export const defaultConfigDir = (): string =>
  process.env.CONFIG_DIR ? path.resolve(process.env.CONFIG_DIR) : path.resolve(process.cwd(), '../config');
