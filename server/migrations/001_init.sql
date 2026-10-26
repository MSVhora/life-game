-- Core schema (matches docs/ARCHITECTURE.md data model).
-- Single player, single account: no users table. The admin password hash lives in env.

CREATE TABLE devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'other' CHECK (kind IN ('android', 'mac', 'web', 'other')),
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

-- Raw sensor and timer events. Append-only; corrections go in `adjustments`.
CREATE TABLE events (
  id              bigserial PRIMARY KEY,
  device_id       uuid NOT NULL REFERENCES devices (id),
  source          text NOT NULL,   -- activitywatch | android_usage | manual_timer | solidtime | folder
  kind            text NOT NULL,   -- e.g. window, web, app_usage, unlock, timer_start, timer_stop, commit
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts              timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  UNIQUE (device_id, idempotency_key)
);
CREATE INDEX events_ts_idx ON events (ts);
CREATE INDEX events_source_ts_idx ON events (source, ts);

-- Classified stretches of time rolled up from events and manual timers.
CREATE TABLE time_blocks (
  id       bigserial PRIMARY KEY,
  start_at timestamptz NOT NULL,
  end_at   timestamptz NOT NULL,
  category text NOT NULL CHECK (category IN ('Productive', 'Neutral', 'Waste', 'Gaming', 'Leisure', 'Unaccounted')),
  source   text NOT NULL CHECK (source IN ('sensor', 'manual', 'timetracker')),
  label    text,
  app      text,
  CHECK (end_at > start_at)
);
CREATE INDEX time_blocks_start_idx ON time_blocks (start_at);

-- One row per 24h cycle ("day").
CREATE TABLE days (
  id             bigserial PRIMARY KEY,
  local_date     date NOT NULL UNIQUE,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'missed', 'paused')),
  tasks_required integer NOT NULL DEFAULT 2 CHECK (tasks_required >= 0),
  resolved_at    timestamptz,
  CHECK (ends_at > starts_at)
);

CREATE TABLE tasks (
  id              bigserial PRIMARY KEY,
  day_id          bigint NOT NULL REFERENCES days (id) ON DELETE CASCADE,
  template_id     text,
  title           text NOT NULL,
  planned_minutes integer CHECK (planned_minutes > 0),
  xp              integer NOT NULL DEFAULT 0,
  reward_minutes  integer NOT NULL DEFAULT 0,
  required        boolean NOT NULL DEFAULT true,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped')),
  completion_kind text CHECK (completion_kind IN ('marker', 'manual')),
  completed_at    timestamptz
);
CREATE INDEX tasks_day_idx ON tasks (day_id);

-- Soft activity hints that a task was worked on (not strict proof).
CREATE TABLE task_markers (
  id         bigserial PRIMARY KEY,
  task_id    bigint NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  type       text NOT NULL,   -- csv_new_row | site_visit | folder_change | active_time | mac_active
  ref        text,
  matched_at timestamptz NOT NULL DEFAULT now(),
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Gaming minutes earned and used per day.
CREATE TABLE budget_days (
  day_id         bigint PRIMARY KEY REFERENCES days (id) ON DELETE CASCADE,
  cap_minutes    integer NOT NULL CHECK (cap_minutes >= 0),
  earned_minutes integer NOT NULL DEFAULT 0 CHECK (earned_minutes >= 0),
  used_minutes   integer NOT NULL DEFAULT 0 CHECK (used_minutes >= 0)
);

CREATE TABLE xp_ledger (
  id      bigserial PRIMARY KEY,
  ts      timestamptz NOT NULL DEFAULT now(),
  delta   integer NOT NULL,
  reason  text NOT NULL,
  task_id bigint REFERENCES tasks (id) ON DELETE SET NULL
);

-- Visible corrections to past data (the log itself is never edited silently).
CREATE TABLE adjustments (
  id           bigserial PRIMARY KEY,
  ts           timestamptz NOT NULL DEFAULT now(),
  target_table text NOT NULL,
  target_id    bigint NOT NULL,
  note         text,
  patch        jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Tracker paused for a day or more; never penalised, shown as a labelled gap.
CREATE TABLE pause_days (
  id         bigserial PRIMARY KEY,
  local_date date NOT NULL UNIQUE,
  reason     text NOT NULL CHECK (reason IN ('family', 'travel', 'festival', 'illness', 'other')),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Free-form per-player settings (onboarding answers, ramp state, etc.).
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
