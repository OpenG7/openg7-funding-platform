#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/storage/lib/ovh-s3-common.sh
source "${SCRIPT_DIR}/lib/ovh-s3-common.sh"

usage() {
  cat <<'USAGE'
Usage: bash scripts/storage/test-ovh-storage.sh [--keep-test-objects]

Runs a temporary end-to-end permission test against the OVH private and public
sponsor media buckets.

Options:
  --keep-test-objects   Leave uploaded test objects in place for manual debug.
  -h, --help            Show this help.
USAGE
}

KEEP_TEST_OBJECTS=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --keep-test-objects)
      KEEP_TEST_OBJECTS=1
      shift
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

TMP_DIR=''
PRIVATE_TEST_KEY=''
PUBLIC_TEST_KEY=''
PRIVATE_VERSION_ID=''
PUBLIC_VERSION_ID=''

cleanup() {
  local status=$?

  if [[ "${KEEP_TEST_OBJECTS}" -eq 0 ]]; then
    if [[ -n "${PUBLIC_TEST_KEY:-}" && -n "${SPONSOR_MEDIA_PUBLIC_BUCKET:-}" ]]; then
      ovh_delete_object_version "${SPONSOR_MEDIA_PUBLIC_BUCKET}" "${PUBLIC_TEST_KEY}" "${PUBLIC_VERSION_ID:-}" >/dev/null 2>&1 ||
        ovh_warn "Could not clean public test object: ${PUBLIC_TEST_KEY}"
    fi

    if [[ -n "${PRIVATE_TEST_KEY:-}" && -n "${SPONSOR_MEDIA_PRIVATE_BUCKET:-}" ]]; then
      ovh_delete_object_version "${SPONSOR_MEDIA_PRIVATE_BUCKET}" "${PRIVATE_TEST_KEY}" "${PRIVATE_VERSION_ID:-}" >/dev/null 2>&1 ||
        ovh_warn "Could not clean private test object: ${PRIVATE_TEST_KEY}"
    fi
  else
    [[ -n "${PRIVATE_TEST_KEY:-}" ]] &&
      ovh_warn "Kept private test object: ${SPONSOR_MEDIA_PRIVATE_BUCKET}/${PRIVATE_TEST_KEY}"
    [[ -n "${PUBLIC_TEST_KEY:-}" ]] &&
      ovh_warn "Kept public test object: ${SPONSOR_MEDIA_PUBLIC_BUCKET}/${PUBLIC_TEST_KEY}"
  fi

  [[ -n "${TMP_DIR:-}" ]] && rm -rf "${TMP_DIR}"
  exit "${status}"
}

trap cleanup EXIT

capture_version_id() {
  local output="$1"
  local version_id

  version_id="$(printf '%s\n' "${output}" | tr -d '\r' | tail -n1)"
  case "${version_id}" in
    '' | None)
      printf '\n'
      ;;
    *)
      printf '%s\n' "${version_id}"
      ;;
  esac
}

ovh_load_env
ovh_require_storage_env
ovh_require_aws
ovh_require_curl
ovh_export_aws_env

TMP_DIR="$(mktemp -d)"
TEST_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}"
PRIVATE_TEST_KEY="system-tests/${TEST_ID}/private-test.txt"
PUBLIC_TEST_KEY="system-tests/${TEST_ID}/public-test.txt"
PRIVATE_FILE="${TMP_DIR}/private-test.txt"
PUBLIC_FILE="${TMP_DIR}/public-test.txt"
PUBLIC_DOWNLOAD="${TMP_DIR}/public-download.txt"

printf 'openg7 private storage test %s\n' "${TEST_ID}" >"${PRIVATE_FILE}"
printf 'openg7 public storage test %s\n' "${TEST_ID}" >"${PUBLIC_FILE}"

printf 'OVH Object Storage functional test\n\n'

ovh_info "Private bucket test: upload authenticated object"
PRIVATE_PUT_OUTPUT="$(ovh_s3 s3api put-object \
  --bucket "${SPONSOR_MEDIA_PRIVATE_BUCKET}" \
  --key "${PRIVATE_TEST_KEY}" \
  --body "${PRIVATE_FILE}" \
  --query 'VersionId' \
  --output text)"
