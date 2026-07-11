#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source scripts/load-env.sh .env
fi

POSTGRES_DB="${POSTGRES_DB:-openg7_funding}"
POSTGRES_USER="${POSTGRES_USER:-openg7_funding}"

docker compose --profile database exec -it postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" "$@"
