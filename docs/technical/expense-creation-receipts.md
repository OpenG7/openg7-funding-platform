# Expense creation receipts

`POST /api/admin/expenses` (alias `/admin/expenses`) now requires a UUID
`requestId`, generated once before submission and retained while the result is
uncertain. Existing amount, currency, proof URL and public visibility confirmation
rules still apply. Updates do not accept this creation identifier as a command.

Within one PostgreSQL transaction, the API locks the normalized request UUID,
creates the allocation, records `achievement.created` with its request ID and
inserts an append-only `expense_creation_receipts` row. An exact replay by the
same actor returns the original creation response, including its stored expense
snapshot. Later expense edits are not undone. Reusing the UUID with another actor
or different accepted fields returns `409 request_conflict` and creates nothing.
The fingerprint binds all accepted fields and the explicit confirmation, using
integer minor units for the amount. Different UUIDs are separate commands.

## Private receipt read

```text
GET /api/admin/expenses/create-receipt?requestId=<uuid>
```

The `/admin/expenses/create-receipt` alias has the same contract. This GET requires
the owner role and reads only the authenticated actor's receipt. Reader/operator
access is denied before lookup. Local token sessions retain their shared actor;
this does not add individual isolation to token mode. Every response uses
`Cache-Control: private, no-store`.

An absent UUID or another actor's UUID returns `{requestId,found:false}`. A found
receipt adds `expenseId` (positive bigint decimal string) and `acceptedAt` (ISO UTC).
No expense content, amount, audit metadata or other actor identity is exposed.
The read performs a SELECT only: it neither creates an expense nor changes its
visibility, allocation or audit. Current expense content is loaded separately.

The query must contain exactly one `requestId`: malformed, repeated or additional
fields return `400 INVALID_EXPENSE_RECEIPT`. Unsupported methods return 405 with
`Allow: GET`. Missing/unavailable storage returns `503 EXPENSE_RECEIPT_UNAVAILABLE`,
never a fabricated miss. Missing/invalid POST UUIDs return `400 invalid_request_id`.

An absent receipt may mean the POST is still committing. The Web's manual
verification therefore retains the UUID and creation lock after absence, error,
incompatible response or lost permissions. A matching receipt provides a link to
the created expense and releases only that command's uncertainty. It never
replays the POST. Old session markers containing only `1` remain blocking because
they cannot identify a receipt. Navigation/session changes discard late responses;
a completed old request cannot clear a newer UUID's marker.

## Migration and qualification

Migration `063_create_expense_creation_receipts.sql` follows Assistant migration
062; integrate the Assistant PR first. Apply the complete additive migration set
and refresh the dedicated runtime grants before the corresponding API/Web. The
runtime role receives SELECT/INSERT on receipts, no UPDATE/DELETE/TRUNCATE. The
production privilege guard rejects grants that allow receipt rewriting. Existing
allocations are unchanged and receive no invented historical receipts. No external
payment, publication or email is triggered by the migration or receipt read.
Use the [migration procedure](../operations/database-migrations.md) for an
explicitly authorized environment; this change applies no production migration.

The disposable PostgreSQL integration test covers concurrent identical and
incompatible commands, actor binding, immutable replay after edits, rollback of
allocation/audit/receipt failures, pure reads and actual runtime privileges.
HTTP tests cover aliases, roles, strict queries and unavailable storage. Web
controller/browser tests cover lost responses, reload, legacy markers and safe
recovery. The [expense workflow](../funding-transparency.md) remains the reference
for editing and publication confirmation.

Local evidence, 19 October 2026 (America/Toronto), after integrating the
Assistant prerequisite:

- Complete Node suite: 7,365 pass, 8 skipped, no failures.
- Combined PostgreSQL receipt/runtime selection: 16/16 pass, including the
  7 expense receipt cases. Both additive migrations were checked on existing
  synthetic data without creating historical receipts.
- Production Angular build: 25 prerendered routes, 505.39 kB initial bundle,
  unchanged budgets. Global and admin UI TypeScript checks pass.
- Browser qualification: 58 distinct cases pass (23 creation, 22 editing,
  13 financial capabilities), including the 10 new receipt cases. Earlier
  selections overlap these files and are not additive. FR390 and EN1536 captures
  of the recovered receipt were inspected; keyboard recovery opens the exact
  entry without another POST.
- ESLint has no errors and one pre-existing warning in `scripts/smoke-public.mjs`.
  Targeted formatting, documentation standards/budgets/links and diff checks pass.

The browser fixtures use a static built Web and intercepted APIs; the PostgreSQL
tests use disposable local databases. The allocation-transparency Docker scenario
has its command UUID fixture updated and typechecked, but was not rerun for this
lot. The Assistant Docker receipt proof belongs to its separate contract. No CI,
production deployment or external provider qualification is inferred here.
