# Plan

## 1. Context
Many people perform far better under deadlines than under open-ended goals. A 24-hour clock with two required actions, as in a game's daily challenge, makes time appear. This project turns real life into that loop for one player: daily deadlines with consequences, time measured by sensors instead of self-reporting, and gaming time that is earned and capped.

Typical player profile this is designed for:
- Procrastinates on important but easy-to-skip tasks (job applications, interview prep) and drifts into scrolling, reading and mobile games.
- Irregular sleep and a late wake time.
- May under-report or misreport their day when their mood is off, so tracking must be automatic.
- Cares how they look to others, so social stakes work better than abstract ones.

This is an open-source project. **All personal data lives in gitignored files** (see [CONFIGURATION.md](CONFIGURATION.md)); the repo ships formats and examples only.

## 2. What we build
A **website (PWA) and backend on a private server you own**, plus one small helper per device. Not separate full apps.

| Piece | What it is | Why |
|---|---|---|
| Server + website | Node/TypeScript API, database, game UI on your own domain (e.g. `life.example.com`), nightly Postgres dump to your cloud drive | Always on, your data stays with you |
| Android | Small native Kotlin companion app (usage stats, wake detection, notifications, quick tile) plus the PWA for the main UI | ActivityWatch Android can't sync to a server cleanly; `UsageStatsManager` is the source Digital Wellbeing uses |
| Mac | ActivityWatch (apps, AFK, browser extension) plus a small `launchd` sync agent | ActivityWatch has a local REST API on `localhost:5600` |
| E-reader (Kobo) | No live tracking and no data import. Manual start/stop from the phone | No API or custom apps |
| Time tracker (Solidtime) | Server reads billable time entries through its API (optional) | Source of truth for freelance hours and money |
| Work folder | Sync agent reports git commits and file/CSV changes from folders you list (never reads `.env` or secrets) | Unfakeable evidence for apply/research/prep quests |

## 3. Game design
- **Daily Tasks:** 24h window ending at a configured time. Two mandatory tasks plus optional bonuses. Success = both tasks done before the deadline.
- **Task 0 "Kickoff" (2 min):** sit at the desk, open the laptop, open the target site. You only have to start.
- **Tiny, concrete tasks** generated from templates and your own files, e.g. "Finish one gap-check area (15 min)", "Add 1 company to the targets list", "Log 1 application".
- **Big goal with phases** (progress bar) for a larger aim (e.g. getting a job): easy steps first, then apply, then mock interview. A graded ladder for fear of rejection.
- **Gaming budget:** earn play minutes per completed task, with a hard daily cap. Measured from Android usage, not declared.
- **Time score:** Productive / Neutral / Waste. Meals, washing, bath and sleep are Neutral and never hurt you. Billable work is Productive.
- **Pressure:** a virtual crew of named NPC mates whose "Reputation" opinion of you rises and falls; a private scoreboard link that turns red on a missed day; streak and rank loss. Severity is configurable. Nothing is ever auto-posted anywhere.
- **XP / levels / loot**, a wake-up bonus with a goal that tightens over time, and a money meter for freelance income.
- **Boredom Menu:** pre-approved 10-minute activities. Waste-app time triggers a nudge.
- **Freelance mode (optional):** per-client hourly rate and monthly cap read from config; bonus work time, not a daily quest.

## 4. Integrity: honest by default, light hints
Decision: assume the player is honest (see [DECISIONS.md](DECISIONS.md)). The point is to *see* where time goes, not to catch cheating.
1. Sensors (Mac activity, phone usage) are the main source of time data, so there is little to self-report.
2. Tasks show a **marker** when matching activity exists (a new CSV row, commits, time on a listed site). The player can always tick a task manually.
3. Manual routine timers (meals, bath, sleep) are trusted. If a sensor clearly disagrees, the app shows a gentle hint, never a penalty.
4. Time that no sensor or timer explains is shown as "Unaccounted" so the player can label it. Whether it counts as Waste is a setting.
5. Corrections are visible entries in an append-only log.
6. Tracker paused? The player says why (family, festival, travel, illness); paused days are not penalised.
7. Privacy: data stays on your server; secret files are never read; tokens live in `.env`. Full URLs are stored only for allow-listed public sites.

## 5. Manual inputs (only these)
Wake ("I start"), Wash, Bath, Lunch, Dinner, Sleep, Out, and optionally Reading start/stop. Everything else is automatic.
