#!/usr/bin/env bash
# Blocks commits that contain personal/secret files or token-like strings.
# Default: checks staged files. With --all: checks every tracked file (used in CI).
set -uo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--all" ]; then
  files="$(git ls-files)"
else
  files="$(git diff --cached --name-only --diff-filter=ACMR)"
fi
[ -n "$files" ] || exit 0

fail=0
report() { echo "BLOCKED: $1" >&2; fail=1; }

# 1. Files that must never be tracked.
while IFS= read -r f; do
  case "$f" in
    .env|.env.*|*/.env|*/.env.*)
      [ "$(basename "$f")" = ".env.example" ] || report "$f (environment file)";;
    private/*) report "$f (private folder)";;
    config/*.local.*) report "$f (personal config)";;
    *.pem|*.key|*id_rsa*|*id_ed25519*) report "$f (key material)";;
  esac
done <<< "$files"

# 2. Token-like content in the files themselves.
patterns=(
  'lg_[A-Za-z0-9_-]{40,}'                          # this app's device tokens
  'scrypt:[0-9]+:[0-9]+:[0-9]+:[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{40,}'  # real password hashes
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'AKIA[0-9A-Z]{16}'                               # AWS access key id
  'gh[pousr]_[A-Za-z0-9]{36,}'                     # GitHub tokens
  'sk-[A-Za-z0-9_-]{32,}'                          # API-style secret keys
)
while IFS= read -r f; do
  [ -f "$f" ] || continue
  # Skip this script and the tests (they contain pattern examples).
  case "$f" in scripts/check-secrets.sh|server/test/*) continue;; esac
  for p in "${patterns[@]}"; do
    if grep -IEq -- "$p" "$f"; then report "$f matches secret pattern: $p"; fi
  done
done <<< "$files"

[ "$fail" -eq 0 ] || { echo "Commit blocked. Move secrets to .env / *.local.* (gitignored)." >&2; exit 1; }
