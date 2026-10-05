#!/usr/bin/env bash
# Source after load-env.sh. The switch is explicit; credentials alone never enable a worker.
case "${FUNDING_OPERATIONS_WATCHER_ENABLED:-false}" in
  true|false) ;;
  *) echo 'Invalid FUNDING_OPERATIONS_WATCHER_ENABLED (true/false).' >&2; return 1 ;;
esac
case "${FUNDING_KEYCLOAK_ENABLED-false}" in
  true)
    [[ -z "${COMPOSE_FILE:-}" ]] || {
      echo 'Managed Keycloak activation cannot be combined with COMPOSE_FILE.' >&2; return 1;
    }
    FUNDING_KEYCLOAK_ENABLED=true node scripts/keycloak-config.mjs --check >/dev/null || return 1
    ;;
  false) ;;
  *) echo 'Invalid FUNDING_KEYCLOAK_ENABLED (true/false).' >&2; return 1 ;;
esac
compose() {
  local args=()
  if [[ "${FUNDING_OPERATIONS_WATCHER_ENABLED:-false}" == true || "${FUNDING_KEYCLOAK_ENABLED:-false}" == true ]]; then
    args+=(-f docker-compose.yml)
    if [[ "${FUNDING_OPERATIONS_WATCHER_ENABLED:-false}" == true ]]; then args+=(-f docker-compose.operations.yml); fi
    if [[ "${FUNDING_KEYCLOAK_ENABLED:-false}" == true ]]; then args+=(-f docker-compose.identity.yml); fi
  fi
  if [[ -n "${DATABASE_URL:-}" ]]; then args+=(--profile database); fi
  docker compose "${args[@]}" "$@"
}

# Identity image/database upgrades have a separate backup and lifecycle.
# Application delivery keeps the overlay mounted without rebuilding identity.
application_services() {
  APPLICATION_SERVICES=(traefik api web cadvisor)
  if [[ -n "${DATABASE_URL:-}" ]]; then APPLICATION_SERVICES+=(postgres); fi
  if [[ "${FUNDING_OPERATIONS_WATCHER_ENABLED:-false}" == true ]]; then APPLICATION_SERVICES+=(operations); fi
}
