# Roadmap

Sizes: **S** under half a day, **M** 1-2 days, **L** 3-5 days. Sizes are rough guesses, not commitments.
Task IDs are stable so we can reference them in issues.

Suggested order: Phase 0 and 1 first (a usable game in days), then 2 (Mac), 3 (Android), 4 (integrity), 5 (polish).

---

## Phase 0: Foundations  (status: built, see checklist below)
**Goal:** a running, secure, deployable skeleton on your server.
**Done when:** you can log in at your domain, a health endpoint answers, and a backup lands in Google Drive.

**Status (2026-10-26):** P0-1 to P0-7 are implemented and tested locally (18 automated tests, Compose stack smoke-tested, backup/restore round-trip verified with a stand-in for rclone). Still to do on your side: set DNS, install the nginx vhost and certificate, configure rclone with a real Drive remote and do one real backup. See [DEPLOY.md](DEPLOY.md).

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P0-1 | Decide stack and repo layout (`server/`, `web/`, `android/`, `agent/`, `docs/`) | Skeleton + README agreed | - | S |
| P0-2 | Server scaffold (Node/TS, Postgres, migrations, Docker Compose) | `/health` OK; migrations run from scratch | P0-1 | M |
| P0-3 | Auth (single-user login + per-device API tokens) | Wrong token rejected; tokens revocable | P0-2 | M |
| P0-4 | Deploy with Docker Compose behind existing nginx (owner sets DNS, HTTPS cert) | Reachable over HTTPS; restarts on reboot | P0-2 | M |
| P0-5 | Nightly plain `pg_dump` to Google Drive + restore test | Restore into a fresh DB succeeds | P0-4 | S |
| P0-7 | Public-repo hygiene: config loader (`*.local.*` over `*.example.*`), pre-commit secret/personal-data scan, CI check | Commit containing `.env`, `*.local.*` or token-like strings is blocked | P0-1 | M |
| P0-6 | Core schema: events, time_blocks, days, tasks, evidence, budget, xp_ledger, adjustments | Matches ER diagram | P0-2 | M |

## Phase 1: MVP game (manual only, usable on day 1)  (status: built, see note)
**Goal:** the deadline loop works before any automation exists.
**Done when:** you play a full day end to end from your phone.

**Status (2026-10-26):** P1-1 to P1-13 are implemented, with 80 automated tests and a manual click-through of the web app in a browser. Not yet verified on a real Android phone: installing the app to the home screen, the service worker, and push delivery (the embedded test browser blocks both). Onboarding Stage 1 is a settings form in the Plan tab rather than a wizard, and the goal interview's fixed-dates question is not built yet.

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P1-1 | Day engine: daily cycle, fixed deadline, countdown, win/lose | Expired day resolves correctly in a shortened-window test | P0-6 | L |
| P1-2 | Task model, "Kickoff" task, quest templates | Tasks dealt daily from templates | P1-1 | M |
| P1-3 | Gaming budget (earn minutes, daily cap, over-budget state) | Budget changes on win/loss as specified | P1-1 | M |
| P1-4 | XP, level, streak, rank | Ledger totals match events | P1-1 | M |
| P1-5 | Manual routine timers (wake, wash, bath, lunch, dinner, sleep, out, kobo) | Start/stop saves a Neutral/Leisure block | P0-6 | M |
| P1-6 | PWA UI: day screen, countdown, timeline, timers; installable on Android | Installs to home screen; tolerates offline | P1-1, P1-5 | L |
| P1-7 | Web push reminders (6h / 2h / 30m) | Notification arrives at each mark | P1-6 | M |
| P1-8 | Virtual crew v1 (NPC messages, reputation meter) | Messages change with day results | P1-1 | M |
| P1-10 | Onboarding Stage 1: quick profile (12 questions) -> `profile.local.yml` | Answers saved; app uses them as defaults | P1-1 | M |
| P1-11 | Pause days with reason (no penalty, labelled gap in reports) | Paused day is not penalised and shows the reason | P1-1 | S |
| P1-12 | Onboarding Stage 3-4: goal interview + automatic breakdown into phases/weekly targets/daily tasks with capacity check | Fake-data example in `onboarding.example.yml` produces a sensible task plan | P1-2, P1-10 | L |
| P1-13 | Reward rule `min(60, cap / tasks_required)` and task ramp (add a task after 5 of 7 days met) | Reward shrinks as tasks grow; ramp respects max 1 new task/week | P1-3 | S |
| P1-9 | Seed your tasks, wake goal, budget numbers in the gitignored config files | Config reviewed by you | P1-2 | S |

## Phase 2: Mac automation  (status: built, needs your Mac to verify)
**Goal:** Mac time and work-folder work are tracked with no input from you.
**Done when:** a day of Mac use shows as correctly tagged blocks, and a new CSV row marks a task done.

