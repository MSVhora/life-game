import type { Pool } from './db.js';
import { tick } from './services/engine.js';
import { runMarkers } from './services/markers.js';
import { recomputeDirty } from './services/stats.js';
import { syncTimeEntries, type TimeTrackerConfig } from './services/timetracker.js';
import { runReminders, type PushSender } from './services/push.js';
import { loadSettings } from './services/settings.js';

export interface SchedulerDeps {
  pool: Pool;
  configDir: string;
  clock?: () => Date;
  sender?: PushSender;
  log?: { error: (...args: unknown[]) => void };
  intervalMs?: number;
  timeTracker?: TimeTrackerConfig | null;
  fetcher?: typeof fetch;
}

/** Runs once a minute: resolves finished days, deals the current one, sends reminders. */
export function startScheduler(deps: SchedulerDeps): { stop: () => void; runOnce: () => Promise<void> } {
  const { pool, configDir, clock = () => new Date(), sender, log = console, intervalMs = 60_000, timeTracker, fetcher } = deps;
  let running = false;
  let lastTrackerSync = 0;
  const runOnce = async () => {
    if (running) return;
    running = true;
    try {
      const ctx = { pool, configDir, now: clock(), settings: await loadSettings(pool, configDir) };
      await tick(ctx);
      await recomputeDirty(ctx);
      await runMarkers(ctx);
      if (timeTracker && ctx.now.getTime() - lastTrackerSync > 10 * 60_000) {
        lastTrackerSync = ctx.now.getTime();
        await syncTimeEntries({ pool, timezone: ctx.settings.timezone, now: ctx.now }, timeTracker, fetcher).catch((e) => log.error('time tracker sync failed', e));
      }
      if (sender) await runReminders(ctx, sender);
    } catch (err) {
      log.error('scheduler tick failed', err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void runOnce(), intervalMs);
  timer.unref();
  void runOnce();
  return { stop: () => clearInterval(timer), runOnce };
}
