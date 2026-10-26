# Doubts and Issues

Answer section **A** in your private file `private/DOUBTS-ANSWERS.md` (gitignored). Section **B** lists risks to be aware of.

## A. Questions that need an answer

| # | Question | Why it matters | Suggestion |
|---|---|---|---|
| A1 | What time should each day end? | The deadline is the core lever. | 11 pm to start, earlier as wake time improves. |
| A2 | Daily gaming cap and minutes earned per task? | Core reward rule. | 60 min per task, cap about 2.5 h. |
| A3 | Server OS, Docker?, existing reverse proxy/database, who manages DNS, which subdomain? | Decides deploy approach (P0-1, P0-4). | Docker Compose behind the existing reverse proxy on a dedicated subdomain. |
| A4 | Postgres or SQLite? | Backup and complexity trade-off. | SQLite for a single user; Postgres if one already runs. |
| A5 | Is the time tracker (Solidtime) on the same server and reachable by the game server? | P2-8 depends on it. | Assume yes; confirm. |
| A6 | One real "witness" later, or private-only? | Changes the pressure design. | Private-only first; revisit after 4 weeks. |
| A7 | Sideload the Android APK, or Play Store? | P3 scope. | Sideload. |
| A8 | Which Mac browser? | ActivityWatch extension coverage differs; Safari is weaker. | Chromium-based or Firefox. |
| A9 | Which task templates for week 1? | The game is only as good as its quests. | Kickoff + a few small prep/research items. |
| A10 | Wake-time goal and ramp? | Wake bonus. | 30 minutes earlier every two weeks. |
| A11 | Is the Mac mostly on/awake? | Folder evidence and e-reader import need it. | Let evidence arrive late (queued). |
| A12 | Store full URLs or only domain + title? | Privacy of browsing. | Domain + title; full URL only for allow-listed job sites. |
| A13 | Which license for the public repo (MIT, Apache-2.0, AGPL)? | Without one, nobody may legally reuse the code. | MIT or Apache-2.0. |

## B. Risks and issues

1. **Android background limits.** Samsung One UI aggressively kills background apps. Mitigation: battery-optimisation exemption, WorkManager, foreground service for the countdown. Needs real-device testing.
2. **Usage access vs. blocking.** The plan *measures* and *nudges*; it can't truly block games without Accessibility or Device Admin tricks, which are intrusive and easy to disable in a bad mood. Decide later (P3-7).
3. **The tracker can be switched off.** Missing data counts as Unaccounted -> Waste, and a heartbeat gap triggers a notification. A determined bypass can't be fully prevented.
4. **E-reader schema unknown.** Reading data is believed to be in `KoboReader.sqlite`, but table names must be checked on a real device (P4-5). Fallback: manual start/stop.
5. **ActivityWatch permissions on macOS.** Window titles need Accessibility permission; some setups need Screen Recording too.
6. **Evidence rules can be unfair.** Real work with no CSV row/commit looks Unverified. Mitigation: proof-screenshot partial credit and tuning after week 1.
7. **Evidence can be gamed** (e.g. a fake CSV row). The verifier cross-checks with the browser watcher, but can't be perfect.
8. **Punishment backlash.** Harsh penalties can make people quit after one bad day. Mitigation: a weekly grace day, small stakes at first, ramped difficulty (P4-6, P5-3).
9. **Sleep.** Wake time is the biggest lever and software can't force it. The app tracks and rewards.
10. **Scope.** Big for one person. Phase 0+1 alone give a working deadline game; don't build Phases 3-5 until Phase 1 has run for a week.
11. **Backup keys.** Encrypted backups are useless if the key is lost and unsafe if stored next to them (P0-5).
12. **Single point of failure.** If the server is down, phones queue events but day resolution waits. Add an uptime check.
13. **Public-repo hygiene.** Because the repo is public: no secrets, tokens, personal data or real hostnames in commits; real values only in gitignored files; a pre-commit secret scan (P0-7).
14. **Sensitive data on the server.** A detailed record of habits and browsing; keep behind login and HTTPS.
15. **Wellbeing.** Persistent oversleeping, severe procrastination and low motivation can have causes software can't fix. This tool supports, but doesn't replace, professional help.

## C. Assumptions
- Single player, single account; notifications to one Android phone.
- Nothing is ever posted to social media automatically.
- The game only reads the work folders you list; it never commits or edits them and never reads `.env` or credential files.
