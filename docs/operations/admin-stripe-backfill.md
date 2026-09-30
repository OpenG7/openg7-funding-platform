# Stripe payment recovery

After migration `028`, `/admin/fundraiser/contributions` provides **Sync with
Stripe**. Preview, receipts and execution require owner access (or the existing
authenticated token mode); anonymous local development access is refused. No
Stripe key, database URL or project override is accepted from the browser.

`POST /api/admin/stripe-backfill` accepts one of:

```json
{
  "action": "preview",
  "scope": { "from": "2026-09-01", "to": "2026-09-27", "limit": 100 }
}
```

```json
{
  "action": "execute",
  "id": "<preview UUID>",
  "confirmation": "test:<preview UUID>"
}
```

Dates cover inclusive UTC creation days, up to 31 days ending today; the upper
timestamp is frozen when previewed. Limit is 1–100 per Stripe list. Project and
account come from the server. Test/live mode is shown before confirmation; live
keys require the production environment and `live:<preview UUID>` confirmation.
Preview performs no financial writes, but persists a receipt and audit. It expires
after ten minutes and is bound to the actor, credential, account, project and
scope. Execution rechecks Stripe facts; preview counts are estimates, not a frozen
set of financial facts. Filters cannot be changed on an existing preview.

The UI checks dates and the integer limit before requesting a preview. The 7-day
and 31-day shortcuts include today in UTC; changing the scope clears the preview.
Settings can be collapsed after previewing, while the scope, mode and counters
remain visible. An expired preview disables execution and offers a new preview,
including when expiry occurs while the confirmation dialog is open. The API
remains authoritative for validation and expiry; the browser timer grants no
execution rights.

Responses contain `{ "run": ... }`: ID, status, mode, account/project, scope,
expiry and counts. `GET /api/admin/stripe-backfill?id=<UUID>` reads the actor's
receipt; without ID it reads their latest receipt, or `null`. Both route prefixes
`/admin` and `/api/admin` work. Responses are private/no-store. Errors use fixed
codes: invalid input/confirmation `400`, authentication `401`, role/origin `403`,
missing receipt `404`, busy/expired/changed preview `409`, unsupported content
type `415`, unavailable Stripe/storage/audit `503`.

An authenticated owner can still receive `403 ORIGIN_FORBIDDEN` when the browser
address is missing from `FUNDING_ALLOWED_ORIGINS` and differs from
`FUNDING_PUBLIC_BASE_URL`. The UI distinguishes this address refusal from a role
denial. Local startup with `yarn docker:up:dev` adds `https://localhost` and
`https://127.0.0.1` to the API's allowed origins, preserving configured origins;
recreate the local API with this command after updating the script. Use
`--no-stripe-webhook` if a relay is already running. Production and other modes
retain their configured origins. Keep origin validation enabled.

Only one admin recovery runs per project in the database. Repeating a confirmed
ID returns its receipt without re-execution. Start and result are durably audited;
financial writes use the existing idempotent CLI/webhook engine. No payout import,
new charge, refund request, historical email, invoice generation or publication
is triggered. Existing refund/dispute facts are reconciled. Sessions without
matching project metadata are excluded; legacy consent is not assumed.

Statuses are `preview`, `running`, `completed`, `failed`, `interrupted`. A lost
HTTP response requires a receipt read, never an automatic mutation retry. An
orphaned running receipt is marked interrupted once its execution lock is gone.
Failure/interruption can leave partial financial writes; preview counts are not
an applied-total report in these states. Inspect contributions and audit, then
prepare and confirm a new preview to resume. API restart does not resume imports.
Stripe calls time out after ten seconds without automatic retries; the loop checks
a one-minute deadline between objects. Narrow the range when a cap or timeout is
reached. Refund/dispute creation dates and late fees may require another period
or subsequent webhook delivery.

Validation uses `tests/integration/admin-stripe-backfill.integration.mjs` with
disposable PostgreSQL and synthetic Stripe, plus the focused
`admin-stripe-backfill-ui.spec.ts` in the admin UI suite. These tests do not import
real Stripe payments. API, Web and migration must be delivered together.
