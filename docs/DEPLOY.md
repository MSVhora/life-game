# Deploy (Docker Compose behind your existing nginx)

## Fastest: run the prebuilt image
GitHub Actions builds the image on every push to `main` (after the tests pass) and publishes it as `ghcr.io/<owner>/life-game` with the tags `latest`, a short commit id, and release versions (`1.2.0` for a `v1.2.0` tag). The server then needs no source code, only a compose file and a `.env`:
```bash
# 1. Settings: copy .env.example to .env and fill it in (see "Build from source" below for each value).
#    Admin password hash and push keys can be made with the image itself:
printf '%s\n' 'a password of 12+ characters' | docker run --rm -i ghcr.io/<owner>/life-game node dist/cli/hash-password.js --stdin
docker run --rm ghcr.io/<owner>/life-game node dist/cli/vapid.js
# 2. Run it (deploy/docker-compose.image.yml in this repo):
docker compose -f docker-compose.image.yml pull && docker compose -f docker-compose.image.yml up -d
# 3. Update later:
docker compose -f docker-compose.image.yml pull && docker compose -f docker-compose.image.yml up -d
```
The image contains the built-in default settings, so no `config/` folder is needed; add `config/*.local.yml` and mount it only to override defaults. If the package is private, run `docker login ghcr.io` with a token that has `read:packages` first.

## Build from source

Everything runs in two containers: `db` (Postgres, not exposed) and `app` (the API, bound to `127.0.0.1` only). Your nginx proxies HTTPS to the app.

## 1. First setup
```bash
git clone <your repo> life-game && cd life-game
cp .env.example .env            # then edit .env
```
In `.env` set:
- `PUBLIC_URL` to your https URL, `POSTGRES_PASSWORD` to a strong password.
- `SESSION_SECRET`: `openssl rand -hex 32`.
- `ADMIN_PASSWORD_HASH`: run `cd server && npm ci && npm run hash-password` and paste the printed line (the password is typed hidden, 12+ characters).
- `APP_PORT` if 3000 is already used on the server.

- Optional reminders: `cd server && npm run vapid`, paste the three `VAPID_*` lines into `.env`.
- Copy `config/player.example.yml` to `config/player.local.yml` (and `quests`, `clients`) and edit; the container reads `./config`. Everything can also be changed later in the app under Plan.

## 2. Start
```bash
docker compose up -d --build
curl -s http://127.0.0.1:3000/health     # {"status":"ok","db":true}
```
Migrations run automatically on start (`MIGRATE_ON_START=true`). The web app is served from the same address: open `https://life.<yourdomain>` on your phone, sign in, and use the browser menu to "Install app" / "Add to Home screen". A background job resolves each day at its deadline and sends the reminders.

- Optional freelance meter: set `TIMETRACKER_API_URL` (the API base, e.g. `https://time.yourdomain.tld/api`) and `TIMETRACKER_API_TOKEN` (a personal API token from your Solidtime profile; keep it only in `.env`). `TIMETRACKER_ORG_ID` is looked up if left empty. Copy `config/clients.example.yml` to `config/clients.local.yml` with your clients, rates and monthly caps. It matches Solidtime projects or clients by the name in `timetracker_project`.
- Mac tracking: see [AGENT.md](AGENT.md).

## 3. nginx and DNS
1. You point `life.<yourdomain>` at the server (DNS is yours to manage).
2. Copy `deploy/nginx.example.conf` to your nginx sites, change `server_name`, the certificate paths and the port, then get a certificate (e.g. `certbot --nginx -d life.<yourdomain>`).
3. `nginx -t && systemctl reload nginx`.

## 4. Device tokens
Log in once to create a device token (the token is shown once):
```bash
curl -c jar -X POST https://life.<yourdomain>/api/auth/login \
  -H 'content-type: application/json' -d '{"password":"<your admin password>"}'
curl -b jar -X POST https://life.<yourdomain>/api/devices \
  -H 'content-type: application/json' -d '{"name":"My Mac","kind":"mac"}'
```
Revoke with `DELETE /api/devices/<id>`. Tokens are stored only as hashes.

## 5. Backups to Google Drive
1. Install and configure rclone with a Drive remote (`rclone config`), e.g. `gdrive`.
2. Set `BACKUP_TARGET=gdrive:life-game-backups` in `.env`.
3. Run `scripts/backup.sh` once by hand, then add a nightly cron:
```cron
15 3 * * *  cd /path/to/life-game && scripts/backup.sh >> backup.log 2>&1
```
Backups are a plain gzipped `pg_dump`, kept for `BACKUP_KEEP_DAYS` days.

Restore (destroys current data):
```bash
scripts/restore.sh life-game-<timestamp>.sql.gz
```
Do a restore drill once on a spare database before relying on it.

## 6. Updating
```bash
git pull && docker compose up -d --build
```

## Local development
```bash
docker run -d --name lg-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=lifetest -p 54329:5432 postgres:16-alpine
cd server && npm ci
TEST_DATABASE_URL=postgres://postgres:test@localhost:54329/lifetest npm test
git config core.hooksPath .githooks     # enables the secret scan before each commit
```
