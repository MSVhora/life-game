# Decisions

Settled answers to the earlier open questions. Anything player-specific is configuration, not a hard-coded rule.

## Product direction
- **Tracking comes first, tasks second.** The main value is showing the player where their time went (today, this week, this month, last 6 months). Tasks are a nudge: missing them is not a disaster, it is just data. This reorders the roadmap: reports move earlier (see P2-9).
- **Honest by default.** We assume the player is honest. Sensors (Mac activity, phone usage) provide *markers* that work happened; there is no heavy "evidence verification". Faking is the player's own loss. This replaces the strict integrity rules from the first draft; only cheap cross-checks stay.
- **Penalty style is a player choice**: gentle (just data), gradual, or harsh. Set during onboarding, changeable any time.
- **Single player, single account, single notification target.** Nothing is posted to social media. No secrets are read.
- **Private only**: no witness or social sharing. A private scoreboard link stays optional.

## Rewards
- Gaming time is earned per completed task. Start: **60 minutes per task** with 2 tasks/day.
- As the player takes more tasks per day, the per-task reward **goes down** so the daily total stays under the cap. Rule: `reward_per_task = min(60, daily_cap / tasks_required)` (configurable).

## Time and wake-up
- The day-end/first wake goal starts at **12:00** and moves **at the player's own pace** (chosen in onboarding; "very slow" for irregular sleepers). No fixed 30 min/week rule.
- Wake time source is the player's choice: manual "I'm up", phone first-unlock, or a wearable (Fitbit) via its API if they want it.
- The tracker may be **paused for a day or two** (family, festival, travel, illness). The app asks why and does not penalise paused days.

## Stack and ops
- **Docker Compose** behind the existing **nginx** reverse proxy. The owner manages DNS.
- **Postgres**.
- **Backups**: plain `pg_dump` uploaded to the owner's Google Drive. No extra encryption (it is a personal Drive).
- Server downtime is accepted (personal tool). Devices queue events and sync later.
- **Time tracker (Solidtime)** is read through its API using a token kept in `.env`.
- **License: MIT.**
- **Public repo from the start**, with personal data in gitignored files (see [CONFIGURATION.md](CONFIGURATION.md)).

## Devices
- **Mac**: ActivityWatch with the extension in Chrome-family browsers (Chrome, Arc). Full URLs are stored for allow-listed public sites (e.g. job boards); other sites store domain and title only.
- **Android**: sideloaded APK first. Usage access is the player's permission to grant. Optional "friction blocking" for over-budget apps (the player can disable it, but it takes effort). The app tries to stay alive and restarts on events (boot, unlock, charging, alarm).
- **E-reader**: manual start/stop only. No database import (the data is not reliably accessible).

## Scope
- The owner expects to finish the build in roughly a week. We'll treat Phases 0-1 as the first milestone and decide on the rest from real use.
