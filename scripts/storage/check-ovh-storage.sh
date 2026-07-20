#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/storage/lib/ovh-s3-common.sh
source "${SCRIPT_DIR}/lib/ovh-s3-common.sh"

usage() {
  cat <<'USAGE'
Usage: bash scripts/storage/check-ovh-storage.sh

Checks the OVH Object Storage configuration without changing data.

Required environment:
  SPONSOR_MEDIA_REGION
  SPONSOR_MEDIA_ENDPOINT
  SPONSOR_MEDIA_PUBLIC_BUCKET
  SPONSOR_MEDIA_PUBLIC_BASE_URL
  SPONSOR_MEDIA_PRIVATE_BUCKET
  SPONSOR_MEDIA_PRIVATE_BASE_URL
  OVH_S3_ACCESS_KEY_ID
  OVH_S3_SECRET_ACCESS_KEY
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

[[ "$#" -eq 0 ]] || {
  usage >&2
  exit 2
}

failures=0
warnings=0

record_fail() {
  printf 'FAIL: %s\n' "$*" >&2
  failures=$((failures + 1))
}

record_warn() {
  printf 'WARN: %s\n' "$*" >&2
  warnings=$((warnings + 1))
}

row() {
  printf '%-26s %s\n' "$1" "$2"
}

versioning_label() {
  local output_var="$1"
  local bucket="$2"
  local label="$3"
  local status

  if status="$(ovh_bucket_versioning_status "${bucket}")"; then
    if [[ "${status}" == "Enabled" ]]; then
      printf -v "${output_var}" '%s' "enabled"
    else
      record_fail "${label} bucket versioning is ${status}; expected Enabled."
      printf -v "${output_var}" '%s' "${status}"
    fi
  else
    record_warn "${label} bucket versioning could not be read with this S3 API or credentials."
    printf -v "${output_var}" '%s' "unknown"
  fi
}

encryption_label() {
  local output_var="$1"
  local bucket="$2"
  local label="$3"
  local status

  if status="$(ovh_bucket_encryption_status "${bucket}")"; then
    if [[ "${status}" == "AES256" ]]; then
      printf -v "${output_var}" '%s' "SSE-OMK"
    else
      record_warn "${label} bucket encryption status is ${status}; verify SSE-OMK in OVH Manager."
      printf -v "${output_var}" '%s' "${status}"
    fi
  else
    record_warn "${label} bucket encryption could not be read; verify SSE-OMK in OVH Manager."
    printf -v "${output_var}" '%s' "unknown"
  fi
}

bucket_access_label() {
  local output_var="$1"
  local bucket="$2"
  local label="$3"

  if ! ovh_bucket_exists "${bucket}"; then
    record_fail "${label} bucket does not exist or is not reachable: ${bucket}"
    printf -v "${output_var}" '%s' "not reachable"
    return 0
  fi

  if ! ovh_bucket_list_accessible "${bucket}" >/dev/null 2>&1; then
    record_fail "${label} bucket exists but authenticated list access failed: ${bucket}"
    printf -v "${output_var}" '%s' "head only"
    return 0
  fi

  printf -v "${output_var}" '%s' "accessible"
}

bucket_acl_private_label() {
  local output_var="$1"
  local bucket="$2"
  local permissions

  if ! permissions="$(ovh_bucket_all_users_permissions "${bucket}")"; then
    record_fail "Private bucket ACL could not be read."
    printf -v "${output_var}" '%s' "unknown"
    return 0
  fi

  if [[ -n "${permissions//[[:space:]]/}" ]]; then
    record_fail "Private bucket has an AllUsers ACL grant."
    printf -v "${output_var}" '%s' "public grant"
    return 0
  fi

  printf -v "${output_var}" '%s' "private"
}

public_listing_label() {
  local output_var="$1"
  local bucket="$2"
  local permissions

  if ! permissions="$(ovh_bucket_all_users_permissions "${bucket}")"; then
    record_fail "Public bucket ACL could not be read."
    printf -v "${output_var}" '%s' "unknown"
    return 0
  fi

  if tr '\t' '\n' <<<"${permissions}" | grep -Eq '^(READ|FULL_CONTROL)$'; then
    record_fail "Public bucket grants AllUsers READ or FULL_CONTROL, which permits listing."
    printf -v "${output_var}" '%s' "public listing"
    return 0
  fi

  printf -v "${output_var}" '%s' "private"
}

anonymous_listing_label() {
  local output_var="$1"
  local base_url="$2"
  local label="$3"
  local status

  status="$(ovh_http_status "$(ovh_trim_trailing_slashes "${base_url}")/?list-type=2")"
  if [[ "${status}" == "200" ]]; then
    record_fail "${label} bucket allows anonymous listing over HTTP."
    printf -v "${output_var}" '%s' "public"
    return 0
  fi

  printf -v "${output_var}" '%s' "denied HTTP ${status}"
}

ovh_load_env
ovh_require_storage_env
ovh_require_aws
ovh_require_curl
ovh_export_aws_env

endpoint_status="OK"
region_status="${SPONSOR_MEDIA_REGION}"
public_base_status="OK"
private_base_status="OK"

if [[ ! "${SPONSOR_MEDIA_REGION}" =~ ^[a-z][a-z0-9-]{1,15}$ ]]; then
  record_fail "SPONSOR_MEDIA_REGION has an unexpected format: ${SPONSOR_MEDIA_REGION}"
  region_status="invalid"
fi

if [[ ! "${SPONSOR_MEDIA_ENDPOINT}" =~ ^https://[^/]+$ ]]; then
  record_fail "SPONSOR_MEDIA_ENDPOINT must be an https URL with no path or trailing slash."
  endpoint_status="invalid"
elif [[ "${SPONSOR_MEDIA_ENDPOINT}" != *".${SPONSOR_MEDIA_REGION}."* ]]; then
  record_fail "SPONSOR_MEDIA_ENDPOINT does not match SPONSOR_MEDIA_REGION=${SPONSOR_MEDIA_REGION}."
  endpoint_status="region mismatch"
fi

if [[ "${SPONSOR_MEDIA_PUBLIC_BASE_URL}" == */ ]]; then
  record_fail "SPONSOR_MEDIA_PUBLIC_BASE_URL must not end with /."
  public_base_status="trailing slash"
fi

if [[ "${SPONSOR_MEDIA_PRIVATE_BASE_URL}" == */ ]]; then
  record_fail "SPONSOR_MEDIA_PRIVATE_BASE_URL must not end with /."
  private_base_status="trailing slash"
fi

if [[ "${SPONSOR_MEDIA_PUBLIC_BASE_URL}" != *"${SPONSOR_MEDIA_PUBLIC_BUCKET}"* ]]; then
  record_warn "Public base URL does not contain the public bucket name."
  public_base_status="check manually"
fi

if [[ "${SPONSOR_MEDIA_PRIVATE_BASE_URL}" != *"${SPONSOR_MEDIA_PRIVATE_BUCKET}"* ]]; then
  record_warn "Private base URL does not contain the private bucket name."
  private_base_status="check manually"
fi

bucket_access_label private_bucket_status "${SPONSOR_MEDIA_PRIVATE_BUCKET}" "Private"
bucket_access_label public_bucket_status "${SPONSOR_MEDIA_PUBLIC_BUCKET}" "Public"
bucket_acl_private_label private_acl_status "${SPONSOR_MEDIA_PRIVATE_BUCKET}"
public_listing_label public_listing_status "${SPONSOR_MEDIA_PUBLIC_BUCKET}"
anonymous_listing_label private_anonymous_status "${SPONSOR_MEDIA_PRIVATE_BASE_URL}" "Private"
anonymous_listing_label public_anonymous_listing_status "${SPONSOR_MEDIA_PUBLIC_BASE_URL}" "Public"
versioning_label private_versioning_status "${SPONSOR_MEDIA_PRIVATE_BUCKET}" "Private"
versioning_label public_versioning_status "${SPONSOR_MEDIA_PUBLIC_BUCKET}" "Public"
encryption_label private_encryption_status "${SPONSOR_MEDIA_PRIVATE_BUCKET}" "Private"
encryption_label public_encryption_status "${SPONSOR_MEDIA_PUBLIC_BUCKET}" "Public"

printf '\nOVH Object Storage check\n\n'
row "Region:" "${region_status}"
row "Endpoint:" "${endpoint_status}"
row "Public base URL:" "${public_base_status}"
row "Private base URL:" "${private_base_status}"
row "Private bucket:" "${private_bucket_status}"
row "Private bucket ACL:" "${private_acl_status}"
row "Private anonymous list:" "${private_anonymous_status}"
row "Public bucket:" "${public_bucket_status}"
row "Public bucket listing:" "${public_listing_status}"
row "Public anonymous list:" "${public_anonymous_listing_status}"
row "Versioning private:" "${private_versioning_status}"
row "Versioning public:" "${public_versioning_status}"
row "Encryption private:" "${private_encryption_status}"
row "Encryption public:" "${public_encryption_status}"
printf '\n'

if ((failures > 0)); then
  row "Result:" "FAIL (${failures} failure(s), ${warnings} warning(s))"
  exit 1
fi

if ((warnings > 0)); then
  row "Result:" "OK with warnings (${warnings})"
else
  row "Result:" "OK"
fi
