# Mac tracking: ActivityWatch and the sync agent

What you get: the app learns what you do on your Mac (apps, sites, work-folder activity) with no input from you, and shows it under **Insights**. Nothing leaves your machine except what is listed under "What is sent".

```
ActivityWatch (on the Mac)  ->  sync agent (this repo, agent/)  ->  your server  ->  Insights
        work folders, CSVs, git  ---------------^
```

## 1. Install ActivityWatch
1. Download it from activitywatch.net and start it. It runs a local server at `http://localhost:5600` and, by default, two watchers: **window** (active app) and **afk** (idle or not).
2. macOS will ask for permissions for ActivityWatch (for example Accessibility). Allow them, otherwise window tracking stays empty.
3. Check `http://localhost:5600` in a browser: you should see your own activity after a few minutes.

## 2. Browser extension (Chrome and Arc)
Install the **ActivityWatch web watcher** extension in each browser you use for work (Chrome, Arc; both accept Chrome extensions). Without it the app only knows "Chrome was open", not which site. Safari is not covered.

## 3. Connect the agent to your server
1. In the app: **More > Connect a device > Connect a Mac**. Copy the commands it shows (the token appears once).
2. Copy `config/sources.example.yml` to `config/sources.local.yml` and edit the folders, CSV files and job-site domains.
3. Build and test it once:
```bash
cd agent && npm ci && npm run build
LIFE_GAME_URL=https://life.yourdomain.tld LIFE_GAME_CONFIG_DIR=../config node dist/index.js --once
```
You should see `sent N events from 3 buckets`. The app's device list then shows "last data just now".

## 4. Run it in the background
```bash
cp agent/launchd/com.lifegame.agent.plist.example ~/Library/LaunchAgents/com.lifegame.agent.plist
# edit the paths and URL inside, then:
launchctl load ~/Library/LaunchAgents/com.lifegame.agent.plist
tail -f ~/.life-game-agent/agent.log
```
It syncs every minute. If the server or ActivityWatch is down it backs off and catches up later: ActivityWatch keeps its own history, so nothing is lost.

## What is sent
| Data | Sent | Not sent |
|---|---|---|
| Active app | app name, start time, duration | window titles (unless `send_titles: true`) |
| Idle time | afk or not, duration | |
| Sites | domain, duration | page titles; full address only for `full_url_domains`; private windows appear as "(private)" |
| Work folders | "files changed" times and counts | file names, contents, anything matching the ignore list (.env, keys, .git, node_modules) |
| CSV files | number of rows | the rows themselves |
| Git | commit times and counts | messages, diffs |

Your token lives in `~/.life-game-agent/token` (owner-only). The agent never reads `.env` files or other secrets.

## Labelling
New apps and sites appear under **Insights > Label these**. Pick Productive, Neutral, Waste, Gaming or Leisure; all past days are re-sorted. Starting points can also go in `config/categories.local.json`.

## Troubleshooting
| Symptom | Check |
|---|---|
| "ActivityWatch is not reachable" | Is ActivityWatch running? Is `AW_URL` or `activitywatch.url` right? |
| "The server refused the device token" | The device was revoked or the token is wrong. Create a new one in the app. |
| Sites missing | The browser extension is not installed or is disabled in that browser. |
| Everything is "Not labelled yet" | Expected at first: label the top few apps. |
| Time looks too low | The Mac was asleep, or macOS permissions for ActivityWatch are missing. |

## Not yet verified
This was built against ActivityWatch's documented API and tested with a stand-in server. It has not yet run against a real ActivityWatch install, the browser extension, or launchd on your Mac. Run step 3 first and tell me what you see.
