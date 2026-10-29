-- Phase 2: automatic tracking, labels, daily stats, freelance entries, task markers.

-- Ingested events may be re-sent with a longer duration (ActivityWatch merges heartbeats),
-- so the (device_id, idempotency_key) pair is upserted. Make lookups by time and kind cheap.
CREATE INDEX events_kind_ts_idx ON events (source, kind, ts);

-- Player-defined labels for apps and sites; they win over config/categories rules.
CREATE TABLE app_labels (
  kind       text NOT NULL CHECK (kind IN ('app', 'domain')),
  value      text NOT NULL,
  category   text NOT NULL CHECK (category IN ('Productive', 'Neutral', 'Waste', 'Gaming', 'Leisure')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, value)
);

-- One row per calendar day (player time zone) with the rolled-up result of the timeline.
CREATE TABLE daily_stats (
  local_date        date PRIMARY KEY,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  totals            jsonb NOT NULL,                 -- seconds per category
  items             jsonb NOT NULL,                 -- top apps/sites: [{kind,key,category,seconds}]
  active_seconds    integer NOT NULL DEFAULT 0,
  away_seconds      integer NOT NULL DEFAULT 0,
  longest_focus_min integer NOT NULL DEFAULT 0,
  first_gaming_min  integer                         -- minutes after local midnight
);

-- Days whose stats must be recomputed (new events arrived, or labels changed).
CREATE TABLE stats_dirty (
  local_date date PRIMARY KEY,
  marked_at  timestamptz NOT NULL DEFAULT now()
);

-- Time entries read from the time tracker (Solidtime) for the money meter.
CREATE TABLE freelance_entries (
  external_id  text PRIMARY KEY,
  start_at     timestamptz NOT NULL,
  end_at       timestamptz,                         -- null while the timer is running
  duration_s   integer NOT NULL DEFAULT 0,
  project_name text,
  client_name  text,
  billable     boolean NOT NULL DEFAULT true,
  synced_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX freelance_entries_start_idx ON freelance_entries (start_at);

-- Time entries also appear in time_blocks (Productive) so reports include freelance work.
ALTER TABLE time_blocks ADD COLUMN external_id text;
CREATE UNIQUE INDEX time_blocks_external_idx ON time_blocks (external_id) WHERE external_id IS NOT NULL;

-- One marker per type per task.
CREATE UNIQUE INDEX task_markers_task_type_idx ON task_markers (task_id, type);
