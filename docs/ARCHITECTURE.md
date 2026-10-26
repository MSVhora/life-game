# Architecture

## 1. System context
```mermaid
flowchart LR
  subgraph Phone["Android phone"]
    APP["Companion app (Kotlin)\nusage stats, unlock/wake,\nnotifications, quick tile"]
    PWA1["PWA (game UI + routine buttons)"]
  end
  subgraph Mac["Mac"]
    AW["ActivityWatch\napps + AFK + browser ext"]
    AGENT["Sync agent (launchd)"]
    JS["work folders\n(git, CSV, prep/)"]
    PWA2["Browser (game UI)"]
  end
  KOBO["Kobo e-reader\n(manual start/stop only)"]
  subgraph Srv["Your private server"]
    API["Game API + Web UI"]
    DB[("Database")]
    ST["Solidtime"]
    BK["Backup job"]
  end
  GD["Google Drive\n(pg_dump backups)"]
  APP -- "HTTPS + token (batched, offline queue)" --> API
  PWA1 --> API
  PWA2 --> API
  AW --> AGENT
  JS --> AGENT
  KOBO -. "manual timer on phone" .-> PWA1
  AGENT -- "HTTPS + token" --> API
  ST -- "API (read time entries)" --> API
  API --> DB
  BK --> DB
  BK --> GD
  API -- "push notifications" --> APP
```

## 2. Data flow (sensor to score)
```mermaid
flowchart LR
  E["Raw events\n(app, site, screen, files, git, solidtime, kobo)"] --> N["Normalize + dedupe\n(immutable, server timestamps)"]
  N --> R["Rules engine\napp/site -> Productive | Neutral | Waste"]
  M["Manual timers\nwake, wash, bath, lunch, dinner, sleep, kobo"] --> X["Cross-check\nvs sensors"]
  R --> TB["Time blocks"]
  X --> TB
  TB --> U["Unaccounted gaps -> Waste"]
  EV["Marker matcher\n(CSV rows, commits, URLs, active time)"] --> W["Day engine\nquests, tasks, deadline"]
  TB --> W
  W --> G["Game state\nXP, streak, rank, reputation,\ngaming budget, money meter"]
  G --> UI["PWA + scoreboard"]
  G --> NO["Reminders (6h/2h/30m), budget alerts"]
```

## 3. Server components
```mermaid
flowchart TB
  subgraph Server
    AUTH["Auth (login + device tokens)"]
    ING["Ingest API\n(/events, /timers, idempotent)"]
    RUL["Rules engine\n(categories.json, hot-reload)"]
    DAY["Day scheduler\n(deal quests, deadlines, win/lose)"]
    VER["Marker matcher"]
    ECO["Economy\nXP, budget, reputation, loot"]
    SOL["Solidtime connector\n(poll + cap tracking)"]
    NOTI["Notifier (web push / FCM)"]
    REP["Reports (daily, weekly)"]
    BAK["Backup job (pg_dump -> Drive)"]
  end
  DB[("Database")]
  ING --> RUL --> DB
  DAY --> DB
  VER --> DAY
  ECO --> DB
  SOL --> DB
  NOTI --- DAY
  REP --> DB
  BAK --> DB
  AUTH --- ING
```

## 4. Data model
```mermaid
erDiagram
  DEVICE ||--o{ EVENT : sends
  EVENT }o--|| CATEGORY_RULE : "classified by"
  EVENT ||--o{ TIME_BLOCK : "rolls up to"
  DAY ||--|{ TASK : contains
  TASK ||--o{ EVIDENCE : "proven by"
  QUEST_TEMPLATE ||--o{ TASK : generates
  DAY ||--|| BUDGET_DAY : earns
  PLAYER ||--o{ DAY : plays
  PLAYER ||--o{ XP_LEDGER : has
  PLAYER ||--o{ ADJUSTMENT : "corrections (cost XP)"
  CLIENT ||--o{ FREELANCE_ENTRY : bills
  EVENT {
    string source
    string kind
    json payload
    datetime ts
  }
  TIME_BLOCK {
    datetime start
    datetime end
    string category
    string source
  }
  TASK {
    string title
    string status
    int xp
    int minutes_earned
  }
  EVIDENCE {
    string type
    string ref
    bool is_manual_tick
  }
```

## 5. Daily cycle lifecycle
```mermaid
sequenceDiagram
  participant S as Day scheduler
  participant P as You (phone/Mac)
  participant V as Marker matcher
  participant E as Economy
  S->>P: Day starts, 2 tasks dealt (from your work-folder files)
  S->>P: Reminders at 6h, 2h, 30m left
  P->>V: Activity (CSV row, commit, URL, active time)
  V->>S: Marker found (or none: player can tick manually)
  S->>E: Tasks done before deadline?
  alt Both tasks done
    E->>P: WIN: streak+1, XP, gaming minutes unlocked, reputation up
  else Missed
    E->>P: LOSS: streak reset, rank down, budget halved, scoreboard red
  end
```

## 6. Sync with offline catch-up
```mermaid
sequenceDiagram
  participant D as Device (Mac agent / Android app)
  participant Q as Local queue/checkpoint
  participant API as Server
  D->>Q: Store events + last checkpoint
  loop every ~1 min (Mac) / WorkManager (Android)
    D->>API: POST batch (idempotency keys)
    alt online
      API-->>D: ack up to checkpoint
    else offline / Mac asleep
      D->>Q: keep queue, retry later
    end
  end
```

## 7. How data is collected per device
| Device | Method | Notes |
|---|---|---|
| Mac | ActivityWatch REST (`/api/0/buckets`, `/api/0/buckets/<id>/events`) read by a `launchd` agent, checkpoint per bucket | Needs macOS Accessibility (and maybe Screen Recording) permission for window titles |
| Mac browser | ActivityWatch web watcher extension | Chrome-family and Firefox supported; Safari needs checking |
| Android | Own Kotlin app: `UsageStatsManager` + screen/unlock broadcasts, uploaded by WorkManager | One-time "Usage access" grant; battery-optimisation exemption recommended |
| E-reader | Manual start/stop timer on the phone | No data import |
| Solidtime | Server polls its API | Token set by you in server config |
| work-folder | Agent watches `git log` and the CSV/prep files, ignores `.env` | Mac only, so evidence arrives when the Mac is on |

## 8. Security and privacy
- HTTPS only; single user login plus per-device revocable tokens.
- All data on your server; plain `pg_dump` backups uploaded to your personal Google Drive.
- No secrets in the sync agent; file watcher ignores `.env`, keys and credential files.
- Browser tracking stores domain and page title by default; full URLs are optional (see Doubts file).