PRIVATE_VERSION_ID="$(capture_version_id "${PRIVATE_PUT_OUTPUT}")"

ovh_object_exists "${SPONSOR_MEDIA_PRIVATE_BUCKET}" "${PRIVATE_TEST_KEY}" ||
  ovh_fail "Private test object was not found after upload."
ovh_ok "Private object exists with authenticated access"

PRIVATE_URL="$(ovh_public_url "${SPONSOR_MEDIA_PRIVATE_BASE_URL}" "${PRIVATE_TEST_KEY}")"
PRIVATE_STATUS="$(ovh_http_status "${PRIVATE_URL}")"
case "${PRIVATE_STATUS}" in
  403)
    ovh_ok "Private object rejects anonymous HTTP access with 403"
    ;;
  200)
    ovh_fail "Critical privacy failure: private object returned HTTP 200 anonymously."
    ;;
  *)
    ovh_fail "Private object returned HTTP ${PRIVATE_STATUS} anonymously; expected 403."
    ;;
esac

ovh_delete_object_version "${SPONSOR_MEDIA_PRIVATE_BUCKET}" "${PRIVATE_TEST_KEY}" "${PRIVATE_VERSION_ID}"
PRIVATE_TEST_KEY=''
PRIVATE_VERSION_ID=''
if ovh_object_exists "${SPONSOR_MEDIA_PRIVATE_BUCKET}" "system-tests/${TEST_ID}/private-test.txt"; then
  ovh_fail "Private test object still exists after delete."
fi
ovh_ok "Private test object removed"

ovh_info "Public bucket test: publish one explicit object"
PUBLIC_PUT_OUTPUT="$(ovh_s3 s3api put-object \
  --bucket "${SPONSOR_MEDIA_PUBLIC_BUCKET}" \
  --key "${PUBLIC_TEST_KEY}" \
  --body "${PUBLIC_FILE}" \
  --content-type "text/plain; charset=utf-8" \
  --cache-control "no-store" \
  --query 'VersionId' \
  --output text)"
PUBLIC_VERSION_ID="$(capture_version_id "${PUBLIC_PUT_OUTPUT}")"

ovh_s3 s3api put-object-acl \
  --bucket "${SPONSOR_MEDIA_PUBLIC_BUCKET}" \
  --key "${PUBLIC_TEST_KEY}" \
  --acl public-read >/dev/null

PUBLIC_URL="$(ovh_public_url "${SPONSOR_MEDIA_PUBLIC_BASE_URL}" "${PUBLIC_TEST_KEY}")"
if ! ovh_wait_for_http_status "${PUBLIC_URL}" "200" 6 2 >/dev/null; then
  PUBLIC_STATUS="$(ovh_http_status "${PUBLIC_URL}")"
  ovh_fail "Public test object returned HTTP ${PUBLIC_STATUS}; expected 200."
fi

PUBLIC_STATUS="$(curl -sS -o "${PUBLIC_DOWNLOAD}" -w '%{http_code}' --max-time 20 "${PUBLIC_URL}" || true)"
[[ "${PUBLIC_STATUS}" == "200" ]] ||
  ovh_fail "Public test object download returned HTTP ${PUBLIC_STATUS}; expected 200."
cmp -s "${PUBLIC_FILE}" "${PUBLIC_DOWNLOAD}" ||
  ovh_fail "Public test object content did not match after anonymous download."
ovh_ok "Public object is anonymously readable only after public-read ACL"

ovh_delete_object_version "${SPONSOR_MEDIA_PUBLIC_BUCKET}" "${PUBLIC_TEST_KEY}" "${PUBLIC_VERSION_ID}"
PUBLIC_TEST_KEY=''
PUBLIC_VERSION_ID=''

if ! ovh_wait_until_not_http_status "${PUBLIC_URL}" "200" 6 2 >/dev/null; then
  PUBLIC_STATUS="$(ovh_http_status "${PUBLIC_URL}")"
  ovh_fail "Public test object still returns HTTP ${PUBLIC_STATUS} after delete."
fi
ovh_ok "Public test object removed"

printf '\nResult: OK\n'
