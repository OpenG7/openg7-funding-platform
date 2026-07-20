#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/storage/lib/ovh-s3-common.sh
source "${SCRIPT_DIR}/lib/ovh-s3-common.sh"

usage() {
  cat <<'USAGE'
Usage: bash scripts/storage/publish-sponsor-media.sh \
  --source-key "uploads/sponsors/123/original.webp" \
  --target-key "public/sponsors/123/profile-<checksum>.webp" \
  --content-type "image/webp" \
  [--cache-control "public, max-age=31536000, immutable"]

Copies one approved sponsor media object from the private bucket to the public
bucket and applies public-read only to that object.

Options:
  --source-key      Existing object key in the private bucket.
  --target-key      Destination object key under public/sponsors/.
  --content-type    Content-Type to set on the public object.
  --cache-control   Cache-Control to set on the public object.
  -h, --help        Show this help.
USAGE
}

SOURCE_KEY=''
TARGET_KEY=''
CONTENT_TYPE=''
CACHE_CONTROL="${OVH_S3_DEFAULT_CACHE_CONTROL}"

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --source-key)
      SOURCE_KEY="${2:-}"
      shift 2
      ;;
    --target-key)
      TARGET_KEY="${2:-}"
      shift 2
      ;;
    --content-type)
      CONTENT_TYPE="${2:-}"
      shift 2
      ;;
    --cache-control)
      CACHE_CONTROL="${2:-}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      ovh_usage_error "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

[[ -n "${SOURCE_KEY}" ]] || {
  usage >&2
  ovh_fail "--source-key is required."
}
[[ -n "${TARGET_KEY}" ]] || {
  usage >&2
  ovh_fail "--target-key is required."
}
[[ -n "${CONTENT_TYPE}" ]] || {
  usage >&2
  ovh_fail "--content-type is required."
}
[[ -n "${CACHE_CONTROL}" ]] || ovh_fail "--cache-control cannot be empty."

ovh_validate_object_key "${SOURCE_KEY}"
ovh_validate_public_sponsor_key "${TARGET_KEY}"

ovh_load_env
ovh_require_storage_env
ovh_require_aws
ovh_require_curl
ovh_export_aws_env

ovh_object_exists "${SPONSOR_MEDIA_PRIVATE_BUCKET}" "${SOURCE_KEY}" ||
  ovh_fail "Source object was not found in the private bucket: ${SOURCE_KEY}"

ovh_info "Publishing one sponsor media object"
ovh_info "Source: ${SPONSOR_MEDIA_PRIVATE_BUCKET}/${SOURCE_KEY}"
ovh_info "Target: ${SPONSOR_MEDIA_PUBLIC_BUCKET}/${TARGET_KEY}"
ovh_warn "Use versioned or checksum-based filenames for immutable public URLs."

ovh_s3 s3api copy-object \
  --bucket "${SPONSOR_MEDIA_PUBLIC_BUCKET}" \
  --key "${TARGET_KEY}" \
  --copy-source "${SPONSOR_MEDIA_PRIVATE_BUCKET}/${SOURCE_KEY}" \
  --metadata-directive REPLACE \
  --content-type "${CONTENT_TYPE}" \
  --cache-control "${CACHE_CONTROL}" \
  --acl public-read >/dev/null

PUBLIC_URL="$(ovh_public_url "${SPONSOR_MEDIA_PUBLIC_BASE_URL}" "${TARGET_KEY}")"
if ! ovh_wait_for_http_status "${PUBLIC_URL}" "200" 6 2 >/dev/null; then
  STATUS="$(ovh_http_status "${PUBLIC_URL}")"
  ovh_fail "Published object returned HTTP ${STATUS}; expected 200."
fi

printf '\nPublished URL:\n%s\n' "${PUBLIC_URL}"
