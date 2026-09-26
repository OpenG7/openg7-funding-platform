#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# One engine for local and VPS execution; no npm packages or API build required.
command -v node >/dev/null 2>&1 || {
  echo "FAIL: Node.js 22 is required for database migrations." >&2
  exit 1
}
exec node scripts/db-migrate.mjs "$@"
