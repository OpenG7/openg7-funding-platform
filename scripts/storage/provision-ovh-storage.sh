#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/storage/lib/ovh-s3-common.sh
source "${SCRIPT_DIR}/lib/ovh-s3-common.sh"

usage() {
  cat <<'USAGE'
Usage: bash scripts/storage/provision-ovh-storage.sh [--dry-run] [--yes]

Creates missing OVH Object Storage buckets and enables supported bucket features.
Existing buckets are never deleted or recreated.

Options:
  --dry-run   Show planned operations without changing OVH resources.
  --yes       Skip confirmation prompts for real create/update operations.
  -h, --help  Show this help.
USAGE
}

DRY_RUN=0
YES=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
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
      usage >&2
      ovh_usage_error "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

confirm_or_dry_run() {
  local action_label="$1"
  local confirmation="$2"

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    ovh_info "DRY RUN: would ${action_label}"
    return 1
  fi

  if [[ "${YES}" -eq 0 ]]; then
    ovh_confirm "About to ${action_label}." "${confirmation}"
  fi

  return 0
}

ensure_bucket() {
  local bucket="$1"
  local label="$2"

  if ovh_bucket_exists "${bucket}"; then
    ovh_ok "${label} bucket exists; creation skipped: ${bucket}"
    return 0
  fi

  if ! confirm_or_dry_run "create ${label} bucket ${bucket}" "CREATE ${bucket}"; then
    return 0
  fi

  ovh_s3 s3api create-bucket \
    --bucket "${bucket}" \
    --acl private >/dev/null
  ovh_ok "${label} bucket created private: ${bucket}"
}

ensure_versioning() {
  local bucket="$1"
  local status

  if status="$(ovh_bucket_versioning_status "${bucket}")"; then
    if [[ "${status}" == "Enabled" ]]; then
      ovh_ok "Versioning already enabled: ${bucket}"
      return 0
    fi
  else
    ovh_warn "Could not read versioning for ${bucket}; will try to enable it if confirmed."
  fi

  if ! confirm_or_dry_run "enable versioning on ${bucket}" "ENABLE VERSIONING ${bucket}"; then
    return 0
  fi

  ovh_s3 s3api put-bucket-versioning \
    --bucket "${bucket}" \
    --versioning-configuration Status=Enabled >/dev/null
  ovh_ok "Versioning enabled: ${bucket}"
}

ensure_encryption() {
  local bucket="$1"
  local status

  if status="$(ovh_bucket_encryption_status "${bucket}")"; then
    if [[ "${status}" == "AES256" ]]; then
      ovh_ok "SSE-OMK encryption already enabled: ${bucket}"
      return 0
    fi
  else
    ovh_warn "Could not read encryption for ${bucket}; will try SSE-OMK if confirmed."
  fi

  if ! confirm_or_dry_run "enable SSE-OMK encryption on ${bucket}" "ENABLE SSE-OMK ${bucket}"; then
    return 0
  fi

  if ovh_s3 s3api put-bucket-encryption \
    --bucket "${bucket}" \
    --server-side-encryption-configuration "${OVH_S3_ENCRYPTION_CONFIGURATION}" >/dev/null; then
    ovh_ok "SSE-OMK encryption enabled: ${bucket}"
  else
    ovh_warn "SSE-OMK could not be configured with AWS CLI. Verify or configure it in OVH Manager."
  fi
}

warn_if_public_listing() {
  local bucket="$1"

  if ovh_bucket_has_public_listing_grant "${bucket}"; then
    ovh_warn "Bucket grants public listing; fix the bucket ACL before production use: ${bucket}"
  fi
}

ovh_load_env
ovh_require_storage_env
ovh_require_aws
ovh_export_aws_env

printf 'OVH Object Storage provisioning\n\n'
[[ "${DRY_RUN}" -eq 1 ]] && ovh_info "Dry run mode: no OVH resources will be changed."

ensure_bucket "${SPONSOR_MEDIA_PRIVATE_BUCKET}" "private"
ensure_bucket "${SPONSOR_MEDIA_PUBLIC_BUCKET}" "public"

ensure_versioning "${SPONSOR_MEDIA_PRIVATE_BUCKET}"
ensure_versioning "${SPONSOR_MEDIA_PUBLIC_BUCKET}"

ensure_encryption "${SPONSOR_MEDIA_PRIVATE_BUCKET}"
ensure_encryption "${SPONSOR_MEDIA_PUBLIC_BUCKET}"

warn_if_public_listing "${SPONSOR_MEDIA_PRIVATE_BUCKET}"
warn_if_public_listing "${SPONSOR_MEDIA_PUBLIC_BUCKET}"

printf '\nProvisioning complete. No bucket was made public.\n'
