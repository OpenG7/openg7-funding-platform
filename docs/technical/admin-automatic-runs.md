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
