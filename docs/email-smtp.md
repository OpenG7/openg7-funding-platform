# SMTP Transactional Email

OpenG7 uses SMTP only for low-volume transactional email.

SMTP delivers queued follow-up/recovery links, invoices, credit notes and admin
notifications. A queued or SMTP-accepted message is not proof of inbox delivery;
see the [controlled rehearsal](operations/integration-rehearsal.md). Independent
failure alerts use a separate [signed webhook watcher](operations/admin-identity-and-alerts.md)
so they do not rely on this SMTP service.

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

`FUNDING_EMAIL_WORKER_ENABLED=false` pauses background queue claims at API startup
and during polling, preserving statuses, attempts and retry dates. This private
server setting defaults to `true`; an invalid boolean prevents startup. Restart
the API after changing it. SMTP-disabled mode alone still records failed attempts.
Explicit authorized test/retry commands can still attempt delivery; the switch
does not pause contribution notifications, reminders or social workers. See the
[recovery procedure](operations/backup-recovery.md) before resuming a restored queue.

## Failed messages and concurrent retries

The persistent queue retains the message, recipient, attempts, next attempt and
safe error code. Automatic retries wait one minute after the first failure,
then use exponential backoff, capped at one hour and the message's attempt limit.
Restarting the API preserves this schedule.

An administrator can confirm an individual retry from the email queue. The retry
claims the message atomically before calling SMTP, including when overriding the
automatic attempt limit. An active send cannot be reclaimed by a second admin or
the worker. Concurrent requests return zero attempts with the current message;
the UI identifies an ongoing delivery and offers refresh. Already sent messages
cannot be retried. Requests retain the existing authorization and audit trail.

