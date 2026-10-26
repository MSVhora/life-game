# Deploy (Docker Compose behind your existing nginx)

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

## 2. Start
```bash
docker compose up -d --build
curl -s http://127.0.0.1:3000/health     # {"status":"ok","db":true}
```
Migrations run automatically on start (`MIGRATE_ON_START=true`).

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
