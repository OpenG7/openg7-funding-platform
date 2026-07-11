#!/usr/bin/env bash

load_env_file() {
  local env_file="${1:-.env}"

  [[ -f "${env_file}" ]] || return 0

  if LC_ALL=C grep -q $'\r' "${env_file}"; then
    sed -i 's/\r$//' "${env_file}"
  fi

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
}

load_env_file "${1:-.env}"
