#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

NO_BUILD=0
if [[ "${1:-}" == "--no-build" ]]; then
  NO_BUILD=1
fi

[[ -f .env ]] || {
  echo "Missing .env. Copy .env.example to .env and set production values."
  exit 1
}

# shellcheck disable=SC1091
source scripts/load-env.sh .env

APP_DOMAIN="${APP_DOMAIN:-openg7.org}"
ROLLBACK_WEB_IMAGE="openg7-funding-web:rollback"
ROLLBACK_API_IMAGE="openg7-funding-api:rollback"

compose() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    docker compose --profile database "$@"
  else
    docker compose "$@"
  fi
}

migrate_database() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    bash scripts/db-migrate.sh
  fi
}

rollback() {
  echo "Deployment failed. Attempting rollback..."
  if docker image inspect "${ROLLBACK_WEB_IMAGE}" >/dev/null 2>&1 && docker image inspect "${ROLLBACK_API_IMAGE}" >/dev/null 2>&1; then
    WEB_IMAGE="${ROLLBACK_WEB_IMAGE}" API_IMAGE="${ROLLBACK_API_IMAGE}" compose up -d --no-build
    bash scripts/check.sh || true
    echo "Rollback attempted."
  else
    echo "No rollback images were available."
  fi
}

trap rollback ERR

mkdir -p traefik/acme backups
touch traefik/acme/acme.json
chmod 600 traefik/acme/acme.json

CURRENT_WEB="$(compose images -q web 2>/dev/null | head -n1 || true)"
CURRENT_API="$(compose images -q api 2>/dev/null | head -n1 || true)"

if [[ -n "${CURRENT_WEB}" ]]; then
  docker tag "${CURRENT_WEB}" "${ROLLBACK_WEB_IMAGE}" || true
fi

if [[ -n "${CURRENT_API}" ]]; then
  docker tag "${CURRENT_API}" "${ROLLBACK_API_IMAGE}" || true
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git pull --ff-only
fi

if [[ "${NO_BUILD}" -eq 1 ]]; then
  compose pull
  migrate_database
  compose up -d --no-build
else
  corepack yarn install --immutable
  corepack yarn build
  corepack yarn workspace @openg7/funding-web build
  compose build --pull
  migrate_database
  compose up -d
fi

bash scripts/check.sh
echo "Deployment succeeded for https://${APP_DOMAIN}"

trap - ERR
