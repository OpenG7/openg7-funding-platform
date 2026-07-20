#!/usr/bin/env bash
set -Eeuo pipefail

OVH_S3_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVH_S3_STORAGE_DIR="$(cd "${OVH_S3_LIB_DIR}/.." && pwd)"
OVH_S3_REPO_ROOT="$(cd "${OVH_S3_STORAGE_DIR}/.." && pwd)"
OVH_ENV_FILE="${OVH_ENV_FILE:-${OVH_S3_REPO_ROOT}/.env}"

OVH_S3_ALL_USERS_URI="http://acs.amazonaws.com/groups/global/AllUsers"
OVH_S3_PUBLIC_SPONSOR_PREFIX="${OVH_S3_PUBLIC_SPONSOR_PREFIX:-public/sponsors/}"
OVH_S3_DEFAULT_CACHE_CONTROL="public, max-age=31536000, immutable"
OVH_S3_ENCRYPTION_CONFIGURATION='{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

ovh_info() {
  printf '%s\n' "$*"
}

ovh_ok() {
  printf 'OK: %s\n' "$*"
}

ovh_warn() {
  printf 'WARN: %s\n' "$*" >&2
}

ovh_fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

ovh_usage_error() {
  printf 'Usage error: %s\n\n' "$*" >&2
  return 2
}

ovh_load_env() {
  [[ -f "${OVH_ENV_FILE}" ]] ||
    ovh_fail "Missing .env. Copy .env.example to .env and set production values."

  # shellcheck source=scripts/load-env.sh
  source "${OVH_S3_REPO_ROOT}/scripts/load-env.sh" "${OVH_ENV_FILE}"
}

ovh_is_placeholder_value() {
  local value="${1:-}"

  case "${value}" in
    '' | replace_me | *replace_me* | changeme | CHANGE_ME | TODO | https://replace_me)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ovh_require_var() {
  local name="$1"
  local value="${!name:-}"

  if ovh_is_placeholder_value "${value}"; then
    ovh_fail "Missing required environment variable: ${name}"
  fi
}

ovh_require_storage_env() {
  local required_vars=(
    SPONSOR_MEDIA_STORAGE_DRIVER
    SPONSOR_MEDIA_REGION
    SPONSOR_MEDIA_ENDPOINT
    SPONSOR_MEDIA_PUBLIC_BUCKET
    SPONSOR_MEDIA_PUBLIC_BASE_URL
    SPONSOR_MEDIA_PRIVATE_BUCKET
    SPONSOR_MEDIA_PRIVATE_BASE_URL
    OVH_S3_ACCESS_KEY_ID
    OVH_S3_SECRET_ACCESS_KEY
  )

  local name
  for name in "${required_vars[@]}"; do
    ovh_require_var "${name}"
  done

  [[ "${SPONSOR_MEDIA_STORAGE_DRIVER}" == "ovh-s3" ]] ||
    ovh_fail "SPONSOR_MEDIA_STORAGE_DRIVER must be ovh-s3."
}

ovh_require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 ||
    ovh_fail "Required command is not installed: ${command_name}"
}

ovh_require_aws() {
  ovh_require_command aws
}

ovh_require_curl() {
  ovh_require_command curl
}

ovh_export_aws_env() {
  export AWS_ACCESS_KEY_ID="${OVH_S3_ACCESS_KEY_ID}"
  export AWS_SECRET_ACCESS_KEY="${OVH_S3_SECRET_ACCESS_KEY}"
  export AWS_DEFAULT_REGION="${SPONSOR_MEDIA_REGION}"
  export AWS_EC2_METADATA_DISABLED=true
  export AWS_PAGER=''
}

ovh_s3() {
  aws \
    --endpoint-url "${SPONSOR_MEDIA_ENDPOINT}" \
    --region "${SPONSOR_MEDIA_REGION}" \
    --no-cli-pager \
    "$@"
}

ovh_mask_value() {
  local value="${1:-}"
  local length="${#value}"

  if ((length == 0)); then
    printf '<empty>\n'
  elif ((length <= 4)); then
    printf '****\n'
  else
    printf '%s****%s\n' "${value:0:2}" "${value: -2}"
  fi
}

ovh_trim_trailing_slashes() {
  local value="$1"

  while [[ "${value}" == */ ]]; do
    value="${value%/}"
  done

  printf '%s\n' "${value}"
}

