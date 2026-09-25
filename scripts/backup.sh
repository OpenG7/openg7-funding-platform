#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
command -v node >/dev/null || { echo 'Node 22 is required for backup integrity metadata.' >&2; exit 1; }
docker_path() { if command -v cygpath >/dev/null; then cygpath -am "$1"; else printf '%s' "$1"; fi; }
docker() { MSYS_NO_PATHCONV=1 command docker "$@"; }

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source scripts/load-env.sh .env
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR}/openg7-backup-${STAMP}.tar.gz"
POSTGRES_DUMP_DEST="${BACKUP_DIR}/openg7-funding-db-${STAMP}.sql"
POSTGRES_DUMP_TMP="${POSTGRES_DUMP_DEST}.tmp"
SPONSOR_LOGOS_VOLUME_NAME="${SPONSOR_LOGOS_VOLUME_NAME:-openg7-sponsor-logos}"
SPONSOR_LOGOS_DEST="${BACKUP_DIR}/openg7-sponsor-logos-${STAMP}.tar.gz"
SPONSOR_LOGOS_TMP="${SPONSOR_LOGOS_DEST}.tmp"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
BACKUP_DIR_ABS="$(cd "${BACKUP_DIR}" && pwd)"
mkdir "${BACKUP_DIR}/.backup.lock" 2>/dev/null || { echo 'A backup is already running.' >&2; exit 1; }
trap 'rm -f -- "${DEST}.tmp" "${POSTGRES_DUMP_TMP}" "${SPONSOR_LOGOS_TMP}"; rmdir "${BACKUP_DIR}/.backup.lock"' EXIT
[[ ! -e "$DEST" ]] || { echo 'Backup timestamp already exists; retry later.' >&2; exit 1; }

tar \
  --exclude="./backups" \
  --exclude="./node_modules" \
  --exclude="./dist" \
  --exclude="./.git" \
  -czf "${DEST}.tmp" \
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

mv "${DEST}.tmp" "${DEST}"
chmod 600 "${DEST}"
echo "Configuration backup written to ${DEST}"

if command -v docker >/dev/null 2>&1 &&
  docker volume inspect "${SPONSOR_LOGOS_VOLUME_NAME}" >/dev/null 2>&1; then
  rm -f "${SPONSOR_LOGOS_TMP}"
  docker run --rm \
    -e HOST_UID="$(id -u)" \
    -e HOST_GID="$(id -g)" \
    -v "${SPONSOR_LOGOS_VOLUME_NAME}:/volume:ro" \
    -v "$(docker_path "${BACKUP_DIR_ABS}"):/backup" \
    --entrypoint sh postgres:16-alpine \
    -c 'umask 077; cd /volume; tar -czf "/backup/$1" . && chown "${HOST_UID}:${HOST_GID}" "/backup/$1"' \
    sh "$(basename "${SPONSOR_LOGOS_TMP}")"

  chmod 600 "${SPONSOR_LOGOS_TMP}"
  mv "${SPONSOR_LOGOS_TMP}" "${SPONSOR_LOGOS_DEST}"
  echo "Sponsor logo volume backup written to ${SPONSOR_LOGOS_DEST}"
else
  if [[ "${SPONSOR_MEDIA_STORAGE_DRIVER:-local}" == local ]]; then
    echo 'Local media volume is missing; backup set is incomplete.' >&2
    exit 1
  fi
  echo "Sponsor logo volume ${SPONSOR_LOGOS_VOLUME_NAME} was not found. Logo backup skipped."
fi

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

node scripts/backup-artifacts.mjs manifest "$DEST" \
  "$(if [[ -f "$POSTGRES_DUMP_DEST" ]]; then printf '%s' "$POSTGRES_DUMP_DEST"; else printf '%s' '-'; fi)" \
  "$(if [[ -f "$SPONSOR_LOGOS_DEST" ]]; then printf '%s' "$SPONSOR_LOGOS_DEST"; else printf '%s' '-'; fi)" \
  "${SPONSOR_MEDIA_STORAGE_DRIVER:-local}"
echo 'Backup set complete; integrity manifest written.'
