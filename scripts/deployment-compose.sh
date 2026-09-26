#!/usr/bin/env bash
# Source after load-env.sh. The switch is explicit; credentials alone never enable a worker.
case "${FUNDING_OPERATIONS_WATCHER_ENABLED:-false}" in
  true|false) ;;
  *) echo 'Invalid FUNDING_OPERATIONS_WATCHER_ENABLED (true/false).' >&2; return 1 ;;
esac
compose() {
  local args=()
  if [[ "${FUNDING_OPERATIONS_WATCHER_ENABLED:-false}" == true ]]; then
    args+=(-f docker-compose.yml -f docker-compose.operations.yml)
  fi
  if [[ -n "${DATABASE_URL:-}" ]]; then args+=(--profile database); fi
  docker compose "${args[@]}" "$@"
}
