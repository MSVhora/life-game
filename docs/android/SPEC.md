# Android app: specification

Status: version 0.2.0. "Must" means required for the app to be usable; "should" means expected but not blocking.

## 1. Purpose
Measure what the player does on the phone, show how long is left in the day, warn about game time, and let the player log a wake-up or run a timer in one tap. The server holds all rules, scores and history; the phone is a sensor and a remote.

## 2. Out of scope
Blocking or closing apps; editing tasks or goals (use the web app); reading anything inside other apps; sharing data with anyone but the player's own server; publishing on Google Play.

## 3. Functional requirements

### FR-1 Connection
- FR-1.1 The player must be able to enter a server address and a device token and test them. Result is shown inline as success (with the day summary) or a specific failure.
- FR-1.2 The address is saved even when the test fails (the player may be offline).
- FR-1.3 If a token is already saved, the token field may stay empty and the saved one is kept.
- FR-1.4 An empty address is refused with "Enter the server address."; a missing token with "Enter the device token."
- FR-1.5 The token must be stored encrypted with a key held in the Android Keystore; it is never shown or logged.
- FR-1.6 Release builds must only talk HTTPS; plain HTTP is allowed in debug builds only.

### FR-2 Usage collection
- FR-2.1 The app records foreground app sessions: start time and length, with the app's display name and package id.
- FR-2.2 A session starts when an app resumes and ends when it pauses, when another app resumes, when the screen turns off, or when the device shuts down.
- FR-2.3 Pause and resume of the same app within 3 seconds are joined into one session. Sessions shorter than 1 second are dropped.
- FR-2.4 System UI and the app itself are not recorded.
- FR-2.5 A session still open at collection time is sent as ongoing (length up to now) and is re-sent, with the same key and a longer length, on later rounds.
- FR-2.6 Screen on, screen off and unlock times are recorded as events.
- FR-2.7 The first collection looks back 3 days. Later ones start 10 minutes before the last checkpoint, or at the start of the session that was open, whichever is earlier.
- FR-2.8 App names have invisible direction marks removed, so the same app always has one name.
- FR-2.9 Without the usage-access permission nothing is collected and the app says so; it never fails silently.

### FR-3 Queue and upload
- FR-3.1 Collected events go into a durable queue before any upload.
- FR-3.2 An event with an existing key replaces the queued one.
- FR-3.3 Events upload in batches of at most 300, oldest first.
- FR-3.4 Events are removed from the queue only after the server accepted their batch.
- FR-3.5 A failed upload leaves events queued, records a readable error, and does not count as a successful sync.
- FR-3.6 The queue holds at most 100,000 events; the oldest are dropped first.
- FR-3.7 Errors are readable: refused token, unknown host, timeout, unreachable, server problem, server message.

### FR-4 Status
- FR-4.1 Each sync fetches the day status (deadline, tasks done and required, game-time earned, used, remaining and cap, wake state, running timer, baseline flag, pressure level, game apps) and caches it.
- FR-4.2 If a refresh fails the last good status stays visible.
- FR-4.3 The deadline countdown is shown only on days that count: not during the baseline week and not on a day off. Those days show a plain message instead.

### FR-5 Today screen
- FR-5.1 Shows, top to bottom: connection or error banner when needed; the day card (live countdown, end time, task progress); game time (minutes left, or minutes over what was earned, with earned, used and cap); wake-up (goal and an "I'm up" button, or "Logged for today"); timer (kind chips and Start, or elapsed time and Stop); last-sync line with the number of events waiting.
- FR-5.2 The countdown updates every second without redrawing the rest of the screen, and changes colour when under 2 hours (warning) and under 30 minutes (urgent).
- FR-5.3 Before the app is connected the screen shows a single card that leads to Setup.
- FR-5.4 A refresh action is always available and shows progress while syncing.
- FR-5.5 Results of taps (wake, timer) appear as a short message.

### FR-6 Setup screen
- FR-6.1 Connection form (FR-1), three permission rows, a tracking switch, a "Sync now" button, and diagnostics (last sync, waiting events, last upload, last error, version).
- FR-6.2 Permission rows: usage access (required), notifications (required), battery unrestricted (recommended). Each shows its state and a button that opens the right system screen. States are re-read whenever the screen comes back into view.
- FR-6.3 If the app is not connected at first launch, Setup is the first screen.

