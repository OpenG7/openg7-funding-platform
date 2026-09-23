# Administration API

Payment notifications and private website preparation use the protected
`GET /api/admin/contribution-activity` and per-actor
`POST /api/admin/contribution-activity/present` endpoints. Pagination, states,
permissions and simulation are documented in
[contribution activity](../operations/contribution-activity.md).

Reference extracted from the main README. Read only the relevant section; current
feature guides and implementation define the exact contract. Commands run from
the repository root. [Documentation index](../README.md).

## Fundraiser admin

The admin dashboard is available at:

```text
/admin/fundraiser
```

Open `/admin/login`. In default `token` mode, the frontend exchanges
`FUNDING_ADMIN_TOKEN` through `POST /api/admin/session`. In `oidc` mode, it
redirects to the configured identity provider and requires verified MFA.
The browser then uses an HttpOnly cookie for a revocable server session.
The API checks authorization on every admin endpoint; Angular guards only
control navigation. Admin routes are loaded on demand from `admin.routes.ts`.

The [access and sessions page](../operations/admin-identity-and-alerts.md)
at `/admin/fundraiser/access` lets OIDC owners manage readers, operators and
owners, disable accounts and revoke sessions. Changing an account revokes its
sessions; the last active owner is protected. Token mode does not provide these
named-account guarantees. Independent alerts use `yarn operations:watch` or the
optional Compose overlay and remain disabled until configured and started.

The dashboard now uses the admin visual foundation described in
[Admin UX — lot 1](../admin-ux-lot-1.md). Run `yarn test:ui:admin` to build
and check this UI with synthetic API fixtures, without starting the API or a DB.
The [To do queue — lot 2](../admin-ux-lot-2.md) is available at
`/admin/fundraiser/attention`, with server pagination, URL filters, exact record
links and an independent dashboard summary. Its protected API is
`GET /api/admin/attention`. Missing invoices can be generated for one confirmed
record through the existing backfill endpoint, without sending email.
The [Contextual assistant — lot 3](../admin-ux-lot-3.md) adds dossier facts,
deterministic next steps and draft preparation to the cockpit and sponsorships.
`GET /api/admin/assistant/context` accepts an optional `sponsorshipId`.
Information requests show an editable preview and require human confirmation
through `POST /api/admin/sponsorships/request-information`; queue insertion
and audit are atomic and duplicate requests reuse the original email.
The [Sponsorship dossier — lot 4](../admin-ux-lot-4.md) adds seven linked tabs,
six independent milestones, persisted billing/publication/refund facts, session
selection in the cockpit and navigation badges from the same work queue.
`GET /api/admin/sponsorships/progress` accepts an optional `sponsorshipId` and
performs a read-only projection. Direct tab links use
`/admin/fundraiser/sponsors?sponsorshipId=<uuid>&tab=billing`.
The [Cockpit indicators, activity and system status — lot 5](../admin-ux-lot-5.md)
adds independent protected read endpoints under `/api/admin/cockpit/metrics`,
`/api/admin/cockpit/activity` and `/api/admin/cockpit/systems`. Amounts use integer
minor units per currency; missing fees keep net receipts unavailable. System
status shows dated evidence with expiration, without sending email or writing
test files. PostgreSQL integration uses an explicitly configured disposable
`cockpit_test` database; see the lot report for reproduction and coverage limits.
The [Global admin search — lot 6](../admin-ux-lot-6.md) adds
`POST /api/admin/search` with private JSON input, grouped dossier results and
bounded pagination. Use Ctrl+K / Cmd+K from the admin layout or shared navigation.
Search terms stay out of URLs and browser storage. Direct contribution links
accept `contributionId` before the list limit; invoice and publication pages
reload when their target changes on the same route. PostgreSQL search tests
require an explicitly configured fresh local `search_test` database.
The [Admin drawers and page harmonization — lot 7](../admin-ux-lot-7.md)
extends the shared FR/EN layout to the operational pages and adds accessible
inspection drawers, protected invoice/media previews and explicit action
confirmations. Stripe inspection returns minimal stored event facts without raw
webhook payloads. Audit and expense pages accept exact identifiers before list
limits. The PostgreSQL inspection test owns and removes its disposable container.
`GET /api/admin/dashboard` includes the additive `data_available` flag;
`false` means PostgreSQL is not configured and the UI must not present the
legacy zero-valued snapshot as an empty fund.

