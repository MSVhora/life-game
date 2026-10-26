-- Phase 1: manual timers, wake log, push reminders, task/goal links.

-- At most one timer runs at a time (enforced by the partial unique index).
CREATE TABLE timers (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('wash', 'bath', 'lunch', 'dinner', 'sleep', 'out', 'reading', 'gaming', 'work', 'other')),
  label      text,
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);
CREATE UNIQUE INDEX timers_one_running ON timers ((true)) WHERE stopped_at IS NULL;
CREATE INDEX timers_started_idx ON timers (started_at);

CREATE TABLE wake_logs (
  local_date date PRIMARY KEY,
  woke_at    timestamptz NOT NULL,
  source     text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'phone', 'wearable'))
);

CREATE TABLE push_subscriptions (
  id         bigserial PRIMARY KEY,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One reminder per threshold per day.
CREATE TABLE reminders_sent (
  day_id  bigint NOT NULL REFERENCES days (id) ON DELETE CASCADE,
  kind    text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day_id, kind)
);

ALTER TABLE tasks ADD COLUMN goal_id text;

-- A day's success bonus can only be granted once.
ALTER TABLE xp_ledger ADD COLUMN day_id bigint REFERENCES days (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX xp_day_bonus_once ON xp_ledger (day_id) WHERE reason = 'day_bonus';
