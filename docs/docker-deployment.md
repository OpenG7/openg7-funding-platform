# Production Docker, Traefik, Nginx and Let's Encrypt

This production stack is designed for the OVH VPS `vps-8db0cb49.vps.ovh.ca` on Ubuntu 24.04 LTS.

The public application URL is:

```text
https://openg7.org
```

Stripe webhook URL:

```text
https://openg7.org/api/stripe/webhook
```

## Project Structure

```text
project/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── apps/
│   ├── funding-api/
│   │   ├── Dockerfile
│   │   └── src/
│   └── funding-web/
│       ├── Dockerfile
│       ├── nginx.conf
│       └── src/
├── backups/
├── docs/
│   └── docker-deployment.md
├── packages/
├── scripts/
│   ├── backup.sh
│   ├── check.sh
│   ├── deploy.sh
│   ├── install-vps.sh
│   └── renew-certs.sh
├── traefik/
│   ├── acme/
│   │   └── .gitkeep
│   ├── dynamic.yml
│   └── traefik.yml
├── .dockerignore
├── .env
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
└── yarn.lock
```

## Services

- `traefik`: public reverse proxy, HTTP to HTTPS redirect, Let's Encrypt, HTTP/2, HTTP/3, security headers, rate limits.
- `web`: Angular static app served by Nginx unprivileged.
- `api`: Node funding API for checkout, public transparency, and Stripe webhooks.
- `cadvisor`: local-only Docker metrics on `127.0.0.1:8082`.

## Environment

Create the real environment file:

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Production values:

```env
APP_DOMAIN=openg7.org
LETSENCRYPT_EMAIL=your-email@example.com
TRAEFIK_DASHBOARD_BIND=127.0.0.1:8081
CADVISOR_BIND=127.0.0.1:8082
WEB_IMAGE=openg7-funding-web:local
API_IMAGE=openg7-funding-api:local
FUNDING_PLATFORM_ENV=production
FUNDING_PLATFORM_API_BASE_URL=https://openg7.org/api
FUNDING_PUBLIC_BASE_URL=https://openg7.org
FUNDING_ALLOWED_ORIGINS=https://openg7.org,https://www.openg7.org
FUNDING_ALLOWED_AMOUNTS=5,10,25,50
FUNDING_API_PORT=3333
FUNDING_PROJECT_ID=openg7
STRIPE_SECRET_KEY=sk_live_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
# Optional private PostgreSQL. Leave unset for Stripe-direct transparency.
# POSTGRES_DB=openg7_funding
# POSTGRES_USER=openg7_funding
# POSTGRES_PASSWORD=replace_with_a_long_random_secret
# DATABASE_URL=postgres://openg7_funding:replace_with_a_long_random_secret@postgres:5432/openg7_funding
BACKUP_DIR=./backups
```

## First VPS Installation

Run on Ubuntu 24.04 LTS:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/OpenG7/openg7-funding-platform.git
cd openg7-funding-platform
sudo bash scripts/install-vps.sh
cp .env.example .env
nano .env
bash scripts/deploy.sh
```

Single command after `.env` is configured:

```bash
bash scripts/deploy.sh
```

## Optional Private PostgreSQL

The platform can still launch without PostgreSQL. Leave `DATABASE_URL` unset to keep the Stripe-direct transparency fallback.

To enable the private PostgreSQL MVP:

1. Set these values in `.env`:

```env
POSTGRES_DB=openg7_funding
POSTGRES_USER=openg7_funding
POSTGRES_PASSWORD=replace_with_a_long_random_secret
DATABASE_URL=postgres://openg7_funding:replace_with_a_long_random_secret@postgres:5432/openg7_funding
```

2. Start PostgreSQL on the private Compose network:

```bash
docker compose --profile database up -d postgres
```

3. Apply migrations from the host:

```bash
docker compose --profile database exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  < apps/funding-api/migrations/001_create_fund_transparency_tables.sql

docker compose --profile database exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  < apps/funding-api/migrations/002_create_fundraiser_mvp_tables.sql
```

4. Restart the API:

```bash
docker compose up -d api
```

Security notes:

- `postgres` is only attached to the internal `openg7-data` network.
- No `5432` port is published on the host.
- The browser never receives `DATABASE_URL`.
- If `DATABASE_URL` is absent, the API keeps the Stripe-direct fallback.

## DNS

The hostname must resolve publicly to the VPS IPv4/IPv6 before Traefik can obtain a certificate:

```bash
getent hosts openg7.org
```

Ports required:

- TCP 80
- TCP 443
- UDP 443 for HTTP/3
- SSH 22

## HTTPS and Certificates

Traefik uses Let's Encrypt HTTP-01 challenge:

- Static config: `traefik/traefik.yml`
- Dynamic routes, services, middlewares, and TLS policy: `traefik/dynamic.yml`
- Persistent ACME store: `traefik/acme/acme.json`

Create secure ACME storage:

```bash
mkdir -p traefik/acme
touch traefik/acme/acme.json
chmod 600 traefik/acme/acme.json
```

Verify certificate:

```bash
echo | openssl s_client -servername openg7.org -connect openg7.org:443 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

Traefik renews certificates automatically. The helper script checks expiry and reloads Traefik when renewal is near:

```bash
bash scripts/renew-certs.sh
```

Suggested cron:

```bash
0 3 * * * cd /opt/openg7-funding-platform && bash scripts/renew-certs.sh >> /var/log/openg7-renew.log 2>&1
```

