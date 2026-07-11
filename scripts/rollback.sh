#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

[[ -f .env ]] || {
  echo "Missing .env. Copy .env.example to .env and set production values."
  exit 1
}

# shellcheck disable=SC1091
source scripts/load-env.sh .env

APP_DOMAIN="${APP_DOMAIN:-openg7.org}"
ROLLBACK_WEB_IMAGE="openg7-funding-web:rollback"
ROLLBACK_API_IMAGE="openg7-funding-api:rollback"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed."
docker compose version >/dev/null 2>&1 ||
  fail "docker compose plugin is not installed."

docker image inspect "${ROLLBACK_WEB_IMAGE}" >/dev/null 2>&1 ||
  fail "Rollback web image not found: ${ROLLBACK_WEB_IMAGE}"
docker image inspect "${ROLLBACK_API_IMAGE}" >/dev/null 2>&1 ||
  fail "Rollback API image not found: ${ROLLBACK_API_IMAGE}"

echo "Rolling back to previous application images."
echo "Web: ${ROLLBACK_WEB_IMAGE}"
echo "API: ${ROLLBACK_API_IMAGE}"

WEB_IMAGE="${ROLLBACK_WEB_IMAGE}" \
  API_IMAGE="${ROLLBACK_API_IMAGE}" \
  docker compose up -d --no-build

bash scripts/check.sh
echo "Rollback succeeded for https://${APP_DOMAIN}"