The existing recovery of a `sending` claim older than 15 minutes remains in place.
This is not an exactly-once SMTP guarantee: loss of the final acknowledgement or
a crash after provider acceptance can still leave an ambiguous result. The
[recovery recipe](sponsorship-access-and-drafts.md#recette-complete-courriel-en-echec-et-reprise-du-dossier)
qualifies definite failures before SMTP acceptance and concurrent active claims.

The isolated acceptance stack routes SMTP through a test-only TCP gate to Mailpit.
`/__test__/smtp` on the fixture selects normal forwarding, a rejected greeting,
or a held connection. It records connection counts without message bodies or
credentials. `/__test__/mail/<id>` exposes a captured synthetic message for the
browser recipe. These controls belong only to the test image; SMTP has no host
port, and the existing fixture HTTP port is bound to loopback.

## Admin Configuration Test

From `/admin/fundraiser/setup`, an owner can send a test to an explicit address
or the configured admin notification address. Configuration readiness does not
verify SMTP connectivity. The UI distinguishes `queued`, `sending`, `failed` and
`sent`; `sent` means accepted by SMTP, not delivered to an inbox. A link opens
the exact message in the email queue for investigation and confirmed retry.

`POST /api/admin/email/test` requires JSON `{ requestId, to? }`, with a UUID v4.
The request is bound to its actor and resolved recipient. Its queue insertion and
`email.test.queued` audit are one transaction, before any SMTP attempt. Concurrent
or repeated requests return the existing state and never attempt delivery again,
including after a failure's backoff expires. A changed recipient or actor for the
same request returns `409 EMAIL_TEST_CONFLICT`.

`GET /api/admin/email/test?requestId=<uuid>` retrieves only the calling owner's
test, without sending, retrying or auditing another command. It returns
`requestId`, `messageId`, `to`, `status`, `queued`, `attempted`, `sent`, `error` and
`deliveryMode`. `attempted` indicates a persisted attempt, not necessarily an
attempt made by this HTTP call. Missing or other-actor requests return
`404 EMAIL_TEST_NOT_FOUND`. Invalid input returns 400, non-JSON POST returns 415,
and persistence failure returns `503 EMAIL_TEST_UNAVAILABLE`. Unauthenticated,
expired and insufficient-role requests are refused; mutation origins are checked.
Both `/api/admin/...` and `/admin/...` aliases share these checks. Configuration
and test responses carry `Cache-Control: private, no-store`.

After a lost response, **Check test result** performs GET. Reloading restores only
the request identifier from session storage, scoped to the admin account; no
recipient or SMTP secret is stored there. A new test is blocked until the result
is checked. If no request is found, a submission reuses that identifier. Confirmed
results allow an explicitly new test; changing the recipient clears the previous
result. Failure explanations survive configuration refresh, and expired sessions
clear private data. Session storage must be available before starting a test.

Update API and Web together: older clients without `requestId` are rejected.
No migration or environment variable is added. The existing queue worker and
confirmed manual retry own recovery; SMTP acknowledgement loss still has the
ambiguity described above. This change does not claim exactly-once SMTP delivery.

The [setup recipe](../tests/identity/setup-email-journey.spec.ts) uses built Web,
real API, disposable PostgreSQL, signed local OIDC and Mailpit behind a local TCP
gate. It checks unavailable configuration, validation and roles, a held send,
duplicate requests, lost HTTP response, definite SMTP failure and confirmed retry
of the same message. It also checks session expiry, English mobile rendering and
keyboard access to the configuration table. No external mail is sent. Run with
the existing identity suite, or after API/Web builds:

```sh
yarn playwright test --config tests/playwright-identity.config.mjs setup-email-journey.spec.ts
node --test tests/integration/admin-email-test.integration.mjs tests/integration/email-recovery.integration.mjs
```

### Local Mailpit greeting delays

The disposable provider helper and `docker-compose.acceptance.yml` set
`MP_SMTP_DISABLE_RDNS=1` on Mailpit only. By default, Mailpit resolves the client's
IP address before sending its SMTP greeting; an unavailable reverse DNS service
in a Docker test network can exceed the application's greeting timeout. The
[Mailpit runtime option](https://mailpit.axllent.org/docs/configuration/runtime-options/#smtp-server)
removes that unnecessary lookup for synthetic clients. Application SMTP timeouts,
authentication, TLS settings and production configuration are unchanged.

Diagnosis on 25 September 2026 (Windows, Node 22.23.2, base `6091a75`): both direct
SMTP and the local gate timed out before receiving a greeting. With reverse DNS
disabled, the same direct, forwarded and held-then-released sends completed in
16–35 ms. This is a local protocol check; it does not qualify external delivery.

Validation on the same base with this Mailpit setting: the complete identity
suite (`yarn playwright test --config tests/playwright-identity.config.mjs`)
passed **9/9** in 4.2 minutes, including the SMTP and social recovery journeys.
The `admin-email-test`, `email-recovery` and `provider-rehearsal` integration tests
also passed (**3/3**), covering queued sends, recovery and SMTP/S3/restore with
disposable providers. Compose configuration, lint, targeted formatting and
documentation checks passed; lint retains the existing unused directive warning
in `scripts/smoke-public.mjs`.

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

The HTML reminder includes **Reprendre la revue des commandites**, linking to
the protected sponsorship list on the API's configured public origin
(`FUNDING_PUBLIC_BASE_URL`, otherwise the first allowed origin or `APP_DOMAIN`).
The text version contains the same absolute URL. Without a usable HTTP(S) origin,
the local navigation path remains plain text. Credentials, query strings and
fragments from the configured base are never copied into the link. Following it
still requires an administrator session; the email grants no access or approval.
Already queued reminders keep their original content.

The [information and review recipe](sponsorship-access-and-drafts.md#recette-de-demande-dinformations-et-de-revue)
checks the captured email, daily deduplication and return to the admin dossier.

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

### Read-only DNS diagnostic

Use Node 22 and explicit domains/selectors supplied by the mail provider or
observed in a received test message. This command reads DNS TXT records only;
it does not load `.env`, connect to SMTP, send mail or change the DNS zone.

```sh
yarn email:dns --domain example.org --selector provider-selector

# When the SMTP envelope and DKIM signer use different domains:
yarn email:dns --domain example.org --spf-domain bounce.example.org \
  --dkim-domain signer.example.org --selector current --selector next
```

Replace these examples with confirmed values. `--domain` is the visible From
domain; `--spf-domain` is the SMTP MAIL FROM/Return-Path domain, and
`--dkim-domain` is the signing domain (`d=`). The latter two default to `--domain`;
confirm that this matches the provider. Reply-To is not an authentication domain.
At least one explicit DKIM selector (`s=`) is required; no selectors are guessed.
Names must be ASCII/Punycode, without addresses or URLs. Up to five distinct
selectors can be checked during rotation.

The JSON report includes a timestamp, queried names, fixed findings and limits.
It omits raw TXT data, public keys, reporting addresses and provider errors.
It concatenates TXT character-strings within each record and distinguishes
duplicate records from split strings. The diagnostic checks:

- SPF publication, common mechanism syntax, IP prefixes, duplicate modifiers,
  permissive `all` and a static lookup-term count. Includes, redirects, macros,
  A/MX/PTR/exists dependencies and the sender IP are **not evaluated**; such
  dependencies require review. This is not an SPF authorization result.
- DKIM record uniqueness, tag syntax, revoked/invalid public keys, RSA size,
  Ed25519 key length, SHA-256/email restrictions and testing flags. CNAME resolution
  and truncated UDP response fallback use the DNS resolver. RSA below 1024 bits
  fails; 1024–2047 bits require review. No message signature is verified.
- DMARC publication at the **exact** From domain, duplicate records/tags,
  policy/alignment tag values and monitoring/testing modes. Missing direct
  records require review: a parent policy may apply, but no organizational domain
  is guessed. Under RFC 9989, absent `p` defaults to `none`; legacy `pct` is flagged
  for review. Policy discovery, alignment, reporting URIs/authorization and
  delivery are outside this diagnostic.

Exit **0** means no finding in this limited scope, **2** means findings or review
(including intentional monitoring policies), and **1** means incomplete DNS
resolution or refused arguments. NXDOMAIN/NODATA are distinct from SERVFAIL,
timeouts and other resolver failures. A successful diagnostic never proves
message authentication, inbox delivery, DNSSEC or global propagation.

The system resolver is used unless `--resolver <ip[:port]>` selects one explicitly
(IPv6 with a port: `[::1]:5353`). There is no fallback to a public resolver.
`--timeout-ms` accepts 100–10000 ms, default 3000; the overall resolver cancellation
deadline is that value plus 500 ms. At most seven TXT lookups are launched,
with one resolver attempt each; DNS CNAME/TCP handling is delegated to the resolver.
A response above 50 TXT records or 32 KiB of text is incomplete. Re-running only
repeats reads and produces a fresh timestamp; no state or corrections are persisted.

Reproduce without any external DNS or credentials:

```sh
node --test tests/email-dns.test.mjs
```

This suite runs the real CLI against a loopback-only UDP/TCP DNS fixture with no
forwarding. It covers successful publication, split strings, separate identities,
selector rotation, CNAME/TCP, duplicates, missing/revoked records, review modes,
transient failures, bounded timeouts and rejected inputs. It is included in
`yarn test` and the existing acceptance CI. No real domain is qualified by it.

References: [SPF, RFC 7208](https://www.rfc-editor.org/rfc/rfc7208.html),
[DKIM, RFC 6376](https://www.rfc-editor.org/rfc/rfc6376.html),
[RSA requirements, RFC 8301](https://www.rfc-editor.org/rfc/rfc8301.html),
[Ed25519, RFC 8463](https://www.rfc-editor.org/rfc/rfc8463.html),
[DMARC, RFC 9989](https://www.rfc-editor.org/rfc/rfc9989.html).

Compare the published values with the official settings supplied by HostPapa
and inspect a received test message separately. Do not change DNS automatically.

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
