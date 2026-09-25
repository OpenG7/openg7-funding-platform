#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
CONFIG_BACKUP="" DATABASE_DUMP="" SPONSOR_LOGOS_BACKUP="" TARGET_PROJECT=""
FORCE=0
fail() { echo "FAIL: $*" >&2; exit 1; }
docker_path() { if command -v cygpath >/dev/null; then cygpath -am "$1"; else printf '%s' "$1"; fi; }
docker() { MSYS_NO_PATHCONV=1 command docker "$@"; }
usage() {
  cat <<'USAGE'
Usage: bash scripts/restore-from-backup.sh --target-project <new-project> \
  --config-backup <archive.tar.gz> --database-dump <database.sql> \
  --sponsor-logos-backup <media.tar.gz> [--force]

Run from a trusted checkout on a dedicated recovery target without a .env file.
Requires Node 22, Docker Compose and the configuration archive's .manifest.json.
Only new project/volumes are accepted. Existing data is never removed.
The configuration is restored with isolated project, volume and network names.
PostgreSQL and local media are restored; API, Web and workers remain stopped.
--force skips the typed confirmation, not integrity or target checks.
USAGE
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-backup|--database-dump|--sponsor-logos-backup|--target-project)
      [[ $# -ge 2 && -n "$2" ]] || fail "Missing option value."
      case "$1" in
        --config-backup) CONFIG_BACKUP="$2";;
        --database-dump) DATABASE_DUMP="$2";;
        --sponsor-logos-backup) SPONSOR_LOGOS_BACKUP="$2";;
        --target-project) TARGET_PROJECT="$2";;
      esac
      shift 2;;
    --force) FORCE=1; shift;;
    --help) usage; exit 0;;
    *) fail "Unknown option. Use --help.";;
  esac
done
[[ "$TARGET_PROJECT" =~ ^[a-z0-9][a-z0-9_-]{2,49}$ ]] || fail "An explicit new --target-project is required."
[[ ! -e .env && ! -L .env ]] || fail "Target already has .env. Use a dedicated fresh checkout."
for file in "$CONFIG_BACKUP" "$DATABASE_DUMP" "$SPONSOR_LOGOS_BACKUP"; do
  [[ -f "$file" ]] || fail "All three backup artifacts are required."
done
command -v node >/dev/null || fail "Node 22 is required for backup verification."
command -v docker >/dev/null || fail "Docker is required."
docker compose version >/dev/null
node scripts/backup-artifacts.mjs verify "$CONFIG_BACKUP" "$DATABASE_DUMP" "$SPONSOR_LOGOS_BACKUP"
assert_target_unused() {
  local containers container suffix
  containers="$(docker ps -aq --no-trunc --filter "label=com.docker.compose.project=${TARGET_PROJECT}")" || fail "Cannot inspect target containers."
  for container in $containers; do
    [[ "$container" == "${RESTORE_RESERVATION:-}" ]] || fail "Target project already has containers."
  done
  for suffix in postgres-data sponsor-logos; do
    if docker volume inspect "${TARGET_PROJECT}-${suffix}" >/dev/null 2>&1; then
      fail "Target volume already exists. Choose another recovery project."
    fi
  done
  for suffix in edge data; do
    if docker network inspect "${TARGET_PROJECT}-${suffix}" >/dev/null 2>&1; then
      fail "Target network already exists. Choose another recovery project."
    fi
  done
}
assert_target_unused