## Traefik Dashboard

The dashboard is local-only:

```text
http://127.0.0.1:8081/dashboard/
```

Use an SSH tunnel from your workstation:

```bash
ssh -L 8081:127.0.0.1:8081 ubuntu@vps-8db0cb49.vps.ovh.ca
```

Then open:

```text
http://127.0.0.1:8081/dashboard/
```

## Security

Applied:

- HTTP to HTTPS redirect
- TLS 1.2 and TLS 1.3 only
- HSTS with preload
- CSP
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- Traefik rate limits
- Nginx `client_max_body_size 256k`
- API body limit
- API checkout amount allow-list
- API checkout return URL validation
- Stripe webhook signature verification
- Docker `no-new-privileges`
- Nginx unprivileged container
- API service not directly published
- Traefik routes are declared through the file provider, so the Docker socket is not mounted into Traefik
- Traefik dashboard and cAdvisor bound to localhost only

## Deployment

Local build on VPS:

```bash
bash scripts/deploy.sh
```

Registry deployment:

```bash
WEB_IMAGE=ghcr.io/openg7/openg7-funding-platform-web:latest \
API_IMAGE=ghcr.io/openg7/openg7-funding-platform-api:latest \
bash scripts/deploy.sh --no-build
```

Rollback:

The deployment script tags currently running images as:

```text
openg7-funding-web:rollback
openg7-funding-api:rollback
```

If validation fails, it attempts to redeploy these rollback images.

## Validation

Run:

```bash
bash scripts/check.sh
```

It verifies:

- Docker
- Compose
- containers
- DNS
- HTTP
- HTTPS
- certificate issuer and expiry
- Angular shell
- API public transparency
- Traefik local dashboard
- cAdvisor local metrics

## Backup

Run:

```bash
bash scripts/backup.sh
```

Backups include:

- Compose config
- `.env`
- Dockerfiles
- Nginx config
- Traefik config
- ACME certificates
- scripts
- docs

If private PostgreSQL is enabled, also export a database dump before or after the filesystem backup:

```bash
mkdir -p backups
docker compose --profile database exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  > "backups/openg7-funding-db-$(date -u +%Y%m%dT%H%M%SZ).sql"
chmod 600 backups/openg7-funding-db-*.sql
```

Suggested cron:

```bash
30 3 * * * cd /opt/openg7-funding-platform && bash scripts/backup.sh >> /var/log/openg7-backup.log 2>&1
```

## Restore

```bash
mkdir -p /opt/openg7-funding-platform
cd /opt/openg7-funding-platform
tar -xzf /path/to/openg7-backup-YYYYMMDDTHHMMSSZ.tar.gz
chmod 600 .env traefik/acme/acme.json
docker compose up -d
bash scripts/check.sh
```

## GitHub Actions CI/CD

Workflow:

```text
.github/workflows/deploy.yml
```

Required GitHub secrets:

```text
VPS_HOST=vps-8db0cb49.vps.ovh.ca
VPS_USER=ubuntu
VPS_SSH_KEY=<private SSH key>
VPS_APP_DIR=/opt/openg7-funding-platform
PRODUCTION_ENV=<full .env content>
GHCR_PAT=<GitHub token with read:packages for the VPS pull>
```

The workflow:

1. Installs dependencies.
2. Runs lint.
3. Builds TypeScript.
4. Builds Angular.
5. Runs tests.
6. Builds Docker images.
7. Pushes images to GHCR.
8. Deploys to the VPS via SSH.
9. Runs production validation.
10. Lets `scripts/deploy.sh` rollback on failure.

## Logs and Metrics

Traefik logs are JSON:

```bash
docker compose logs -f traefik
```

Nginx logs are JSON:

```bash
docker compose logs -f web
```

API logs:

```bash
docker compose logs -f api
```

Docker metrics:

```bash
ssh -L 8082:127.0.0.1:8082 ubuntu@vps-8db0cb49.vps.ovh.ca
```

Open:

```text
http://127.0.0.1:8082
```

## Troubleshooting

Check containers:

```bash
docker compose ps
```

If the API restarts in a loop:

```bash
docker compose logs --tail=100 api
docker compose config | grep -E "APP_DOMAIN|FUNDING_PUBLIC_BASE_URL|FUNDING_ALLOWED_ORIGINS|STRIPE_SECRET_KEY"
```

Most startup loops come from missing production variables in `.env`, especially:

```env
APP_DOMAIN=openg7.org
FUNDING_PUBLIC_BASE_URL=https://openg7.org
FUNDING_ALLOWED_ORIGINS=https://openg7.org,https://www.openg7.org
STRIPE_SECRET_KEY=sk_live_or_test_key
```

Check Traefik:

```bash
docker compose logs --tail=200 traefik
```

Check certificate:

```bash
echo | openssl s_client -servername openg7.org -connect openg7.org:443 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

Check routes:

```bash
curl -I https://openg7.org
curl -I https://openg7.org/health
curl -I https://openg7.org/api/public/fund-transparency
```

If Let's Encrypt fails:

1. Confirm DNS resolves to the VPS.
2. Confirm ports 80 and 443 are open in OVH firewall and UFW.
3. Confirm `LETSENCRYPT_EMAIL` is valid.
4. Check `docker compose logs traefik`.
5. Remove only invalid staging/test certificates if needed:

```bash
docker compose down
rm -f traefik/acme/acme.json
touch traefik/acme/acme.json
chmod 600 traefik/acme/acme.json
docker compose up -d
```
