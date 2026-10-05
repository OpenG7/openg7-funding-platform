#!/usr/bin/env bash
# Data-only receipts: bind a verified checkout to exact application/worker images.
deployment_image_id() {
  local image_id
  image_id="$(docker image inspect --format '{{.Id}}' "$1")" || return 1
  [[ "${image_id}" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  printf '%s' "${image_id}"
}

read_deployment_revision() {
  local revision web api operations extra
  SNAPSHOT_REVISION=""
  [[ -f "$1" ]] || return 1
  # Never source receipt files as shell code.
  read -r revision web api operations extra < "$1" || return 1
  [[ "${revision}" =~ ^[0-9a-f]{40}$ && -z "${extra}" ]] || return 1
  [[ "${web}" == "$2" && "${api}" == "$3" && "${operations}" == "$4" ]] || return 1
  SNAPSHOT_REVISION="${revision}"
}

write_deployment_revision() {
  local receipt="$1" revision="$2" web api operations=none
  [[ "${revision}" =~ ^[0-9a-f]{40}$ ]] || return 1
  web="$(deployment_image_id "$3")" || return 1
  api="$(deployment_image_id "$4")" || return 1
  if [[ -n "$5" ]]; then operations="$(deployment_image_id "$5")" || return 1; fi
  (umask 077; printf '%s %s %s %s\n' "${revision}" "${web}" "${api}" "${operations}" > "${receipt}.tmp") || return 1
  mv "${receipt}.tmp" "${receipt}"
}
