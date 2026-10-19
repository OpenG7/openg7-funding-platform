# Assistant information-request receipts

The administrative information request is a confirmed command, separate from
draft preparation and conversation. Its receipt confirms acceptance, not inbox
delivery. No conversational tool sends the request.

## Command and reconciliation

`POST /api/admin/sponsorships/request-information` requires a UUID `requestId`
alongside `contributionId`, `contextVersion`, `recipient`, `subject`, `body` and
`confirmed: true`. Web and API must be delivered together. The result retains
`status` and adds `requestId`, `messageId`, canonical ISO UTC `acceptedAt`,
`deliveryStatus` (`queued|sending|sent|failed|uncertain`) and nullable `sentAt`.

An exact replay by the same actor with the same request and payload returns the
original acceptance and message with its current delivery state. Reusing the UUID
with another actor, dossier or payload returns 409
`INFORMATION_REQUEST_ID_CONFLICT`. The stale-context refusal remains 409
`INFORMATION_REQUEST_CONFLICT`; it has not accepted that new command and allows
fresh preparation. A new UUID revalidates the current dossier before reusing an
existing email deduplication hash. Identical content can therefore have a new
receipt without another email or send audit. Queue, send audit and receipt are
transactional; a replay creates none of them again.

`GET /api/admin/sponsorships/information-request-receipt` accepts exactly one UUID
`requestId` and one UUID `contributionId`. The alias without `/api` is retained.
Operator/owner rights and the original actor are checked by the API. The echoed
tuple returns `found:false` when absent or owned by another actor; `found:true`
adds the acceptance and delivery fields above. No recipient, subject, body or
credential is returned. Invalid query fields return 400; unavailable storage
returns 503, never a fabricated miss. This private, non-cached read does not
enqueue, send, publish or create an audit.

## Web recovery

The confirmation creates one secure UUID. Before POST, the Web stores only that
UUID under `openg7-assistant-information-pending:<contributionId>` in session
storage; the private confirmed payload remains in memory. Response loss, timeout,
server error, a malformed receipt or UUID conflict preserves the lock. Reload
restores the UUID without automatically sending or checking anything. The explicit
verification button performs only the GET for that exact tuple.

Absence and read errors cannot rule out a POST still committing, so they never
unlock a new command. A matching `queued`, `sent` or `failed` receipt resolves
acceptance and clears the pending marker. `sending` and `uncertain` retain it
through reload. The accepted date and exact email link remain visible; `sent`
still does not establish inbox deliverability. Keyboard verification focuses the
receipt after rendering. Late responses after a dossier, session, identity, role
or lifecycle change cannot restore private facts or remove the retained marker.

An older `pending` marker has no UUID: it stays blocked with an explanation and
the email registry link. The Web invents no historical identifier and never
reposts it. Session-storage failure retains the in-memory lock, but cannot
provide reload persistence. No private draft or contact is added to storage.

## Persistence and validation

Additive migration 062 creates append-only receipts; runtime grants are
`SELECT, INSERT`, without `UPDATE` or `DELETE`. Upgrade starts with an empty
receipt table, preserving existing email/audit records without reconstructing
historical receipts. See the [migration runbook](../operations/database-migrations.md).

The controller tests own absent, malformed, conflicting, uncertain and late-read
behavior. Transport tests verify authentication, exact tuple encoding and no
automatic retry. FR/EN UI fixtures cover mobile/desktop recovery, focus and
legacy locks. The sponsorship information acceptance scenario loses an actual
POST response after commit and reconciles by GET before checking the single
queued message, captured email and send audit. Fixture, PostgreSQL, Docker and
provider validations must be reported separately; no local run qualifies
production or an external inbox.