Selected operational endpoints (the feature guides in the
[documentation index](../README.md) describe the additional contracts):

```text
GET /api/admin/dashboard
POST /api/admin/search
GET /api/admin/stripe-event?eventId=evt_...
POST /api/admin/session
GET /api/admin/contributions
GET /api/admin/contributions.csv
GET /api/admin/expenses
POST /api/admin/expenses
POST /api/admin/expenses/update
GET /api/admin/transparency
GET /api/admin/publication-drafts
POST /api/admin/publication-drafts
POST /api/admin/publication-drafts/update
GET /api/admin/publication-batches
POST /api/admin/publication-batches
POST /api/admin/publication-batches/assign
POST /api/admin/publication-batches/unassign
POST /api/admin/publication-batches/schedule
POST /api/admin/publication-batches/publish
POST /api/admin/publication-batches/publish-social
POST /api/admin/publication-batches/cancel
GET /api/admin/publication-slots
POST /api/admin/publication-slots
POST /api/admin/publication-slots/update
POST /api/admin/publication-slots/assign-batch
POST /api/admin/publication-slots/assign-draft
POST /api/admin/publication-slots/publish
POST /api/admin/publication-slots/cancel
GET /api/admin/social-publication-jobs
GET /api/admin/audit-log
GET /api/admin/setup-status
POST /api/admin/email/test
GET /api/admin/email-queue
POST /api/admin/email-queue/retry
GET /api/admin/sponsorship-invoices
POST /api/admin/sponsorship-invoices/backfill
GET /api/admin/sponsorship-invoices/pdf?invoiceId=<uuid>
POST /api/admin/sponsorship-invoices/resend
GET /api/admin/sponsorship-credit-notes/pdf?creditNoteId=<uuid>
POST /api/admin/sponsorship-credit-notes/resend
```

The dashboard summarizes received funds, estimated availability, pending
sponsorship reviews, feed publication state, Stripe event errors, and recent
contributions. The contributions view supports local filtering by type, payment
status, public-display consent, and search, with a CSV export for private admin
review. The expenses view manages publishable fund allocations backed by
`fund_allocations`, and the transparency view compares the public summary with
published allocations. The publications view generates and moderates sponsored
publication drafts for approved sponsorships, while the audit view lists recent
sensitive admin actions.

The operational setup page is available at `/admin/fundraiser/setup`. It
checks Stripe, email, invoice, queue, database and environment readiness,
includes a small in-app guide, and can send an admin email test through the
queued email system without exposing secret values.

The email queue page is available at `/admin/fundraiser/email-queue`. It lists
recent queued, sending, sent and failed emails, summarizes retryable failures,
and can manually retry an unsent message through `POST /api/admin/email-queue/retry`.
Manual retries are recorded in the admin audit log.

The sponsorship invoice page is available at `/admin/fundraiser/invoices`. It
lists app-generated sponsorship invoices, shows Stripe references and latest
email delivery status, shows credit notes generated after guided Stripe
refunds, downloads invoice or credit-note PDFs, and can resend either the
invoice email or the credit-note email to the recorded sponsor contact or a
corrected admin-entered address. The same page can run
`POST /api/admin/sponsorship-invoices/backfill` to generate missing invoices
for historical paid sponsorships without emailing sponsors automatically.

## Sponsorship review admin

The admin review screen is available at:

```text
/admin/fundraiser/sponsors
```

It reads and updates private sponsorship records through:

```text
GET /api/admin/sponsorships
GET /api/admin/sponsorships/logo
POST /api/admin/sponsorships/logo
POST /api/admin/sponsorships/logo/delete
POST /api/admin/sponsorships/review
POST /api/admin/sponsorships/refund
POST /api/admin/sponsorships/publication
```

In `token` mode, first exchange `FUNDING_ADMIN_TOKEN` from `/admin/login` through
`POST /api/admin/session`. The browser admin then calls operational endpoints
with `Authorization: Bearer <sessionToken>`. The static token remains accepted
for scripts and backwards-compatible admin operations. In local development,
admin endpoints can be used without a token when `FUNDING_ADMIN_TOKEN` is unset,
but the frontend admin routes still expect a browser session. In `oidc` mode,
root tokens and legacy signed sessions are rejected; the API requires a valid
cookie session and sufficient role, plus the exact public origin on mutations.

The sponsorship publication endpoint prepares the public sponsor profile and
records feed placement metadata:

- public slug and short public summary
- feed target: `openg7` or `openg20`
- feed channels: `facebook` and/or `linkedin`
- feed status: `not_planned`, `planned`, `drafted`, or `published`
- optional public post URL once a publication exists

The legacy publication-batch social endpoint now returns HTTP 409
`FINAL_APPROVAL_REQUIRED`. Prepare and approve the exact content in the
[publication automation workspace](../operations/publication-automation.md);
the authorized worker owns delivery and recovery. Payment alone never authorizes sending.

When an admin refuses a sponsorship from `/admin/fundraiser/sponsors`, the
review flow requires an internal refusal reason, can send a sponsor-facing
email through the queued email system, and records the chosen refund handling
(`none`, manual refund required, or manual refund already completed) in the
admin audit metadata. The sponsorship record also tracks a refund workflow
status: `requested`, `processing`, `completed`, or `failed`. Stripe refunds
stay a separate deliberate action: the same admin page includes a guided
refund workflow that requires the current sponsorship version, asks the
admin to retype the public reference, calls `POST /api/admin/sponsorships/refund`,
marks the workflow as `processing`, creates a full or partial Stripe refund with an
idempotency key, marks the contribution as `refunded` when Stripe returns a
completed full refund, completes or fails the workflow from Stripe's response, can
queue a sponsor-facing refund confirmation email, and records the refund
id/status plus notification result in the admin audit log. If Stripe completes
the refund asynchronously, the `charge.refunded` webhook also marks the workflow
as `completed`. Admins can choose a partial amount and a Stripe refund reason
(`requested_by_customer`, `duplicate`, or `fraudulent`); partial refunds keep
the sponsorship payment status as `paid` while recording the refund amount and
reason on the sponsorship record. When a matching sponsorship invoice
exists, the refund also creates an app-generated credit note tied to the Stripe
refund; the credit note is visible and resendable from `/admin/fundraiser/invoices`,
with its own downloadable PDF.
The sponsor detail panel also includes an "Historique & audit" tab that merges
the sponsorship timeline with recent `admin_audit_log` entries for that
specific sponsorship, including the recorded admin actor. A dedicated
"Remboursements" tab summarizes the current refund workflow, dated milestones,
Stripe refund id, notes/errors, and refund-related admin audit entries.

Sponsor logos can be uploaded by admins through
`POST /api/admin/sponsorships/logo`. The API accepts PNG, JPEG, and WebP files
only, validates MIME type and file signature, stores the file outside the web
bundle in either the local private storage directory or the OVH private bucket,
records the controlled `/api/public/sponsor-logos/...` URL on the sponsorship,
and audits the upload. Admins can preview controlled logos through
`GET /api/admin/sponsorships/logo`, replace a logo with cleanup of the previous
controlled file, or remove the logo with `POST /api/admin/sponsorships/logo/delete`.
Uploaded logos are served publicly only when an approved, consented sponsorship
references that exact URL.
