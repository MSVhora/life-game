# Plan

## 1. Context
Many people perform far better under deadlines than under open-ended goals. A 24-hour clock with two required actions, as in a game's daily war, makes time appear. This project turns real life into that loop for one player: daily deadlines with consequences, time measured by sensors instead of self-reporting, and gaming time that is earned and capped.

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
| Server + website | Node/TypeScript API, database, game UI on your own domain (e.g. `life.example.com`), nightly encrypted backup to cloud storage | Always on, your data stays with you |
| Android | Small native Kotlin companion app (usage stats, wake detection, notifications, quick tile) plus the PWA for the main UI | ActivityWatch Android can't sync to a server cleanly; `UsageStatsManager` is the source Digital Wellbeing uses |
| Mac | ActivityWatch (apps, AFK, browser extension) plus a small `launchd` sync agent | ActivityWatch has a local REST API on `localhost:5600` |
| E-reader (Kobo) | No live tracking. Auto-import of `KoboReader.sqlite` when plugged into the Mac, plus optional manual start/stop from the phone | No API or custom apps |
| Time tracker (Solidtime) | Server reads billable time entries through its API (optional) | Source of truth for freelance hours and money |
| Work folder | Sync agent reports git commits and file/CSV changes from folders you list (never reads `.env` or secrets) | Unfakeable evidence for apply/research/prep quests |

## 3. Game design
- **Daily War:** 24h window ending at a configured time. Two mandatory attacks plus optional bonuses. Win = both attacks verified before the deadline.
- **Attack 0 "Deploy" (2 min):** sit at the desk, open the laptop, open the target site. You only have to start.
- **Tiny, concrete attacks** generated from templates and your own files, e.g. "Finish one gap-check area (15 min)", "Add 1 company to the targets list", "Log 1 application".
- **Boss with phases** for a big goal (e.g. getting a job): easy steps first, then apply, then mock interview. A graded ladder for fear of rejection.
- **Gaming budget:** earn play minutes per verified attack, with a hard daily cap. Measured from Android usage, not declared.
- **Time score:** Productive / Neutral / Waste. Meals, washing, bath and sleep are Neutral and never hurt you. Billable work is Productive.
- **Pressure:** a virtual clan of named NPC mates whose "Reputation" opinion of you rises and falls; a private scoreboard link that turns red on a lost war; streak and rank loss. Severity is configurable. Nothing is ever auto-posted anywhere.
- **XP / levels / loot**, a wake-up bonus with a goal that tightens over time, and a money meter for freelance income.
- **Boredom Menu:** pre-approved 10-minute activities. Waste-app time triggers a nudge.
- **Freelance mode (optional):** per-client hourly rate and monthly cap read from config; bonus raid time, not a daily quest.

## 4. Integrity rules (assume the player may lie on a bad day)
1. Sensors outrank the player's word. Self-reported data is the lowest tier.
2. Append-only log with server timestamps. Corrections are visible "adjustments" that cost XP.
3. Quests need evidence (new row in a tracked CSV plus a job-site visit, commits or files in a prep folder, active time in the right app/site, Mac awake for "Deploy"). No evidence = "Unverified": tiny XP, doesn't win the war or unlock game minutes.
4. Manual routine timers are cross-checked against sensors. A "Lunch" timer while the Mac shows coding is flagged and not credited.
5. Unaccounted time (no sensor or timer explains it) counts as Waste by default.
6. Honest limit: a determined cheater can fool any tracker. The aim is to make lying harder than doing the task. A proof-screenshot path gives partial credit for work sensors missed.
7. Privacy: data stays on your server; secret files are never read or synced; API tokens go in local config.

## 5. Manual inputs (only these)
Wake ("I start"), Wash, Bath, Lunch, Dinner, Sleep, Out, and optionally Reading start/stop. Everything else is automatic.
