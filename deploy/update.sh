#!/usr/bin/env bash
# Brings the server to the latest main: compose files and scripts from git, the images CI pushed
# to ghcr.io, pending migrations (the migrate service), a restart, then waits for /health.
# CI runs it over SSH as the forced command of its deploy key (README.md, "Автообновление из
# GitHub"); it can also be run by hand: /opt/calsync/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Over SSH the client's command is only the commit CI deploys, kept for the log.
commit=${SSH_ORIGINAL_COMMAND:-${1:-}}
[[ $commit =~ ^[0-9a-f]{7,40}$ ]] || commit=''
echo "==> $(date -u +%FT%TZ) updating CalSync${commit:+ for ${commit:0:7}}"

git fetch --quiet origin main
git merge --ff-only --quiet origin/main
echo "checkout: $(git log --oneline -1)"

cd deploy
docker compose pull --quiet migrate app
docker compose up -d --remove-orphans
docker image prune --force > /dev/null

for _ in $(seq 1 45); do
  if curl -fsS -m 3 http://127.0.0.1:3100/health > /dev/null 2>&1; then
    echo "==> CalSync is healthy"
    exit 0
  fi
  sleep 2
done
echo "==> CalSync did not become healthy in 90 s" >&2
docker compose ps -a >&2
docker compose logs --tail 60 app >&2
exit 1
