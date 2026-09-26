#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

NO_BUILD=0
EXPECTED_REVISION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) NO_BUILD=1; shift ;;
    --revision)
      [[ $# -ge 2 && "$2" =~ ^[0-9a-f]{40}$ ]] || {
        echo "--revision requires a full Git commit SHA." >&2; exit 1;
      }
      EXPECTED_REVISION="$2"; shift 2 ;;
    *) echo "Unknown deployment option: $1" >&2; exit 1 ;;
  esac
done

# Deploy the selected checkout. Never advance it while choosing images/migrations.
if [[ -n "${EXPECTED_REVISION}" ]]; then
  [[ "$(git rev-parse HEAD)" == "${EXPECTED_REVISION}" ]] || {
    echo "Deployment checkout does not match the requested revision." >&2; exit 1;
  }
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || {
    echo "Deployment checkout contains tracked changes." >&2; exit 1;
  }
fi

[[ -f .env ]] || {
  echo "Missing .env. Copy .env.example to .env and set production values."
  exit 1
}

# shellcheck disable=SC1091
source scripts/load-env.sh .env
source scripts/deployment-compose.sh

# Normal deliveries always use the API revision for the independent watcher.
export OPERATIONS_IMAGE="${API_IMAGE:-openg7-funding-api:local}"
if [[ "${FUNDING_OPERATIONS_WATCHER_ENABLED:-false}" == true ]]; then
  OPERATIONS_SECRET="${FUNDING_OPERATIONS_WEBHOOK_SECRET:-}"
  [[ -n "${DATABASE_URL:-}" && -n "${FUNDING_OPERATIONS_WEBHOOK_URL:-}" && ${#OPERATIONS_SECRET} -ge 32 ]] || {
    echo 'Configure the database and signed receiver before enabling operations.' >&2; exit 1;
  }
fi

if [[ "${NO_BUILD}" -eq 1 && -n "${EXPECTED_REVISION}" ]]; then
  for deployment_image in "${WEB_IMAGE:-}" "${API_IMAGE:-}"; do
    [[ "${deployment_image}" == *":${EXPECTED_REVISION}" ]] || {
      echo "Deployment images must match the requested revision." >&2; exit 1;
    }
  done
fi

APP_DOMAIN="${APP_DOMAIN:-openg7.org}"
ROLLBACK_WEB_IMAGE="openg7-funding-web:rollback"
ROLLBACK_API_IMAGE="openg7-funding-api:rollback"
ROLLBACK_OPERATIONS_IMAGE="openg7-funding-operations:rollback"
ROLLBACK_READY=0

migrate_database() {
  if [[ "${FUNDING_OPERATIONS_WATCHER_ENABLED:-false}" == true ]]; then
    compose run --rm --no-deps --entrypoint node operations --input-type=module -e 'import { operationsAlertConfig } from "./dist/apps/funding-api/src/operations-alerts.js"; if (!operationsAlertConfig(process.env)) process.exit(1);'
  fi
  if [[ -n "${DATABASE_URL:-}" ]]; then
    bash scripts/db-migrate.sh
  fi
}

rollback() {
  echo "Deployment failed. Attempting rollback..."
  if [[ "${ROLLBACK_READY}" -eq 1 ]]; then
    bash scripts/rollback.sh || echo 'Rollback failed; inspect the stopped/unhealthy services.' >&2
  else
    echo "No rollback images were available."
  fi
}

trap rollback ERR

mkdir -p traefik/acme backups
touch traefik/acme/acme.json
chmod 600 traefik/acme/acme.json

CURRENT_WEB="$(compose images -q web | head -n1)"
CURRENT_API="$(compose images -q api | head -n1)"
CURRENT_OPERATIONS=""
RUNNING_SERVICES="$(docker compose -f docker-compose.yml -f docker-compose.operations.yml ps --services --filter status=running)"
if grep -qx operations <<< "$RUNNING_SERVICES"; then
  CURRENT_OPERATIONS="$(docker compose -f docker-compose.yml -f docker-compose.operations.yml images -q operations | head -n1)"
  [[ -n "$CURRENT_OPERATIONS" ]] || { echo 'Cannot identify the running operations image.' >&2; exit 1; }
fi
# An existing worker must never be silently orphaned by a delivery without its overlay.
if [[ -n "${CURRENT_OPERATIONS}" && "${FUNDING_OPERATIONS_WATCHER_ENABLED:-false}" != true ]]; then
  echo 'An operations container is running. Enable its delivery switch or explicitly stop it before deployment.' >&2
  exit 1
fi

if [[ -n "${CURRENT_WEB}" ]]; then
  docker tag "${CURRENT_WEB}" "${ROLLBACK_WEB_IMAGE}"
fi

if [[ -n "${CURRENT_API}" ]]; then
  docker tag "${CURRENT_API}" "${ROLLBACK_API_IMAGE}"
fi
if [[ -n "${CURRENT_OPERATIONS}" ]]; then
  docker tag "${CURRENT_OPERATIONS}" "${ROLLBACK_OPERATIONS_IMAGE}"
fi
if [[ -n "${CURRENT_WEB}" && -n "${CURRENT_API}" ]]; then
  (umask 077; printf '%s\n' "ROLLBACK_OPERATIONS_ENABLED=$([[ -n "${CURRENT_OPERATIONS}" ]] && echo true || echo false)" > backups/deployment-rollback.env.tmp)
  mv backups/deployment-rollback.env.tmp backups/deployment-rollback.env
  ROLLBACK_READY=1
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