mkdir "$ROOT_DIR/.restore.lock" 2>/dev/null || fail "A restore is already using this checkout."
STAGE="" RESTORE_RESERVATION=""
cleanup() {
  if [[ -n "$RESTORE_RESERVATION" ]]; then docker rm "$RESTORE_RESERVATION" >/dev/null; fi
  if [[ -n "$STAGE" ]]; then rm -rf -- "$STAGE"; fi
  rmdir "$ROOT_DIR/.restore.lock"
}
trap cleanup EXIT
STAGE="$(mktemp -d "${ROOT_DIR}/.restore-stage.XXXXXX")"
tar -xzf "$CONFIG_BACKUP" -C "$STAGE"
# Archived scripts are retained in the archive, never executed or installed.
export COMPOSE_PROJECT_NAME="$TARGET_PROJECT"
export POSTGRES_VOLUME_NAME="${TARGET_PROJECT}-postgres-data"
export SPONSOR_LOGOS_VOLUME_NAME="${TARGET_PROJECT}-sponsor-logos"
export OPENG7_EDGE_NETWORK_NAME="${TARGET_PROJECT}-edge"
export OPENG7_DATA_NETWORK_NAME="${TARGET_PROJECT}-data"
unset COMPOSE_FILE COMPOSE_PROFILES
printf '\nCOMPOSE_PROJECT_NAME=%s\nPOSTGRES_VOLUME_NAME=%s\nSPONSOR_LOGOS_VOLUME_NAME=%s\nOPENG7_EDGE_NETWORK_NAME=%s\nOPENG7_DATA_NETWORK_NAME=%s\n' \
  "$TARGET_PROJECT" "$POSTGRES_VOLUME_NAME" "$SPONSOR_LOGOS_VOLUME_NAME" "$OPENG7_EDGE_NETWORK_NAME" "$OPENG7_DATA_NETWORK_NAME" >> "$STAGE/.env"
compose() { docker compose --project-directory "$(docker_path "$STAGE")" --env-file "$(docker_path "$STAGE/.env")" -p "$TARGET_PROJECT" -f "$(docker_path "$STAGE/docker-compose.yml")" --profile database "$@"; }
compose config --format json | node scripts/backup-artifacts.mjs check-compose "$TARGET_PROJECT"
if [[ "$FORCE" -ne 1 ]]; then
  printf 'Restore into new project %s with volumes %s and %s.\n' "$TARGET_PROJECT" "$POSTGRES_VOLUME_NAME" "$SPONSOR_LOGOS_VOLUME_NAME"
  echo "Application services will remain stopped. Type RESTORE ${TARGET_PROJECT} to continue."
  read -r confirmation
  [[ "$confirmation" == "RESTORE ${TARGET_PROJECT}" ]] || fail "Restore cancelled."
fi
# Atomic reservation also serializes the same project across separate checkouts.
RESTORE_RESERVATION="$(docker create --name "${TARGET_PROJECT}-restore-lock" \
  --label "com.docker.compose.project=${TARGET_PROJECT}" \
  --mount type=tmpfs,destination=/var/lib/postgresql/data \
  --entrypoint true postgres:16-alpine)" || fail "Recovery project is already reserved."
# Another restore may have completed while this operator was confirming.
assert_target_unused
cp "$STAGE/.env" "$ROOT_DIR/.env"
cp "$STAGE/docker-compose.yml" "$ROOT_DIR/docker-compose.yml"
if [[ -d "$STAGE/traefik" ]]; then cp -R "$STAGE/traefik" "$ROOT_DIR/"; fi
chmod 600 .env
compose up -d --no-deps postgres
for _ in $(seq 1 60); do
  if compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then break; fi
  sleep 1
done
compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null || fail "PostgreSQL did not become ready."
# A failed statement rolls back the entire import, including schema creation.
compose exec -T postgres sh -c 'exec psql -X --single-transaction -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$DATABASE_DUMP" >/dev/null 2>&1 || fail "Database import failed; application remains stopped."
docker volume create "$SPONSOR_LOGOS_VOLUME_NAME" >/dev/null
MEDIA_ABS="$(cd "$(dirname "$SPONSOR_LOGOS_BACKUP")" && pwd)/$(basename "$SPONSOR_LOGOS_BACKUP")"
docker run --rm --entrypoint sh \
  --mount "type=volume,src=${SPONSOR_LOGOS_VOLUME_NAME},dst=/volume" \
  --mount "type=bind,src=$(docker_path "$MEDIA_ABS"),dst=/archive.tar.gz,readonly" \
  postgres:16-alpine -c 'cd /volume && tar -xzf /archive.tar.gz'
echo "Restore completed into ${TARGET_PROJECT}. API, Web and workers remain stopped."
echo "Verify totals, documents, media, access and provider reconciliation before starting application services."
