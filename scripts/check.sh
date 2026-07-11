#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source scripts/load-env.sh .env
fi

APP_DOMAIN="${APP_DOMAIN:-openg7.org}"
HTTPS_URL="https://${APP_DOMAIN}"
POSTGRES_DB="${POSTGRES_DB:-openg7_funding}"
POSTGRES_USER="${POSTGRES_USER:-openg7_funding}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "OK: $*"
}

compose() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    docker compose --profile database "$@"
  else
    docker compose "$@"
  fi
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose plugin is not installed"
pass "Docker and Compose are installed"

compose ps --services --filter status=running | grep -qx "traefik" || fail "traefik is not running"
compose ps --services --filter status=running | grep -qx "web" || fail "web is not running"
compose ps --services --filter status=running | grep -qx "api" || fail "api is not running"
pass "Required containers are running"

if [[ -n "${DATABASE_URL:-}" ]]; then
  compose ps --services --filter status=running | grep -qx "postgres" || fail "postgres is not running while DATABASE_URL is configured"

  for _ in $(seq 1 30); do
    if compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
      pass "PostgreSQL is ready"
      break
    fi

    sleep 2
  done

  compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1 ||
    fail "PostgreSQL did not become ready"
fi

getent hosts "${APP_DOMAIN}" >/dev/null || fail "DNS does not resolve ${APP_DOMAIN}"
pass "DNS resolves ${APP_DOMAIN}"

curl -fsS "http://${APP_DOMAIN}/health" >/dev/null || fail "HTTP health endpoint failed"
curl -fsS "${HTTPS_URL}/health" >/dev/null || fail "HTTPS health endpoint failed"
ANGULAR_SHELL="$(curl -fsS "${HTTPS_URL}/")" || fail "Angular shell was not served"
grep -qi "<html" <<<"${ANGULAR_SHELL}" || fail "Angular shell was not served"
curl -fsS "${HTTPS_URL}/api/public/fund-transparency" >/dev/null || fail "API public transparency endpoint failed"
pass "HTTP, HTTPS, Angular, and API checks passed"

CERT_INFO="$(echo | openssl s_client -servername "${APP_DOMAIN}" -connect "${APP_DOMAIN}:443" 2>/dev/null | openssl x509 -noout -issuer -subject -dates)"
echo "${CERT_INFO}"
echo "${CERT_INFO}" | grep -qi "Let's Encrypt" || fail "Certificate issuer is not Let's Encrypt"

EXPIRY_EPOCH="$(echo | openssl s_client -servername "${APP_DOMAIN}" -connect "${APP_DOMAIN}:443" 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2 | xargs -I{} date -d "{}" +%s)"
NOW_EPOCH="$(date +%s)"
DAYS_LEFT="$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))"
[[ "${DAYS_LEFT}" -gt 14 ]] || fail "Certificate expires too soon: ${DAYS_LEFT} days left"
pass "TLS certificate is valid for ${DAYS_LEFT} days"

curl -fsS http://127.0.0.1:8081/dashboard/ >/dev/null || fail "Local Traefik dashboard is not reachable on 127.0.0.1:8081"
pass "Local Traefik dashboard is reachable"

if curl -fsS http://127.0.0.1:8082/containers/ >/dev/null; then
  pass "cAdvisor Docker metrics are reachable on 127.0.0.1:8082"
else
  echo "WARN: cAdvisor metrics are not reachable"
fi

echo "All production checks passed."
