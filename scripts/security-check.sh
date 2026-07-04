#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${APP_DOMAIN:-openg7.org}"
BASE_URL="${FUNDING_PUBLIC_BASE_URL:-https://${DOMAIN}}"
COMPOSE="${COMPOSE_COMMAND:-docker compose}"

env_value() {
  [ -f .env ] || return 0
  awk -v key="$1" '
    $0 ~ "^[[:space:]]*#" { next }
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      first = substr(value, 1, 1)
      last = substr(value, length(value), 1)
      if ((first == "\"" && last == "\"") || (first == "\047" && last == "\047")) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit
    }
  ' .env
}

if [ -f .env ]; then
  ENV_DOMAIN="$(env_value APP_DOMAIN)"
  ENV_BASE_URL="$(env_value FUNDING_PUBLIC_BASE_URL)"
  ENV_TRAEFIK_DASHBOARD_BIND="$(env_value TRAEFIK_DASHBOARD_BIND)"
  ENV_CADVISOR_BIND="$(env_value CADVISOR_BIND)"
  DOMAIN="${APP_DOMAIN:-${ENV_DOMAIN:-$DOMAIN}}"
  BASE_URL="${FUNDING_PUBLIC_BASE_URL:-${ENV_BASE_URL:-https://${DOMAIN}}}"
  TRAEFIK_DASHBOARD_BIND="${TRAEFIK_DASHBOARD_BIND:-${ENV_TRAEFIK_DASHBOARD_BIND:-127.0.0.1:8081}}"
  CADVISOR_BIND="${CADVISOR_BIND:-${ENV_CADVISOR_BIND:-127.0.0.1:8082}}"
fi

ok() {
  printf '[OK] %s\n' "$1"
}

warn() {
  printf '[WARN] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1"
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Commande manquante: $1"
}

header_value() {
  printf '%s\n' "$HEADERS" | awk -v key="$1" 'BEGIN{IGNORECASE=1} $0 ~ "^" key ":" {sub("^[^:]+:[[:space:]]*", ""); sub("\r$", ""); print; exit}'
}

need_command docker
need_command curl
need_command openssl
need_command awk

ok "Commandes Docker, curl et OpenSSL disponibles"

$COMPOSE config >/dev/null
ok "Configuration Docker Compose valide"

$COMPOSE ps

RUNNING="$($COMPOSE ps --status running --services | sort | tr '\n' ' ')"
for service in traefik web api; do
  printf '%s' "$RUNNING" | grep -Eq "(^| )${service}( |$)" || fail "Service non démarré: ${service}"
done
ok "Services principaux démarrés"

case "${TRAEFIK_DASHBOARD_BIND:-127.0.0.1:8081}" in
  127.0.0.1:*|localhost:*) ok "Dashboard Traefik limité à localhost" ;;
  *) warn "Dashboard Traefik possiblement exposé: ${TRAEFIK_DASHBOARD_BIND:-127.0.0.1:8081}" ;;
esac

case "${CADVISOR_BIND:-127.0.0.1:8082}" in
  127.0.0.1:*|localhost:*) ok "cAdvisor limité à localhost" ;;
  *) warn "cAdvisor possiblement exposé: ${CADVISOR_BIND:-127.0.0.1:8082}" ;;
esac

HEADERS="$(curl -fsSIL --max-time 15 "$BASE_URL" || true)"
[ -n "$HEADERS" ] || fail "Impossible de lire les headers: $BASE_URL"

for header in strict-transport-security x-content-type-options x-frame-options referrer-policy permissions-policy content-security-policy; do
  value="$(header_value "$header")"
  [ -n "$value" ] || fail "Header manquant: $header"
done
ok "Headers de sécurité présents"

HEALTH_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 15 "${BASE_URL}/health" || true)"
[ "$HEALTH_CODE" = "200" ] || fail "Healthcheck web invalide: HTTP ${HEALTH_CODE}"
ok "Healthcheck web OK"

API_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 15 "${BASE_URL}/api/public/fund-transparency" || true)"
[ "$API_CODE" = "200" ] || fail "Endpoint API transparence invalide: HTTP ${API_CODE}"
ok "Endpoint API public OK"

CERT_INFO="$(echo | openssl s_client -servername "$DOMAIN" -connect "${DOMAIN}:443" 2>/dev/null | openssl x509 -noout -issuer -subject -dates)"
[ -n "$CERT_INFO" ] || fail "Certificat TLS introuvable pour ${DOMAIN}"
printf '%s\n' "$CERT_INFO"
ok "Certificat TLS lisible"

if [ -f .env ]; then
  PERM="$(stat -c '%a' .env 2>/dev/null || true)"
  case "$PERM" in
    600|640) ok "Permissions .env correctes (${PERM})" ;;
    "") warn "Impossible de lire les permissions .env sur cette plateforme" ;;
    *) warn "Permissions .env trop ouvertes (${PERM}); recommandé: chmod 600 .env" ;;
  esac
fi

if [ -f traefik/acme/acme.json ]; then
  PERM="$(stat -c '%a' traefik/acme/acme.json 2>/dev/null || true)"
  case "$PERM" in
    600) ok "Permissions ACME correctes (${PERM})" ;;
    "") warn "Impossible de lire les permissions ACME sur cette plateforme" ;;
    *) warn "Permissions ACME trop ouvertes (${PERM}); recommandé: chmod 600 traefik/acme/acme.json" ;;
  esac
fi

if command -v ufw >/dev/null 2>&1; then
  ufw status || true
else
  warn "ufw non installé ou indisponible; vérifier le pare-feu OVH/VPS manuellement"
fi

ok "Contrôle sécurité terminé"