### FR-7 Tracking lifecycle
- FR-7.1 With tracking on, a foreground service runs, syncs once a minute, and keeps the countdown notification.
- FR-7.2 The service restarts after a crash (sticky), after a reboot and after an app update, if tracking was on.
- FR-7.3 A job every 15 minutes syncs even if the service was stopped by the system. A failure to schedule it must not stop the service.
- FR-7.4 Switching tracking off stops the service and removes the notification; it stays off until switched on.
- FR-7.5 Starting tracking without a connection is refused with a message.

### FR-8 Countdown notification
- FR-8.1 Ongoing, silent, low priority. On a counting day it shows "Day ends in" with a system-driven countdown to the deadline, plus tasks done and game time left.
- FR-8.2 On other days it shows the plain message. When offline with no status it says it will retry.
- FR-8.3 Tapping it opens the app.

### FR-9 Game-time nudges
| Condition | Result |
|---|---|
| Not a counting day, or pressure is "just show data" | never nudge |
| A game app (per the server's list) is not in the foreground | never nudge |
| Remaining is 0 and used is at least earned | "Game time is used up" (or "No game time left" when nothing was earned); repeats at most every 10 minutes |
| Remaining is 1 to 5 minutes | "N min of game time left", once per day |
| Pressure is "gentle" | same nudges, softer wording ("Your call.") |

### FR-10 Quick actions
- FR-10.1 "I'm up" logs the wake-up on the server and reports the result ("Already logged today.", "Up before your goal. +N XP", "Logged. +N XP").
- FR-10.2 Timers: choose one of ten kinds, start, stop. Starting a new one stops the running one (server rule). The chosen kind is remembered.
- FR-10.3 Two quick-settings tiles: **I'm up** and **Timer** (starts the remembered kind, or stops the running one). Tiles are unavailable before setup.
- FR-10.4 Actions fail with a readable message when not connected or when the server refuses.

## 4. Non-functional requirements
| Area | Requirement |
|---|---|
| Privacy | only app name, package id, session times, screen events and the player's own taps are sent, only to the configured server; no content of other apps |
| Security | token encrypted at rest; HTTPS-only in release; no secrets in logs |
| Offline | everything keeps working without a network; data is uploaded later in order |
| Battery | one sync a minute while tracking; no wake locks; work happens in short bursts |
| Responsiveness | no disk, network or SQLite work on the main thread |
| Accessibility | icons have descriptions, state is not conveyed by colour alone, text follows system font size, light and dark themes |
| Footprint | no third-party libraries beyond Compose, AndroidX lifecycle/activity and coroutines |
| Compatibility | Android 10 (API 29) and newer; targets API 35 |

## 5. Server contract used
| Call | Purpose |
|---|---|
| `POST /api/ingest/events` | upload usage and screen events (idempotent by key; a repeated key updates the length) |
| `GET /api/device/status` | day status, budget, wake, timer, game apps |
| `POST /api/device/wake` | log the wake-up |
| `POST /api/device/timers/start`, `/stop` | timers |

All use `Authorization: Bearer <device token>`.

## 6. Traceability
| Requirement | Verified by |
|---|---|
| FR-1.x | `LifeGameRepositoryTest` (save and keep token, refuse empty, saved but unreachable), `SetupViewModelTest` (save and test, failure, empty address); emulator |
| FR-2.1 to FR-2.6 | `SessionBuilderTest` (14 cases), `EventMapperTest` |
| FR-2.7 | emulator (checkpoint and open-session handling); not unit-tested |
| FR-2.8 | emulator (WhatsApp name); server test for old data |
| FR-3.x | `SyncEngineTest` (batches, keeps events when upload fails, replaces a queued key, readable errors), `HttpLifeGameApiTest` |
| FR-4.x | `StatusTest`, `FormatTest`, `SyncEngineTest` (keeps old status) |
| FR-5.x | `TodayViewModelTest`; visual check on emulator in light and dark |
| FR-6.x | `SetupViewModelTest` (permissions re-read, tracking switch, sync now); emulator |
| FR-7.x | emulator (service foreground, job scheduled); `SetupViewModelTest` (start failure) |
| FR-8.x | emulator (notification with countdown) |
| FR-9.x | `NudgerTest` (8 cases); emulator (nudge fired in a game app) |
| FR-10.x | `LifeGameRepositoryTest`, `TodayViewModelTest`, `HttpLifeGameApiTest`; emulator (both tiles) |

## 7. Not yet verified
Real-device behaviour on a Samsung phone (battery management, usage numbers over a day), HTTPS to a deployed server, TalkBack, very long offline periods, and the 100,000-event queue limit.
