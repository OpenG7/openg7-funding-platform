# SMTP Transactional Email

OpenG7 uses SMTP only for low-volume transactional email.

## Roles

```text
notify@openg7.org
-> automated transactional email and SMTP authentication

contact@openg7.org
-> human replies and support
```

Default message identity:

```text
From: OpenG7 <notify@openg7.org>
Reply-To: OpenG7 <contact@openg7.org>
```

Application code never accepts a user-controlled `From` value.

## Local Configuration

Add SMTP values to the private `.env` file. Do not commit real secrets.

```dotenv
SMTP_ENABLED=true
SMTP_HOST=mail.papamail.net
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=notify@openg7.org
SMTP_PASSWORD=...
SMTP_CONNECTION_TIMEOUT_MS=10000
SMTP_GREETING_TIMEOUT_MS=10000
SMTP_SOCKET_TIMEOUT_MS=20000

MAIL_FROM_NAME=OpenG7
MAIL_FROM_ADDRESS=notify@openg7.org
MAIL_REPLY_TO_NAME=OpenG7
MAIL_REPLY_TO_ADDRESS=contact@openg7.org
FUNDING_ADMIN_NOTIFICATION_EMAIL=contact@openg7.org
FUNDING_ADMIN_REVIEW_REMINDER_ENABLED=true
FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS=1
FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS=3600000
FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS=5
```

When `SMTP_ENABLED=false`, the API starts without `SMTP_PASSWORD`. Queued
messages are not sent and are reported with `deliveryMode=disabled`.

## Admin Reminders

`FUNDING_ADMIN_NOTIFICATION_EMAIL` receives internal operational notifications.
The API sends a sponsorship review reminder when all of these are true:

- SMTP is enabled;
- PostgreSQL and the `email_messages` queue are available;
- `FUNDING_ADMIN_REVIEW_REMINDER_ENABLED=true`;
- at least one paid sponsorship has a complete fiche and still has
  `sponsor_review_status=pending_review`;
- the fiche has waited at least
  `FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS`.

The reminder uses an idempotency key based on the UTC date, so a matching
sponsorship backlog creates at most one admin reminder per day. It only lists
public references, amounts, submission dates and wait age; it does not expose
sponsor contact emails or private notes. The message is informational and never
approves, refuses, refunds or publishes anything.

## Verify The Connection

This command verifies only the SMTP connection. It does not send a message.

```bash
npm run email:verify
```

Expected success:

```text
SMTP configuration loaded.
SMTP connection verified successfully for notify@openg7.org.
```

## Send A Manual Test

The recipient must be explicit.

```bash
npm run email:test -- --to=adresse@example.com
```

The test message subject is `Test SMTP OpenG7` and includes both text and HTML
bodies. The command prints the `messageId` when SMTP accepts the message.

## Docker And VPS

The production VPS should provide SMTP values through the private `.env` file,
Docker Compose environment, Docker secrets, or a secret manager. The repository
must never contain the real SMTP password.

Exact VPS flow:

```bash
cd /opt/openg7-funding-platform
nano .env
chmod 600 .env
docker compose up -d --build api
docker compose exec api node dist/apps/funding-api/src/email-verify.cli.js
docker compose exec api node dist/apps/funding-api/src/email-test.cli.js --to=adresse@example.com
```

Minimum private VPS values:

```dotenv
SMTP_ENABLED=true
SMTP_HOST=mail.papamail.net
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=notify@openg7.org
SMTP_PASSWORD=replace_with_private_hostpapa_password
MAIL_FROM_NAME=OpenG7
MAIL_FROM_ADDRESS=notify@openg7.org
MAIL_REPLY_TO_NAME=OpenG7
MAIL_REPLY_TO_ADDRESS=contact@openg7.org
```

The API Docker image does not copy `.env`. `.dockerignore` excludes `.env` and
`.env.*` while preserving `.env.example`.

## Deliverability

Verify these DNS records separately in the `openg7.org` DNS zone using the
official values supplied by HostPapa:

```text
SPF
DKIM
DMARC
```

Do not change DNS automatically without the official HostPapa values.

## Manual Checklist

```text
[ ] Mot de passe de notify@openg7.org ajoute au .env prive du VPS
[ ] SMTP_ENABLED=true en production
[ ] Verification SMTP reussie depuis le conteneur API
[ ] Message de test recu
[ ] Reply-To redirige vers contact@openg7.org
[ ] SPF verifie
[ ] DKIM verifie
[ ] DMARC verifie
[ ] Aucun secret present dans Git
```
