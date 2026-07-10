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

POSTGRES_DB="${POSTGRES_DB:-openg7_funding}"
POSTGRES_USER="${POSTGRES_USER:-openg7_funding}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-apps/funding-api/migrations}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed."
docker compose version >/dev/null 2>&1 || fail "docker compose plugin is not installed."
[[ -d "${MIGRATIONS_DIR}" ]] || fail "Migrations directory not found: ${MIGRATIONS_DIR}"

echo "Starting PostgreSQL service."
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

migration_count=0
while IFS= read -r migration; do
  migration_count=$((migration_count + 1))
  echo "Applying ${migration}"
  docker compose --profile database exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
    < "${migration}"
done < <(find "${MIGRATIONS_DIR}" -maxdepth 1 -type f -name "*.sql" | sort)

[[ "${migration_count}" -gt 0 ]] || fail "No SQL migrations found in ${MIGRATIONS_DIR}."

echo "Database migrations completed."
