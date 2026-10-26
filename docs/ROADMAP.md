# Roadmap

Sizes: **S** under half a day, **M** 1-2 days, **L** 3-5 days. Sizes are rough guesses, not commitments.
Task IDs are stable so we can reference them in issues.

Suggested order: Phase 0 and 1 first (a usable game in days), then 2 (Mac), 3 (Android), 4 (integrity), 5 (polish).

---

## Phase 0: Foundations
**Goal:** a running, secure, deployable skeleton on your server.
**Done when:** you can log in at your domain, a health endpoint answers, and a backup lands in Google Drive.

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P0-1 | Decide stack and repo layout (`server/`, `web/`, `android/`, `agent/`, `docs/`) | Skeleton + README agreed | - | S |
| P0-2 | Server scaffold (Node/TS, DB, migrations) | `/health` OK; migrations run from scratch | P0-1 | M |
| P0-3 | Auth (single-user login + per-device API tokens) | Wrong token rejected; tokens revocable | P0-2 | M |
| P0-4 | Deploy to your server (Docker Compose, HTTPS on your domain) | Reachable over HTTPS; restarts on reboot | P0-2 | M |
| P0-5 | Encrypted nightly backup to Google Drive + restore test | Restore into a fresh DB succeeds | P0-4 | M |
| P0-7 | Public-repo hygiene: config loader (`*.local.*` over `*.example.*`), pre-commit secret/personal-data scan, CI check | Commit containing `.env`, `*.local.*` or token-like strings is blocked | P0-1 | M |
| P0-6 | Core schema: events, time_blocks, wars, attacks, evidence, budget, xp_ledger, adjustments | Matches ER diagram | P0-2 | M |

## Phase 1: MVP game (manual only, usable on day 1)
**Goal:** the deadline loop works before any automation exists.
**Done when:** you play a full war end to end from your phone.

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P1-1 | War engine: daily war, fixed deadline, countdown, win/lose | Expired war resolves correctly in a shortened-window test | P0-6 | L |
| P1-2 | Attack model, "Deploy" attack, quest templates | Attacks dealt daily from templates | P1-1 | M |
| P1-3 | Gaming budget (earn minutes, daily cap, over-budget state) | Budget changes on win/loss as specified | P1-1 | M |
| P1-4 | XP, level, streak, rank/trophies | Ledger totals match events | P1-1 | M |
| P1-5 | Manual routine timers (wake, wash, bath, lunch, dinner, sleep, out, kobo) | Start/stop saves a Neutral/Leisure block | P0-6 | M |
| P1-6 | PWA UI: war screen, countdown, timeline, timers; installable on Android | Installs to home screen; tolerates offline | P1-1, P1-5 | L |
| P1-7 | Web push reminders (6h / 2h / 30m) | Notification arrives at each mark | P1-6 | M |
| P1-8 | Virtual clan v1 (NPC messages, reputation meter) | Messages change with war results | P1-1 | M |
| P1-9 | Seed your attacks, wake goal, budget numbers in the gitignored config files | Config reviewed by you | P1-2 | S |

## Phase 2: Mac automation
**Goal:** Mac time and work-folder work are tracked with no input from you.
**Done when:** a day of Mac use shows as correctly tagged blocks, and a new CSV row verifies an attack.

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P2-1 | Install and configure ActivityWatch + browser extension | Window and URL events visible locally | - | S |
| P2-2 | Ingest API (batch, idempotent, checkpoints) | Re-sending a batch creates no duplicates | P0-3, P0-6 | M |
| P2-3 | Mac sync agent (launchd, reads `:5600`, offline catch-up) | After 10 min offline, events appear on reconnect | P2-2 | L |
| P2-4 | Rules engine + `categories.json` (app/site to Productive/Neutral/Waste) | Rule edits apply to past and new events | P2-2 | M |
| P2-5 | Time blocks + Unaccounted-as-Waste logic | Daily productive % matches a hand check | P2-4 | M |
| P2-6 | work-folder watcher (git commits, CSV rows, `prep/` files; ignores `.env`) | New `applications.csv` row verifies the apply attack | P2-3 | L |
| P2-7 | Evidence verifier v1 | Attack flips to Verified only with valid evidence | P2-6 | M |
| P2-8 | Solidtime connector + money meter (per-client rate and caps from `clients.local.yml`) | Hours and ₹ match Solidtime for a test week | P0-4 | M |

## Phase 3: Android app
**Goal:** phone usage and wake time are tracked automatically and the game follows you.
**Done when:** game time on the phone is measured and a wake time is recorded without a tap.

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P3-1 | Kotlin app skeleton (auth, settings, token entry) | Logs in and shows status | P0-3 | M |
| P3-2 | Usage stats collection (`UsageStatsManager`, per-app foreground time) | Totals within a few % of Digital Wellbeing | P3-1 | L |
| P3-3 | Screen on/off and unlock events to wake-time detection | First unlock after sleep recorded as wake | P3-1 | M |
| P3-4 | Upload via WorkManager with offline queue and retry | No loss or duplicates in airplane-mode test | P3-2, P2-2 | M |
| P3-5 | Notifications: war countdown (ongoing), budget warnings | Updates without opening the app | P3-1 | M |
| P3-6 | Quick tile/widget for routine timers | One tap starts/stops a timer | P1-5 | M |
| P3-7 | Game-budget nudges (alert at limit; lock overlay optional later) | Alert fires at budget limit | P3-2, P1-3 | M |

## Phase 4: Integrity and pressure
**Goal:** lying is harder than doing the task, and image pressure is live.
**Done when:** a faked timer is flagged and a lost war turns the scoreboard red.

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P4-1 | Cross-check manual timers against sensors | Inconsistent block flagged, not credited | P2-5, P3-2 | M |
| P4-2 | Immutable log + adjustments that cost XP | No edit path for past entries | P0-6 | M |
| P4-3 | Evidence tiers, Unverified handling, proof-screenshot partial credit | Tiers reflected in XP and budget | P2-7 | M |
| P4-4 | Private scoreboard page (secret link, red MISSED, reputation) | Link works logged-out and is revocable | P1-8 | M |
| P4-5 | Kobo import (read `KoboReader.sqlite` on mount; verify tables on your device) | Reading sessions appear as Leisure with timestamps | P2-3 | L |
| P4-6 | Escalation logic (grace day, weekly sharpening of consequences) | Behaviour matches written rules | P1-1 | M |

## Phase 5: Polish
**Goal:** it stays fun and keeps adapting after the first month.

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P5-1 | Boss fights with phases (ladder to interviews) | Boss HP reflects verified attacks | P1-2 | L |
| P5-2 | Loot shop (rewards you define) | Unlock by level; redeemed state | P1-4 | M |
| P5-3 | Difficulty ramp (start with 1 tiny attack; wake goal tightens) | Ramp configurable | P1-1 | M |
| P5-4 | Daily and weekly reports (productive %, wake times, applications, money) | Weekly summary generated | P2-5 | M |
| P5-5 | Boredom menu | Triggers on waste-app time | P3-2 | S |
| P5-6 | Optional LinkedIn-ready weekly summary (copy/paste only, never auto-post) | Text generated for you to paste | P5-4 | S |

---

## Verification (applies to the build)
- Each phase: run its "Done when" scenario end to end.
- Shortened-window test for the lose path.
- Airplane-mode and Mac-asleep tests for offline catch-up.
- Compare productive % with a manual hand-count for one day.
- Restore-from-backup drill.
