#!/usr/bin/env bash
# Can this server reach everything CalSync and its deployment talk to? Run it on a new server
# before paying for a long term: hosting in Russia, Kazakhstan and elsewhere may block Telegram.
#   bash deploy/check-access.sh
# Any HTTP status counts as reachable (401/404 are normal here); a timeout does not.
set -u

hosts=(
  'https://api.telegram.org        Telegram Bot API (the bot)'
  'https://oauth2.googleapis.com   Google sign-in tokens'
  'https://www.googleapis.com      Google Calendar API'
  'https://docs.google.com         Google Sheets export'
  'https://api.deepseek.com        DeepSeek (sheet column mapping)'
  'https://calendar.yandex.ru      Yandex Calendar sources'
  'https://registry-1.docker.io/v2/ Docker Hub (base images)'
  'https://registry.npmjs.org      npm (image build)'
  'https://github.com              GitHub (git pull)'
)

failed=0
for entry in "${hosts[@]}"; do
  url=${entry%% *}
  name=${entry#* }
  status=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null) || status=000
  if [ "$status" = 000 ]; then
    printf 'FAIL  %-36s %s\n' "$url" "${name#"${name%%[! ]*}"}"
    failed=1
  else
    printf 'ok    %-36s %s (HTTP %s)\n' "$url" "${name#"${name%%[! ]*}"}" "$status"
  fi
done

if [ "$failed" = 1 ]; then
  echo
  echo 'Some services are unreachable from this server. Telegram failing means the bot cannot work here;'
  echo 'Docker Hub failing can be worked around with a registry mirror (README.md, "Если Docker Hub недоступен").'
  exit 1
fi
echo
echo 'Everything is reachable.'
