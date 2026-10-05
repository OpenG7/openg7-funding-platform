#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

EXPECTED_REVISION=""
if [[ $# -gt 0 ]]; then
  [[ $# -eq 2 && "$1" == --revision && "$2" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Rollback accepts only --revision followed by a full Git commit SHA.' >&2; exit 1;
  }
  EXPECTED_REVISION="$2"
fi

[[ -f .env ]] || {
  echo "Missing .env. Copy .env.example to .env and set production values."
  exit 1
}

# shellcheck disable=SC1091
source scripts/load-env.sh .env
source scripts/deployment-compose.sh
source scripts/deployment-image-revision.sh

APP_DOMAIN="${APP_DOMAIN:-openg7.org}"
ROLLBACK_WEB_IMAGE="openg7-funding-web:rollback"
ROLLBACK_API_IMAGE="openg7-funding-api:rollback"
ROLLBACK_OPERATIONS_IMAGE="openg7-funding-operations:rollback"

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

PREVIOUS_OPERATIONS=false
if [[ -f backups/deployment-rollback.env ]]; then
  case "$(cat backups/deployment-rollback.env)" in
    ROLLBACK_OPERATIONS_ENABLED=true) PREVIOUS_OPERATIONS=true ;;
    ROLLBACK_OPERATIONS_ENABLED=false) PREVIOUS_OPERATIONS=false ;;
    *) fail 'Invalid rollback state.' ;;
  esac
elif [[ "${FUNDING_OPERATIONS_WATCHER_ENABLED:-false}" == true ]]; then
  fail 'Missing rollback state for the operations watcher.'
fi
if [[ "${PREVIOUS_OPERATIONS}" == true ]]; then
  docker image inspect "${ROLLBACK_OPERATIONS_IMAGE}" >/dev/null 2>&1 || fail 'Rollback operations image not found.'
fi

VERIFIED_REVISION=""
if [[ -n "${EXPECTED_REVISION}" ]]; then
  rollback_web_id="$(deployment_image_id "${ROLLBACK_WEB_IMAGE}")" || fail 'Cannot identify rollback web image.'
  rollback_api_id="$(deployment_image_id "${ROLLBACK_API_IMAGE}")" || fail 'Cannot identify rollback API image.'
  rollback_operations_id=none
  if [[ "${PREVIOUS_OPERATIONS}" == true ]]; then
    rollback_operations_id="$(deployment_image_id "${ROLLBACK_OPERATIONS_IMAGE}")" || fail 'Cannot identify rollback worker image.'
  fi
  read_deployment_revision backups/deployment-rollback.revision "${rollback_web_id}" "${rollback_api_id}" "${rollback_operations_id}" || fail 'Rollback images have no verified revision association.'
  [[ "${SNAPSHOT_REVISION}" == "${EXPECTED_REVISION}" ]] || fail 'Available rollback images do not match the requested stable revision.'
  VERIFIED_REVISION="${SNAPSHOT_REVISION}"
  # Use immutable IDs after validation, even if a mutable rollback tag changes.
  ROLLBACK_WEB_IMAGE="${rollback_web_id}"
  ROLLBACK_API_IMAGE="${rollback_api_id}"
  if [[ "${PREVIOUS_OPERATIONS}" == true ]]; then ROLLBACK_OPERATIONS_IMAGE="${rollback_operations_id}"; fi
fi
if [[ "${PREVIOUS_OPERATIONS}" != true ]]; then
  docker compose -f docker-compose.yml -f docker-compose.operations.yml stop operations
fi
export FUNDING_OPERATIONS_WATCHER_ENABLED="${PREVIOUS_OPERATIONS}"
export OPERATIONS_IMAGE="${ROLLBACK_OPERATIONS_IMAGE}"

echo "Rolling back to previous application images."
echo "Web: ${ROLLBACK_WEB_IMAGE}"
echo "API: ${ROLLBACK_API_IMAGE}"

application_services
WEB_IMAGE="${ROLLBACK_WEB_IMAGE}" \
  API_IMAGE="${ROLLBACK_API_IMAGE}" \
  compose up -d --no-build "${APPLICATION_SERVICES[@]}"

OPENG7_OPERATIONS_CHECK_ENABLED="${PREVIOUS_OPERATIONS}" bash scripts/check.sh
if [[ -n "${VERIFIED_REVISION}" ]]; then
  restored_web_id="$(deployment_image_id "$(compose images -q web | head -n1)")" || fail 'Cannot identify restored web image.'
  restored_api_id="$(deployment_image_id "$(compose images -q api | head -n1)")" || fail 'Cannot identify restored API image.'
  [[ "${restored_web_id}" == "${ROLLBACK_WEB_IMAGE}" && "${restored_api_id}" == "${ROLLBACK_API_IMAGE}" ]] || fail 'Restored application images differ from the verified snapshot.'
  restored_operations=""
  if [[ "${PREVIOUS_OPERATIONS}" == true ]]; then
    restored_operations="$(deployment_image_id "$(compose images -q operations | head -n1)")" || fail 'Cannot identify restored worker image.'
    [[ "${restored_operations}" == "${ROLLBACK_OPERATIONS_IMAGE}" ]] || fail 'Restored worker differs from the verified snapshot.'
  fi
  write_deployment_revision backups/deployment-current.revision "${VERIFIED_REVISION}" "${restored_web_id}" "${restored_api_id}" "${restored_operations}"
else
  mkdir -p backups
  (umask 077; printf 'unknown\n' > backups/deployment-current.revision)
fi
echo "Rollback succeeded for https://${APP_DOMAIN}"
