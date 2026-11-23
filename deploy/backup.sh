#!/usr/bin/env bash
# Dumps the CalSync database to deploy/backups/ and keeps 14 days of dumps. Daily, as root:
#   crontab -e
#   30 3 * * * /opt/calsync/deploy/backup.sh >> /var/log/calsync-backup.log 2>&1
# The dumps hold OAuth tokens and source URLs encrypted with ENCRYPTION_KEY: restoring one needs
# that key, so keep a copy of deploy/.env somewhere safe as well.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p backups
chmod 700 backups
file="backups/calsync-$(date -u +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres pg_dump -U calsync -Fc calsync > "$file"
find backups -name 'calsync-*.dump' -mtime +14 -delete
echo "$(date -u +%FT%TZ) $file $(du -h "$file" | cut -f1)"
