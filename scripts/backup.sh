#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR}/openg7-backup-${STAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

tar \
  --exclude="./backups" \
  --exclude="./node_modules" \
  --exclude="./dist" \
  --exclude="./.git" \
  -czf "${DEST}" \
  docker-compose.yml \
  .env \
  .env.example \
  .dockerignore \
  apps/funding-api/Dockerfile \
  apps/funding-web/Dockerfile \
  apps/funding-web/nginx.conf \
  traefik \
  scripts \
  docs

chmod 600 "${DEST}"
echo "Backup written to ${DEST}"
