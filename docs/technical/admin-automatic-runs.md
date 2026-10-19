# Automatic responsibility runs

`GET /api/admin/automatic-runs` reads the caller's latest durable run;
`?runId=<uuid>` selects one of their runs. Readers can inspect their own reports;
operators and owners can start and control runs. Every endpoint checks the
administrative session and origin policy before reading private input or using
the database. Responses are private and `no-store`; `/admin` aliases are supported.

- `POST /api/admin/automatic-runs`: `{requestId}` captures a frozen manifest of
  confirmed payments, without the contribution-list limit.
- `POST /api/admin/automatic-runs/advance`: `{runId,requestId,expectedVersion}`
  checks one dossier, prepares eligible private publication drafts, rereads its
  facts and appends the report entry. No publication, email, refund or approval
  is executed by this endpoint.
- `POST /api/admin/automatic-runs/control`: the same fields plus
  `action: pause | resume | recheck | reconcile`. Recheck starts another pass over the same
  manifest; newly confirmed payments require a new manifest.
- `GET /api/admin/automatic-runs/report?runId=<uuid>&after=<seq>&limit=50` reads
  append-only entries. `nextCursor` is null at the end; the maximum page is 100.

UUID request keys and payload digests prevent duplicate logical commands;
incompatible reuse or stale versions return a conflict. Run ownership is checked
on every lookup. An uncertain or interrupted operation is retained for
reconciliation and is never automatically replayed. Loading a run does not
start a worker or resume a browser driver.

The browser driver waits for a local **I’ve read it, continue** acknowledgment at
each reading checkpoint: captured scope, next dossier preview, confirmed result
(including the last dossier), then final summary. Previews use the existing
read-only payment-journey GET; acknowledging a preview permits one `advance`.
Acknowledgments do not approve business actions, add a server contract or persist
across reloads. The server run may already be completed while the browser still
awaits result or summary reading; its durable status remains visible separately.
The complete report remains paginable during summary reading. Loading a page
blocks acknowledgment; an unavailable page can be retried without advancing or
repeating dossier checks, preserving the reading cue. A 401/403 stops reading and
clears the private data displayed.
Relevant reading zones keep a gentle continuous halo until acknowledgment, static
with reduced motion. Pause, guide closure, mode change, manual navigation, editing,
an open dialogue, a hidden tab, session change or an error interrupting the run
stops the driver and removes the halo. Reports remain readable after reload
without continuation.

Reconcile is an explicit human action. It locks the run and consults the durable
command and report. A completed command recovers its recorded result; a command
without an entry can be marked failed only when the atomic database transaction
proves that no preparation committed. The run then pauses and requires a separate
resume gesture. Inconsistent records remain uncertain.

A confirmed payment with a nonpositive amount or malformed currency prevents
start with `503 RUN_INVALID_PAYMENT_FACTS`, before a run is created. It is not
silently omitted. If confirmed after capture, it counts as new work and prevents
an overall balanced result until reviewed.

The public TypeScript contracts are `AdminAutomaticRunState`,
`AdminAutomaticRunReport` and `ResponsibilityBalance` in `@openg7/funding-core`.
Balances require the frozen offer's exact quantities and qualified immutable
proofs. `promisedBenefits` retains the normalized recorded benefits, including
required elements, format, deadline and duration, even if an obligation is
missing. A qualified delivery after its recorded due date remains flagged in
the report for human follow-up; no compensation is invented. Audited dispensations
have a separate count; they are not delivered
benefits. Missing terms, missing obligations and unverifiable evidence remain
unknown. Amounts are integer minor units, grouped by currency. `globalBalanced`
describes each manifest dossier at its last dated observation, after a completed
pass with no newly confirmed payments; it is not a guarantee of the platform's
current state. Reports retain before/after balances, action outcomes, request,
actor, timestamp and audit/evidence references.

The operational attention queue remains available for mixed-currency dossiers.
Its dispute warnings retain separate integer minor amounts per currency; it
does not depend on or invent a combined financial total.

