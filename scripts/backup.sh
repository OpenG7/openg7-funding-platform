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
POSTGRES_DUMP_DEST="${BACKUP_DIR}/openg7-funding-db-${STAMP}.sql"
POSTGRES_DUMP_TMP="${POSTGRES_DUMP_DEST}.tmp"

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
echo "Configuration backup written to ${DEST}"

if [[ -n "${DATABASE_URL:-}" ]]; then
  POSTGRES_DB="${POSTGRES_DB:-openg7_funding}"
  POSTGRES_USER="${POSTGRES_USER:-openg7_funding}"

  if ! docker compose --profile database ps --services --filter status=running | grep -qx "postgres"; then
    echo "DATABASE_URL is set, but the postgres service is not running. Database dump skipped." >&2
    exit 1
  fi

  rm -f "${POSTGRES_DUMP_TMP}"
  docker compose --profile database exec -T postgres \
    pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
    > "${POSTGRES_DUMP_TMP}"

  chmod 600 "${POSTGRES_DUMP_TMP}"
  mv "${POSTGRES_DUMP_TMP}" "${POSTGRES_DUMP_DEST}"
  echo "Database dump written to ${POSTGRES_DUMP_DEST}"
fi
