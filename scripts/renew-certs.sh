#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

APP_DOMAIN="${APP_DOMAIN:-openg7.org}"
THRESHOLD_DAYS="${CERT_RENEWAL_THRESHOLD_DAYS:-30}"

EXPIRY_EPOCH="$(echo | openssl s_client -servername "${APP_DOMAIN}" -connect "${APP_DOMAIN}:443" 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2 | xargs -I{} date -d "{}" +%s)"
NOW_EPOCH="$(date +%s)"
DAYS_LEFT="$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))"

echo "Certificate for ${APP_DOMAIN} expires in ${DAYS_LEFT} days."

if [[ "${DAYS_LEFT}" -le "${THRESHOLD_DAYS}" ]]; then
  echo "Reloading Traefik to force ACME renewal check..."
  docker compose kill -s HUP traefik || docker compose restart traefik
  sleep 10
fi

bash scripts/check.sh