Migration `055_admin_automatic_responsibility_runs.sql` is required. It adds only
private run bookkeeping; manifest inputs and report entries are immutable.
User-facing operation and restart rules:
[automatic mode](../operations/admin-pilotage.md#mode-automatique-de-rapprochement).

## Versioned preparation receipts

The interface calls a receipt a **Preparation sheet** and a preparation agreement
an **Approval**; the original sponsorship agreement names the commercial terms.
Batch passes are **Batch reviews**. API names and persisted contracts remain
unchanged. See the shared [operations vocabulary](admin-campaigns.md#vocabulaire-des-operations).

`GET /api/admin/sponsorships/preparation?sponsorshipId=<uuid>` reads the current
private preparation directly in the selected dossier's Publication step, before
the commitment details. Its `AdminDossierPreparationReceipt` shares
`AdminPreparationReceiptData` with the carousel, adding `context: 'dossier'`
without run or navigation counters. Administrative readers,
operators and owners may consult it; opening the dossier neither creates a run
nor examines a batch position. Historical qualification remains available in the
commitment details, while missing terms remain blockers; current pricing is never
substituted. `/admin` aliases, session/origin policy and private `no-store`
responses apply to both contexts.

`POST /api/admin/sponsorships/preparation/approve` accepts
`{contributionId,expectedVersion,requestId,confirmed:true}`, without `runId`.
Only operators and owners can record this private agreement. It reuses the same
transaction, prerequisites, idempotence and conflict rules as batch approval.

`GET /api/admin/automatic-runs/preparation?runId=<uuid>&position=<1-based>`
reads one dossier from the caller's frozen manifest, including dossiers not yet
examined. The position consulted is independent from the processing cursor.
This read uses current payment facts, the historically accepted offer, current
checks and authorizations, and the exact private website/publication draft text.
Protected source links allow review of associated media. This preparation agreement
covers the listed private source drafts; final image selection, assembled delivery
content and destination-specific publication rights require their own workflow.
Long offer terms and
approval history remain available in expandable sections. GET never prepares,
advances, approves or dispatches work.

`POST /api/admin/automatic-runs/preparation/approve` accepts
`{runId,contributionId,expectedVersion,requestId,confirmed:true}`. Operators and
owners can approve; readers can inspect their own receipts. Server authorization,
ownership, current prerequisites and the deterministic preparation digest are
checked again in a transaction. `409 PREPARATION_VERSION_CONFLICT` means the
presented version is stale; `409 PREPARATION_INCOMPLETE` identifies a preparation
whose prerequisites are missing. The client rereads the receipt without retrying
the write. Opening the content is not an approval.

The immutable agreement records dossier, digest, exact private receipt snapshot,
actor, UTC time, request and audit reference. Approval and audit commit together.
Request keys bind the actor and payload; conflicting or concurrent submissions
are reconciled against durable records without replaying a mutation. Content,
payment, commitments, media and moderation authority determine the version;
navigation counters, batch examination and approval history do not. Direct and
batch views share the same version and approval history; examination remains a
separate batch prerequisite without a fictitious examination on the direct receipt.
Already examined 056 content versions retain their digest. Dossier approvals have
a null `runId`; batch approvals retain their actor-owned run reference. Changed facts produce
`review_required`; prior approvals remain visible as history. A new agreement is
explicit. Neither approval nor carousel navigation changes the run cursor.

The Web shows one compact Received / Promised / Prepared receipt, with real
check/authorization counts excluding `not_required` and expandable checks, terms
and full approval trace. After server success, the stamp replaces the approval
button without changing the displayed receipt; the visible scope keeps
publication, sponsor moderation, refunds, rejection and sending under separate
confirmations and checks, independently of batch processing and local reading
checkpoints.
The historical offer keeps each benefit's type, quantity, channel and target
separate from current preparation permissions and private-draft readiness.
Agreement scope stays visible above the approval control, while the receipt
footer names the actions requiring separate confirmation.

Migrations [056](../../apps/funding-api/migrations/056_admin_preparation_approvals.sql)
and [057](../../apps/funding-api/migrations/057_dossier_preparation_approvals.sql)
are additive and must precede the updated API. Migration 057 allows an agreement
without a run and adds a global dossier/version uniqueness constraint for new
generation-2 agreements; generation-1 history, snapshots and run references remain
unchanged. Cross-context concurrent submissions reconcile the same logical agreement.
Refresh application-role grants
using the documented [migration procedure](../operations/database-migrations.md).
The new table is append-only and private. No existing approval or publication is
inferred from historical preparation or a local reading acknowledgment.

### Runtime preparation readiness

When PostgreSQL is configured, the API checks the preparation approvals table
and its effective application-role permissions before opening the HTTP listener,
in development and production. The check requires its schema delivered by
056/057 and the permissions to select and insert approval rows. A failed check stops
startup with a safe error code. `/health` remains a liveness endpoint; it does
not replace this startup check or prove every database feature is available.

Each preparation read and approval checks readiness again before accessing the
receipt or writing an agreement. This detects schema or grant changes after
startup. Both the carousel and dossier endpoints return HTTP 503 with
`PREPARATION_SCHEMA_INCOMPATIBLE` for missing or incompatible schema, or
`PREPARATION_DATABASE_ACCESS_DENIED` for insufficient database permissions.
The latter is a server configuration failure, distinct from the caller's HTTP
401/403 authorization failure. Other unavailable reads retain `RUN_UNAVAILABLE`.
Known PostgreSQL missing-relation, missing-column and insufficient-privilege
errors are also classified if a dependency changes after the readiness check.

The Web displays a database-update or database-access configuration message in
French and English. Approval stays disabled while that configuration error is
displayed; a successful explicit refresh can clear it after remediation. An
approval failure is reconciled by reading only, without repeating the write.

Server failures include a generated `correlationId` in the response and a
structured diagnostic with operation, category, safe code, date and correlation.
Only allowlisted SQLSTATE codes are recorded; raw SQL, PostgreSQL diagnostics,
connection details and dossier content are excluded. Detection does not run
migrations, grant permissions or resume processing. Apply the existing migration
procedure to the intended environment, then restart a refused API or explicitly
refresh a running one after remediation.

## Pending dossiers

The header's new-passage button reads the existing private
`GET /api/admin/attention` projection before opening the guide. Its optional
`pendingDossierCount` counts distinct dossiers linked to at least one required
action, before filters and pagination. Multiple actions count a dossier once;
shared publication batches and slots include every related unfinished draft's
dossier, including indirect batch assignments. Published, rejected and cancelled
drafts add no dossier through that association.

Informational entries and tasks without a dossier reference, including unlinked
email or Stripe incidents, are excluded from the count and remain visible in the
queue. The count describes that queue's current required dossiers, including
refund/dispute follow-up, rather than the run's frozen manifest or all historical
payments. Reading it neither starts a passage nor performs an action.

This field is additive: a complete empty source returns `0`; incomplete sources
return `null`. A missing field from an older API also means unknown. The Web shows
an unavailable count and an inactive bell for unknown values; a positive known
count activates the bell. Existing queue reads populate it, and the browser
refreshes the queue after a passage stops, without automatically resuming work.
