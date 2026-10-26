import webpush from 'web-push';
import type { Pool } from '../db.js';
import type { EngineCtx } from './engine.js';

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  send(sub: PushSub, payload: string): Promise<void>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function createWebPushSender(v: VapidConfig): PushSender {
  webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey);
  return {
    async send(sub, payload) {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600 });
    },
  };
}

/** Sends to every subscription; subscriptions the push service says are gone (404/410) are removed. */
export async function sendToAll(pool: Pool, sender: PushSender, payload: { title: string; body: string; url?: string }): Promise<number> {
  const { rows } = await pool.query<{ endpoint: string; p256dh: string; auth: string }>('SELECT endpoint, p256dh, auth FROM push_subscriptions');
  let sent = 0;
  for (const sub of rows) {
    try {
      await sender.send(sub, JSON.stringify({ url: '/', ...payload }));
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
    }
  }
  return sent;
}

/** Reminder thresholds before the deadline, largest first. */
export const REMINDERS = [
  { kind: 'h6', ms: 6 * 3_600_000, label: '6 hours' },
  { kind: 'h2', ms: 2 * 3_600_000, label: '2 hours' },
  { kind: 'm30', ms: 30 * 60_000, label: '30 minutes' },
] as const;

/**
 * Sends the reminder for the smallest threshold crossed that has not been sent yet,
 * and marks every crossed threshold as sent so a late start never causes a burst.
 * Only fires while required tasks remain on an open day.
 */
export async function runReminders(ctx: EngineCtx, sender: PushSender): Promise<string | null> {
  const { pool, now } = ctx;
  const { rows } = await pool.query<{ id: string; ends_at: Date; tasks_required: number; done: string }>(
    `SELECT d.id, d.ends_at, d.tasks_required,
            (SELECT count(*) FROM tasks t WHERE t.day_id = d.id AND t.required AND t.status = 'done') AS done
       FROM days d WHERE d.status = 'open' AND d.starts_at <= $1 AND d.ends_at > $1`,
    [now],
  );
  const day = rows[0];
  if (!day) return null;
  const left = day.tasks_required - Number(day.done);
  const msLeft = day.ends_at.getTime() - now.getTime();
  const crossed = REMINDERS.filter((r) => msLeft <= r.ms);
  if (!crossed.length) return null;

  const sentRows = await pool.query<{ kind: string }>('SELECT kind FROM reminders_sent WHERE day_id = $1', [day.id]);
  const already = new Set(sentRows.rows.map((r) => r.kind));
  const fresh = crossed.filter((r) => !already.has(r.kind));
  if (!fresh.length) return null;
  for (const r of fresh) {
    await pool.query('INSERT INTO reminders_sent (day_id, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING', [day.id, r.kind]);
  }
  if (left <= 0) return null;
  const smallest = fresh[fresh.length - 1]!;
  await sendToAll(pool, sender, {
    title: 'Life Game',
    body: `${smallest.label} left. ${left} task${left > 1 ? 's' : ''} to go.`,
  });
  return smallest.kind;
}