**Status (2026-10-29):** P2-2 to P2-11 are implemented: ingest API, sync agent, rules and labels, timeline and daily stats, today/week/month/6-month reports, activity markers, work-folder and git watcher, Solidtime money meter, baseline week, and the Insights and device screens. 127 server tests and 20 agent tests pass, and the real agent was run against the real server with a stand-in ActivityWatch. **Not yet verified:** a real ActivityWatch install, the browser extension, launchd, and a live Solidtime server (its API was read from its source code and tested against a stand-in). See [AGENT.md](AGENT.md).

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P2-1 | Install and configure ActivityWatch + browser extension (you do this, see AGENT.md) | Window and URL events visible locally | - | S |
| P2-2 | Ingest API (batch, idempotent, checkpoints) | Re-sending a batch creates no duplicates | P0-3, P0-6 | M |
| P2-3 | Mac sync agent (launchd, reads `:5600`, offline catch-up) | After 10 min offline, events appear on reconnect | P2-2 | L |
| P2-4 | Rules engine + `categories.json` (app/site to Productive/Neutral/Waste) | Rule edits apply to past and new events | P2-2 | M |
| P2-5 | Time blocks + Unaccounted-as-Waste logic | Daily productive % matches a hand check | P2-4 | M |
| P2-6 | work-folder watcher (git commits, CSV rows, `prep/` files; ignores `.env`) | New `applications.csv` row shows a marker on the apply task | P2-3 | L |
| P2-7 | Activity-marker matcher v1 (soft markers, not strict proof) | Task shows a marker when matching activity is found | P2-6 | M |
| P2-9 | Reports: today, week, month, 6-month views (where time went, wake times, productive %) | Charts match raw events; paused days labelled | P2-5 | L |
| P2-10 | Chrome + Arc extension setup; allow-list of domains where full URLs are stored | Allow-listed sites store full URL, others domain + title | P2-1 | S |
| P2-11 | Baseline week mode (observe only, day-3 app labelling, end-of-week summary) | After 7 days a baseline summary is shown and categories built | P2-9, P2-4 | M |
| P2-8 | Solidtime connector + money meter (per-client rate and caps from `clients.local.yml`) | Hours and ₹ match Solidtime for a test week | P0-4 | M |

## Phase 3: Android app  (status: built, emulator-tested)
**Goal:** phone usage and wake time are tracked automatically and the game follows you.
**Done when:** game time on the phone is measured and a wake time is recorded without a tap.

**Status (2026-10-29):** P3-1 to P3-6 and P3-8 are implemented, and P3-7 as nudges only (no blocking). The server gained phone ingest, a status endpoint, phone-controlled wake and timers, wake detection from phone use, and game time that counts Mac and phone gaming. 143 server tests and 46 Android unit tests pass, and the app ran on an Android 14 emulator against the real server (usage upload, countdown notification, game-time nudge, both quick-settings tiles). **Not yet verified:** a real Samsung S23, One UI battery behaviour, wake detection over a real night, and an HTTPS server. See [ANDROID.md](ANDROID.md).

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P3-1 | Kotlin app skeleton (auth, settings, token entry) | Logs in and shows status | P0-3 | M |
| P3-2 | Usage stats collection (`UsageStatsManager`, per-app foreground time) | Totals within a few % of Digital Wellbeing | P3-1 | L |
| P3-3 | Screen on/off and unlock events to wake-time detection | First unlock after sleep recorded as wake | P3-1 | M |
| P3-4 | Upload via WorkManager with offline queue and retry | No loss or duplicates in airplane-mode test | P3-2, P2-2 | M |
| P3-5 | Notifications: day countdown (ongoing), budget warnings | Updates without opening the app | P3-1 | M |
| P3-6 | Quick tile/widget for routine timers | One tap starts/stops a timer | P1-5 | M |
| P3-8 | Keep-alive: restart on boot/unlock/charging/alarm events, heartbeat to server, "tracker off" prompt asks why | Service recovers after being killed; reason recorded for gaps | P3-1 | M |
| P3-7 | Game-time nudges (built). Friction blocking overlay is still open | Nudge fires while a game app is open and time is low or over | P3-2, P1-3 | M |

## Phase 4: Gentle integrity and pressure
**Goal:** the app stays honest-by-default with light hints, and the chosen pressure level is live.
**Done when:** a mismatched timer shows a gentle hint and a missed day shows on the private scoreboard.

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P4-1 | Soft consistency hints (e.g. timer says "meal" while a game is open: show a gentle note, no penalty) | Hints shown; nothing blocked | P2-5, P3-2 | S |
| P4-2 | Append-only log with visible corrections | No silent edits of past entries | P0-6 | S |
| P4-3 | Soft task markers (activity hints) + manual tick allowed | Task can be completed by marker or manual tick | P2-7 | S |
| P4-4 | Private scoreboard page (secret link, red MISSED, reputation) | Link works logged-out and is revocable | P1-8 | M |
| P4-5 | Optional wearable wake source (Fitbit API; check which API fits the device) | Wake time can come from the wearable | P1-5 | M |
| P4-6 | Escalation logic (grace day, weekly sharpening of consequences) | Behaviour matches written rules | P1-1 | M |

## Phase 5: Polish
**Goal:** it stays fun and keeps adapting after the first month.

| ID | Task | Acceptance criteria | Depends | Size |
|---|---|---|---|---|
| P5-1 | Big-goal phases (ladder to interviews) | Goal progress reflects completed tasks | P1-2 | L |
| P5-2 | Loot shop (rewards you define) | Unlock by level; redeemed state | P1-4 | M |
| P5-3 | Difficulty ramp (start with 1 tiny task; wake goal tightens) | Ramp configurable | P1-1 | M |
| P5-4 | Weekly summary email/notification + "mood" trend | Weekly summary generated | P2-9 | S |
| P5-5 | Boredom menu | Triggers on waste-app time | P3-2 | S |
| P5-7 | Weekly review flow (Onboarding Stage 5) | 4 questions adjust ramp, task size and plan | P1-12, P2-9 | M |
| P5-6 | Optional LinkedIn-ready weekly summary (copy/paste only, never auto-post) | Text generated for you to paste | P5-4 | S |

---

## Verification (applies to the build)
- Each phase: run its "Done when" scenario end to end.
- Shortened-window test for the lose path.
- Airplane-mode and Mac-asleep tests for offline catch-up.
- Compare productive % with a manual hand-count for one day.
- Restore-from-backup drill.
