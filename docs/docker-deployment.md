# Production Docker, Traefik, Nginx and Let's Encrypt

This production stack is designed for the OVH VPS configured through `VPS_HOST` on Ubuntu 24.04 LTS.

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
FUNDING_BUSINESS_SPONSORSHIP_ENABLED=false
FUNDING_API_PORT=3333
FUNDING_PROJECT_ID=openg7
FUNDING_ADMIN_TOKEN=replace_with_a_long_random_admin_token
FUNDING_ADMIN_SESSION_SECRET=replace_with_a_different_long_random_session_secret
FUNDING_ADMIN_SESSION_TTL_MINUTES=60
SMTP_ENABLED=true
SMTP_HOST=mail.papamail.net
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=notify@openg7.org
SMTP_PASSWORD=replace_with_private_smtp_password
MAIL_FROM_NAME=OpenG7
MAIL_FROM_ADDRESS=notify@openg7.org
MAIL_REPLY_TO_NAME=OpenG7
MAIL_REPLY_TO_ADDRESS=contact@openg7.org
FUNDING_ADMIN_NOTIFICATION_EMAIL=contact@openg7.org
SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3
FUNDING_SPONSOR_LOGO_STORAGE_DIR=/app/var/sponsor-logos
FUNDING_SPONSOR_LOGO_MAX_BYTES=524288
SPONSOR_MEDIA_REGION=bhs
SPONSOR_MEDIA_ENDPOINT=https://s3.bhs.io.cloud.ovh.net
SPONSOR_MEDIA_PUBLIC_BUCKET=openg7-funding-sponsor-media-public-prod
SPONSOR_MEDIA_PUBLIC_BASE_URL=https://openg7-funding-sponsor-media-public-prod.s3.bhs.io.cloud.ovh.net
SPONSOR_MEDIA_PRIVATE_BUCKET=openg7-funding-sponsor-media-private-prod
SPONSOR_MEDIA_PRIVATE_BASE_URL=https://openg7-funding-sponsor-media-private-prod.s3.bhs.io.cloud.ovh.net
OVH_S3_ACCESS_KEY_ID=
OVH_S3_SECRET_ACCESS_KEY=
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

docker compose --profile database exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  < apps/funding-api/migrations/003_add_sponsorship_details.sql

docker compose --profile database exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  < apps/funding-api/migrations/004_add_sponsorship_review.sql

docker compose --profile database exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  < apps/funding-api/migrations/005_add_sponsorship_followup_token.sql

docker compose --profile database exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  < apps/funding-api/migrations/006_add_sponsorship_publication_feed.sql

docker compose --profile database exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  < apps/funding-api/migrations/007_add_admin_audit_and_publication_drafts.sql
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
ssh -L 8081:127.0.0.1:8081 "${VPS_USER:-ubuntu}@${VPS_HOST}"
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
- API in-process rate limits for checkout, sponsorship follow-up, and admin sponsorship routes
- API checkout amount allow-list
- API checkout return URL validation
- API sponsorship follow-up tokens are hashed at rest, expire by configuration, and are removed from the browser URL after page load
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

Manual rollback on the VPS:

```bash
bash scripts/rollback.sh
```

Manual rollback from a workstation:

```bash
yarn vps:rollback
```

This rolls back only the `web` and `api` application images. It does not restore
PostgreSQL data. Restore a database backup separately if a database migration
must also be reverted.

## Validation

Run:

```bash
bash scripts/check.sh
```

Also verify the public usage and refund policy routes:

