#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 22.04/24.04 server for CalSync. Run as root:
#   bash deploy/setup-server.sh
# Adds swap (the 1 GB plan needs it to build the image and run PostgreSQL next to Node.js),
# installs Docker Engine with the compose plugin from Docker's apt repository and closes every
# inbound port except SSH: CalSync needs none (long polling, OAuth through an SSH tunnel).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run as root (sudo bash deploy/setup-server.sh).' >&2
  exit 1
fi

echo '==> Swap'
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-calsync-swap.conf
sysctl -q --system

echo '==> Docker'
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo '==> Firewall: SSH only'
apt-get install -y ufw
ufw allow OpenSSH
ufw --force enable

echo
docker --version
docker compose version
swapon --show
echo 'Done. Next: deploy/.env (README.md, step 3).'