ovh_trim_leading_slashes() {
  local value="$1"

  while [[ "${value}" == /* ]]; do
    value="${value#/}"
  done

  printf '%s\n' "${value}"
}

ovh_public_url() {
  local base_url
  local object_key

  base_url="$(ovh_trim_trailing_slashes "$1")"
  object_key="$(ovh_trim_leading_slashes "$2")"

  printf '%s/%s\n' "${base_url}" "${object_key}"
}

ovh_validate_object_key() {
  local key="$1"

  [[ -n "${key}" ]] || ovh_fail "Object key cannot be empty."
  [[ "${key}" != /* ]] || ovh_fail "Object key must be relative: ${key}"
  [[ "${key}" != *'..'* ]] || ovh_fail "Object key cannot contain '..': ${key}"
  [[ "${key}" != *$'\n'* && "${key}" != *$'\r'* ]] ||
    ovh_fail "Object key cannot contain line breaks."
}

ovh_validate_public_sponsor_key() {
  local key="$1"

  ovh_validate_object_key "${key}"
  [[ "${key}" == "${OVH_S3_PUBLIC_SPONSOR_PREFIX}"* ]] ||
    ovh_fail "Public sponsor media must stay under ${OVH_S3_PUBLIC_SPONSOR_PREFIX}."
  [[ "${key}" != "${OVH_S3_PUBLIC_SPONSOR_PREFIX}" ]] ||
    ovh_fail "Refusing to target the public sponsor prefix itself."
  [[ "${key}" != */ ]] ||
    ovh_fail "Refusing to target a prefix instead of one object: ${key}"
}

ovh_confirm() {
  local prompt="$1"
  local expected="$2"
  local answer=''

  printf '%s\n' "${prompt}"
  printf 'Type "%s" to continue: ' "${expected}"
  read -r answer

  [[ "${answer}" == "${expected}" ]] ||
    ovh_fail "Confirmation did not match. No change was made."
}

ovh_bucket_exists() {
  local bucket="$1"
  ovh_s3 s3api head-bucket --bucket "${bucket}" >/dev/null 2>&1
}

ovh_bucket_list_accessible() {
  local bucket="$1"
  ovh_s3 s3api list-objects-v2 --bucket "${bucket}" --max-keys 1 >/dev/null
}

ovh_object_exists() {
  local bucket="$1"
  local key="$2"
  ovh_s3 s3api head-object --bucket "${bucket}" --key "${key}" >/dev/null 2>&1
}

ovh_bucket_all_users_permissions() {
  local bucket="$1"

  ovh_s3 s3api get-bucket-acl \
    --bucket "${bucket}" \
    --query "Grants[?Grantee.URI=='${OVH_S3_ALL_USERS_URI}'].Permission" \
    --output text
}

ovh_bucket_has_all_users_grants() {
  local bucket="$1"
  local permissions

  if ! permissions="$(ovh_bucket_all_users_permissions "${bucket}")"; then
    return 1
  fi

  [[ -n "${permissions//[[:space:]]/}" ]]
}

ovh_bucket_has_public_listing_grant() {
  local bucket="$1"
  local permissions

  if ! permissions="$(ovh_bucket_all_users_permissions "${bucket}")"; then
    return 1
  fi

  tr '\t' '\n' <<<"${permissions}" | grep -Eq '^(READ|FULL_CONTROL)$'
}

ovh_bucket_versioning_status() {
  local bucket="$1"
  local status

  if status="$(ovh_s3 s3api get-bucket-versioning \
    --bucket "${bucket}" \
    --query 'Status' \
    --output text 2>/dev/null)"; then
    case "${status}" in
      '' | None)
        printf 'disabled\n'
        ;;
      *)
        printf '%s\n' "${status}"
        ;;
    esac
  else
    printf 'unknown\n'
    return 1
  fi
}

ovh_bucket_encryption_status() {
  local bucket="$1"
  local algorithm

  if algorithm="$(ovh_s3 s3api get-bucket-encryption \
    --bucket "${bucket}" \
    --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' \
    --output text 2>/dev/null)"; then
    case "${algorithm}" in
      '' | None)
        printf 'disabled\n'
        ;;
      *)
        printf '%s\n' "${algorithm}"
        ;;
    esac
  else
    printf 'unknown\n'
    return 1
  fi
}

ovh_delete_object_version() {
  local bucket="$1"
  local key="$2"
  local version_id="${3:-}"

  if [[ -n "${version_id}" && "${version_id}" != "None" ]]; then
    ovh_s3 s3api delete-object \
      --bucket "${bucket}" \
      --key "${key}" \
      --version-id "${version_id}" >/dev/null
  else
    ovh_s3 s3api delete-object \
      --bucket "${bucket}" \
      --key "${key}" >/dev/null
  fi
}

ovh_http_status() {
  local url="$1"
  local status

  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${url}" || true)"
  [[ -n "${status}" ]] || status="000"
  printf '%s\n' "${status}"
}

ovh_wait_for_http_status() {
  local url="$1"
  local expected_status="$2"
  local attempts="${3:-6}"
  local delay_seconds="${4:-2}"
  local status=''

  local attempt
  for attempt in $(seq 1 "${attempts}"); do
    status="$(ovh_http_status "${url}")"
    if [[ "${status}" == "${expected_status}" ]]; then
      return 0
    fi
    sleep "${delay_seconds}"
  done

  printf '%s\n' "${status}"
  return 1
}

ovh_wait_until_not_http_status() {
  local url="$1"
  local blocked_status="$2"
  local attempts="${3:-6}"
  local delay_seconds="${4:-2}"
  local status=''

  local attempt
  for attempt in $(seq 1 "${attempts}"); do
    status="$(ovh_http_status "${url}")"
    if [[ "${status}" != "${blocked_status}" ]]; then
      return 0
    fi
    sleep "${delay_seconds}"
  done

  printf '%s\n' "${status}"
  return 1
}