```text
https://openg7.org/politique-utilisation-remboursement
https://openg7.org/en/politique-utilisation-remboursement
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

Database and backup shortcuts are available from `package.json`:

```bash
yarn db:migrate
yarn db:backup
yarn db:restore --config-backup /path/to/openg7-backup-YYYYMMDDTHHMMSSZ.tar.gz --database-dump /path/to/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql
```

`yarn db:migrate` starts the private PostgreSQL service if needed, waits for it
to become ready, then applies every SQL file in
`apps/funding-api/migrations` in filename order. New database migrations must
be committed as `.sql` files in that directory.

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

If private PostgreSQL is enabled through `DATABASE_URL`, `scripts/backup.sh`
also writes a consistent database dump while PostgreSQL is running:

```text
backups/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql
```

If the `openg7-sponsor-logos` Docker volume exists, the same script also writes:

```text
backups/openg7-sponsor-logos-YYYYMMDDTHHMMSSZ.tar.gz
```

Store both the configuration archive and the database dump outside the VPS as
private secrets. The database may contain Stripe event payloads, sponsorship
follow-up data, and admin review data.

When `SPONSOR_MEDIA_STORAGE_DRIVER=local`, uploaded sponsor logos are stored in
the `openg7-sponsor-logos` Docker volume mounted at `/app/var/sponsor-logos` in
the API container. Store sponsor logo volume archives with the configuration and
database backups whenever local sponsor logo uploads are enabled.

When `SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3`, uploaded controlled sponsor logos
are stored in the OVH private bucket. The API still serves
`/api/public/sponsor-logos/<file>` only after database approval, so the browser
never receives OVH credentials and the private bucket remains anonymous-private.
Run `npm run storage:check` and `npm run storage:test` after changing the OVH
storage configuration.

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

If private PostgreSQL is enabled and you need to rebuild from a clean database
volume, use the restore helper with the configuration archive and the database
dump:

```bash
cd /opt/openg7-funding-platform
bash scripts/restore-from-backup.sh \
  --config-backup /path/to/openg7-backup-YYYYMMDDTHHMMSSZ.tar.gz \
  --database-dump /path/to/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql \
  --sponsor-logos-backup /path/to/openg7-sponsor-logos-YYYYMMDDTHHMMSSZ.tar.gz
```

The script stops the stack, removes the `openg7-postgres-data` Docker volume,
recreates PostgreSQL, imports the dump, optionally restores the
`openg7-sponsor-logos` Docker volume when `--sponsor-logos-backup` is provided,
starts the full stack, and runs `scripts/check.sh`. It asks for a typed
confirmation before deleting volumes; add `--force` only for a confirmed
emergency automation run.

The dump created by `scripts/backup.sh` includes schema and data, so the restore
script does not run migrations before importing it into an empty restored
database.

## GitHub Actions CI/CD

Workflow:

```text
.github/workflows/deploy.yml
```

Required GitHub secrets:

```text
VPS_HOST=<production VPS host>
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
ssh -L 8082:127.0.0.1:8082 "${VPS_USER:-ubuntu}@${VPS_HOST}"
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
docker compose config | grep -E "APP_DOMAIN|FUNDING_PUBLIC_BASE_URL|FUNDING_ALLOWED_ORIGINS|FUNDING_SPONSOR_LOGO|SPONSOR_MEDIA_|OVH_S3_|STRIPE_SECRET_KEY"
```

Most startup loops come from missing production variables in `.env`, especially:

```env
APP_DOMAIN=openg7.org
FUNDING_PUBLIC_BASE_URL=https://openg7.org
FUNDING_ALLOWED_ORIGINS=https://openg7.org,https://www.openg7.org
FUNDING_ADMIN_TOKEN=replace_with_a_long_random_admin_token
FUNDING_ADMIN_SESSION_SECRET=replace_with_a_different_long_random_session_secret
SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3
SPONSOR_MEDIA_REGION=bhs
SPONSOR_MEDIA_ENDPOINT=https://s3.bhs.io.cloud.ovh.net
SPONSOR_MEDIA_PRIVATE_BUCKET=openg7-funding-sponsor-media-private-prod
FUNDING_SPONSOR_LOGO_STORAGE_DIR=/app/var/sponsor-logos
FUNDING_SPONSOR_LOGO_MAX_BYTES=524288
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
