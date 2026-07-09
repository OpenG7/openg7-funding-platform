#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

CONFIG_BACKUP=""
DATABASE_DUMP=""
FORCE=0
RUN_CHECK=1
POSTGRES_VOLUME_NAME="${POSTGRES_VOLUME_NAME:-openg7-postgres-data}"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/restore-from-backup.sh \
    --config-backup /path/to/openg7-backup-YYYYMMDDTHHMMSSZ.tar.gz \
    --database-dump /path/to/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql

Options:
  --force       Skip the interactive destructive confirmation.
  --skip-check  Do not run scripts/check.sh after restore.
  --help        Show this help message.

This restores the application configuration, removes the local PostgreSQL Docker
volume, recreates PostgreSQL, imports the pg_dump file, starts the stack, then
runs the production check script unless --skip-check is provided.
USAGE
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-backup)
      [[ $# -ge 2 ]] || fail "--config-backup requires a path."
      CONFIG_BACKUP="${2:-}"
      shift 2
      ;;
    --database-dump)
      [[ $# -ge 2 ]] || fail "--database-dump requires a path."
      DATABASE_DUMP="${2:-}"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --skip-check)
      RUN_CHECK=0
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

[[ -n "${CONFIG_BACKUP}" ]] || fail "Missing --config-backup path."
[[ -n "${DATABASE_DUMP}" ]] || fail "Missing --database-dump path."
[[ -f "${CONFIG_BACKUP}" ]] || fail "Config backup not found: ${CONFIG_BACKUP}"
[[ -f "${DATABASE_DUMP}" ]] || fail "Database dump not found: ${DATABASE_DUMP}"

command -v tar >/dev/null 2>&1 || fail "tar is not installed."
command -v docker >/dev/null 2>&1 || fail "docker is not installed."
docker compose version >/dev/null 2>&1 || fail "docker compose plugin is not installed."

tar -tzf "${CONFIG_BACKUP}" >/dev/null
tar -tzf "${CONFIG_BACKUP}" | grep -Eq '(^|/)docker-compose\.yml$' ||
  fail "Config backup does not look like an OpenG7 deployment archive."

if [[ "${FORCE}" -ne 1 ]]; then
  cat <<WARNING
WARNING: this will stop the Docker stack and remove the PostgreSQL volume:
  ${POSTGRES_VOLUME_NAME}

The database will be recreated from:
  ${DATABASE_DUMP}

Type RESTORE OPENG7 to continue.
WARNING

  read -r CONFIRMATION
  [[ "${CONFIRMATION}" == "RESTORE OPENG7" ]] ||
    fail "Restore cancelled."
fi

echo "Restoring configuration from ${CONFIG_BACKUP}"
tar -xzf "${CONFIG_BACKUP}" -C "${ROOT_DIR}"

[[ -f .env ]] || fail "Restored backup did not include .env."
chmod 600 .env
if [[ -f traefik/acme/acme.json ]]; then
  chmod 600 traefik/acme/acme.json
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

[[ -n "${DATABASE_URL:-}" ]] ||
  fail "Restored .env has no DATABASE_URL. PostgreSQL restore would not be used by the API."

POSTGRES_DB="${POSTGRES_DB:-openg7_funding}"
POSTGRES_USER="${POSTGRES_USER:-openg7_funding}"

echo "Stopping Docker stack."
docker compose down

if docker volume inspect "${POSTGRES_VOLUME_NAME}" >/dev/null 2>&1; then
  echo "Removing PostgreSQL volume ${POSTGRES_VOLUME_NAME}."
  docker volume rm "${POSTGRES_VOLUME_NAME}"
else
  echo "PostgreSQL volume ${POSTGRES_VOLUME_NAME} does not exist yet."
fi

echo "Starting a clean PostgreSQL service."
docker compose --profile database up -d postgres

echo "Waiting for PostgreSQL to become ready."
for _ in $(seq 1 60); do
  if docker compose --profile database exec -T postgres \
    pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    break
  fi

  sleep 2
done

docker compose --profile database exec -T postgres \
  pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null ||
  fail "PostgreSQL did not become ready."

echo "Importing database dump from ${DATABASE_DUMP}"
docker compose --profile database exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  < "${DATABASE_DUMP}"

echo "Starting full Docker stack."
docker compose --profile database up -d

if [[ "${RUN_CHECK}" -eq 1 ]]; then
  bash scripts/check.sh
fi

echo "Restore completed."
