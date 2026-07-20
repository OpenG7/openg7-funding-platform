#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/storage/lib/ovh-s3-common.sh
source "${SCRIPT_DIR}/lib/ovh-s3-common.sh"

usage() {
  cat <<'USAGE'
Usage: bash scripts/storage/unpublish-sponsor-media.sh --key "public/sponsors/123/profile.webp" [--dry-run] [--yes]

Deletes one public sponsor media object. The private original is never touched.

Options:
  --key, --target-key  Public object key under public/sponsors/.
  --dry-run           Show the target without deleting it.
  --yes               Skip the confirmation prompt.
  -h, --help          Show this help.
USAGE
}

TARGET_KEY=''
DRY_RUN=0
YES=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --key | --target-key)
      TARGET_KEY="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --yes)
      YES=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "${TARGET_KEY}" && "$1" != -* ]]; then
        TARGET_KEY="$1"
        shift
      else
        usage >&2
        ovh_usage_error "Unknown argument: $1" >&2
        exit 2
      fi
      ;;
  esac
done

[[ -n "${TARGET_KEY}" ]] || {
  usage >&2
  ovh_fail "--key is required."
}

ovh_validate_public_sponsor_key "${TARGET_KEY}"

ovh_load_env
ovh_require_storage_env
ovh_require_aws
ovh_require_curl
ovh_export_aws_env

PUBLIC_URL="$(ovh_public_url "${SPONSOR_MEDIA_PUBLIC_BASE_URL}" "${TARGET_KEY}")"

ovh_info "Public object targeted for unpublish:"
ovh_info "${SPONSOR_MEDIA_PUBLIC_BUCKET}/${TARGET_KEY}"
ovh_info "${PUBLIC_URL}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  ovh_info "DRY RUN: no object was deleted."
  exit 0
fi

if ! ovh_object_exists "${SPONSOR_MEDIA_PUBLIC_BUCKET}" "${TARGET_KEY}"; then
  ovh_fail "Public object does not exist: ${TARGET_KEY}"
fi

if [[ "${YES}" -eq 0 ]]; then
  ovh_confirm "About to delete only this public object. The private original will not be touched." "DELETE ${TARGET_KEY}"
fi

ovh_s3 s3api delete-object \
  --bucket "${SPONSOR_MEDIA_PUBLIC_BUCKET}" \
  --key "${TARGET_KEY}" >/dev/null
ovh_ok "Public object deleted: ${TARGET_KEY}"

if ! ovh_wait_until_not_http_status "${PUBLIC_URL}" "200" 6 2 >/dev/null; then
  STATUS="$(ovh_http_status "${PUBLIC_URL}")"
  ovh_fail "Public URL still returns HTTP ${STATUS} after unpublish."
fi

printf 'Result: OK\n'
