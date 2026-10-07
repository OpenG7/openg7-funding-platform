# Administration API

Payment notifications and private website preparation use protected
`GET /api/admin/contribution-activity` and per-actor
`POST /api/admin/contribution-activity/present`. Pagination, states,
permissions and simulation: [contribution activity](../operations/contribution-activity.md).

Contracts: feature guides and code; [documentation index](../README.md).

## Fundraiser admin

`GET/POST /api/admin/backups`: [database backups](../operations/admin-database-backups.md)
(owner only; migration 030).

[Stripe recovery](../operations/admin-stripe-backfill.md).

`POST /api/admin/sponsorships/media/delete` requires the current `assetId`,
`expectedVersion`, and `confirmation` equal to the selected asset ID. Missing or
different confirmation returns `400 CONFIRMATION_REQUIRED` before any storage
mutation; a stale version returns `409`. The UI supplies confirmation only after
its explicit confirmation dialog. API and Web must be deployed together: older
clients without this field must refresh before deleting media. Existing admin
authorization checks and the sponsor-side lock on approved assets remain active.
The controlled public media endpoint uses `Cache-Control: no-store` so subsequent
requests recheck admissibility after removal. This cannot revoke copies already
downloaded or previously cached under older headers. See the
[media recipe](../sponsorship-e2e-coverage.md#recette-navigateur--retrait-et-remplacement-de-médias-approuvés).

Admin dashboard: `/admin/fundraiser`.

`/admin/login`: production requires OIDC/MFA and revocable HttpOnly sessions.
Local/test token mode exchanges `FUNDING_ADMIN_TOKEN` at `POST /api/admin/session`;
other routes refuse the root secret. API authorization remains authoritative.

Session, sponsorship review/publication and draft/slot/batch mutations
require JSON objects. `null`, arrays or primitives return `400` before provider,
DB or audit effects; protected routes authorize first.
`POST /sponsorship-details` and its `/api` alias return
`410 SPONSORSHIP_LEGACY_ENDPOINT_RETIRED` before reading a body or accessing
Stripe or PostgreSQL. Use `/api/sponsorship-followup/details` with the private
token and draft revision, or `/api/sponsorship-followup/recover` for lost access.

[Access and sessions](../operations/admin-identity-and-alerts.md), `/admin/fundraiser/access`:
OIDC owners manage roles, disable accounts and revoke sessions. Account changes
revoke sessions and protect the last owner; confirmation is required. Token mode
has no named accounts. Alerts remain opt-in (`yarn operations:watch` or Compose).

UI guides: [layout](../admin-ux-lot-1.md), [queue](../admin-ux-lot-2.md),
[assistant](../admin-ux-lot-3.md), [dossier](../admin-ux-lot-4.md),
[cockpit](../admin-ux-lot-5.md), [search](../admin-ux-lot-6.md) and
[drawers](../admin-ux-lot-7.md). `yarn test:ui:admin` uses synthetic APIs without DB.
`GET /api/admin/attention` serves `/admin/fundraiser/attention` with pagination,
URL filters and exact record links. `GET /api/admin/assistant/context` accepts
optional `sponsorshipId`; information requests require an editable preview and
confirmation at `POST /api/admin/sponsorships/request-information`. Queue and audit
are atomic; duplicate requests reuse the original email.
`GET /api/admin/sponsorships/progress` is a read-only projection, optionally filtered
by `sponsorshipId`; tab links use `/admin/fundraiser/sponsors?sponsorshipId=<uuid>&tab=billing`.
Protected cockpit reads use `/api/admin/cockpit/metrics`, `/activity` and `/systems`.
Amounts are integer minor units per currency; missing fees keep net receipts
unavailable. System checks provide dated evidence with expiry, without sending
email or writing test files. Stripe's optional `connection` is separate from
webhooks; see [check semantics](../operations/admin-setup.md).
`POST /api/admin/search` uses private JSON, grouped results and bounded pagination;
terms stay out of URLs/storage. Exact contribution, audit and expense IDs precede
list limits; invoice/publication pages reload on target changes. Drawers protect
invoice/media previews and require action confirmations; Stripe inspection excludes
raw webhook payloads. Dashboard `data_available=false` means no PostgreSQL, not an
empty fund. Reproduction and integration limits are in the linked guides.

Selected operational endpoints (the feature guides in the
[documentation index](../README.md) describe the additional contracts):

```text
GET /api/admin/dashboard
POST /api/admin/search
GET /api/admin/stripe-event?eventId=evt_...
POST /api/admin/session
GET /api/admin/contributions
POST /api/admin/contributions.csv
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
GET /api/admin/email/test?requestId=<uuid>
GET /api/admin/email-queue
POST /api/admin/email-queue/retry
POST /api/admin/email-queue/reconcile
GET /api/admin/sponsorship-invoices
POST /api/admin/sponsorship-invoices/backfill
GET /api/admin/sponsorship-invoices/pdf?invoiceId=<uuid>
POST /api/admin/sponsorship-invoices/resend
GET /api/admin/sponsorship-credit-notes/pdf?creditNoteId=<uuid>
POST /api/admin/sponsorship-credit-notes/resend
```

The dashboard summarizes received funds, estimated availability, pending
sponsorship reviews, feed state, Stripe event errors and recent contributions.
Contributions support local type/payment/public-display-consent filters and search.
The [private CSV export](../operations/private-contributions-export.md) requires
owner access and a confirmed, versioned selection. Expenses manage `fund_allocations`;
see the [confirmation, version and amount contract](../funding-transparency.md#allocations-publiées-et-réalisations).
Publications generate and moderate drafts for approved sponsorships;
audit lists recent sensitive admin actions.

Owner-only `/admin/fundraiser/setup` uses cockpit observations and [idempotent SMTP tests](../email-smtp.md#admin-configuration-test).
`GET /api/admin/setup-status` adds optional `identity`: `mode=oidc|token`, nullable
`issuer`/`callback_url`, booleans `client_id_configured`, `client_secret_configured`,
`owner_bootstrap_configured`, `private_data_encryption_configured`, and `mfa_policy=amr|acr`.
No secrets/subjects/claims; presence does not prove provider/MFA validity. Missing
identity stays unknown; bootstrap=false allows existing owners. See [guided setup](../operations/admin-setup.md#guidage-oidc).

`/admin/fundraiser/email-queue` lists queued, sending, sent, failed and `uncertain`
messages. Uncertain delivery blocks automatic sends and ordinary retry
(`409 EMAIL_DELIVERY_RECONCILIATION_REQUIRED`). Migration 033 is required.
Operators/owners reconcile evidence through `POST /api/admin/email-queue/reconcile`
(also `/admin`): JSON `messageId` (UUID), `expectedUpdatedAt` (exact GET version),
`confirmation=messageId`, `outcome=sent|not_sent` and non-secret `evidenceReference`
matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$`. Decision and audit commit atomically.
`sent` records delivery without sending; `not_sent` leaves `failed` at the automatic
attempt limit, allowing only a separate confirmed manual retry. Success is
`200 {updated:true,message}`; stale/non-uncertain state returns
`409 EMAIL_RECONCILIATION_CONFLICT`, invalid JSON/fields `400 INVALID_EMAIL_RECONCILIATION`,
wrong content type `415` with that code, no DB `503 EMAIL_QUEUE_UNAVAILABLE`,
failure `502 EMAIL_RECONCILIATION_FAILED`. Ordinary manual retries remain audited.

At `/admin/fundraiser/invoices`, admins inspect invoices/credit notes, Stripe
references and email status, download PDFs and resend to a corrected contact.
`POST /api/admin/sponsorship-invoices/backfill` generates missing historical
invoices without emailing sponsors.

Issued invoice snapshots are frozen, including null/missing identity fields and
placeholder names. Later sponsor/issuer changes, payment replays, backfill and
resends do not enrich the snapshot or alter its PDF content. Credit notes inherit
that invoice identity. A corrected resend `to` affects delivery only; it does not
replace the document's contact details.

Backfill requires `confirmation` matching `contributionId`, or `BACKFILL_INVOICES`
for a bulk run (400 `confirmation_required` otherwise). Update API/Web together;
no migration. Owner access and the UI confirmation remain required.

Resends require `to`, UUID `requestId`, and `confirmation` matching `invoiceId`
or `creditNoteId` (400 `CONFIRMATION_REQUIRED` if confirmation/UUID is missing).
Update Web/API together; no migration. Identical retries share one `messageId`;
reusing the UUID for another document/recipient returns 409 `REQUEST_CONFLICT`.
Queue and audit commit atomically; the worker delivers afterward. Replay never
resets backoff or alters issued documents. See [UI recovery and limits](../payment-trust-validation.md#recette-de-renvoi-des-factures-et-avoirs).

## Sponsorship review admin

Admin review: `/admin/fundraiser/sponsors`. Private sponsorship endpoints:

```text
GET /api/admin/sponsorships
GET /api/admin/sponsorships/logo
POST /api/admin/sponsorships/logo
POST /api/admin/sponsorships/logo/delete
POST /api/admin/sponsorships/review
POST /api/admin/sponsorships/refund
POST /api/admin/sponsorships/publication
```

Local/test `token` mode uses `Authorization: Bearer <sessionToken>` after the
session exchange; no anonymous or root-secret operational access. OIDC rejects
legacy tokens and requires its cookie session, role and exact mutation origin.
See [authentication rules](../operations/admin-identity-and-alerts.md).

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
refund workflow requiring the current version and typed public reference.
`POST /api/admin/sponsorships/refund` durably claims and audits the request before
Stripe, using a stable operation ID. An uncertain result returns
`502 SPONSORSHIP_REFUND_UNCERTAIN` and blocks another request until reconciliation.
See [refund integrity and recovery](../operations/stripe-refund-integrity.md).
Admins choose an amount and reason (`requested_by_customer`, `duplicate`, or
`fraudulent`) and can queue a confirmation email. Partial refunds preserve `paid`;
only the full confirmed total marks `refunded`. When a matching sponsorship invoice
exists, the refund also creates an app-generated credit note in
`sponsorship_credit_notes`, tied to the Stripe refund; the credit note is visible
and resendable from `/admin/fundraiser/invoices`,
with its own downloadable PDF.
New credit-note numbers include a deterministic suffix derived from the invoice
and Stripe refund identifiers, so several refunds of one invoice receive distinct
numbers. Retrying an already issued refund keeps its original number and snapshot,
including numbers issued before this change; no historical renumbering is needed.
Each new credit note describes its own refund amount: a refund smaller than the
original invoice is labelled partial, including the last instalment of a
cumulative full refund. The default note states that it reduces the invoice by
the indicated amount. Existing invoice and credit-note snapshots are preserved.
`FUNDING_SPONSORSHIP_CREDIT_NOTE_LEGAL_NOTE` still overrides this default; an
installation retaining the former full-cancellation wording must update its
configured text separately. The cumulative `charge.refunded` confirmation marks
the payment fully refunded when the sum reaches the original payment. The form
still defaults to the original amount; Stripe enforces the remaining refundable
amount. See the [isolated refund recipe](../payment-trust-validation.md#recette-des-remboursements-et-avoirs)
for the tested cases and limitations.
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
Removal requires JSON `contributionId`, current `expectedVersion`, and
`confirmation=contributionId` supplied after the UI dialog. Missing/mismatched
confirmation returns `400 CONFIRMATION_REQUIRED` before mutation; stale versions
return `409`. Deploy API/Web together; older clients must refresh.
Uploaded logos are served publicly only when an approved, consented sponsorship
references that exact URL.
