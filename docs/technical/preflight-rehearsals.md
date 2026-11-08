# Local Preflight rehearsal dashboard

The Preflight page in Funding can run an explicitly synthetic dossier through
the real local Funding backend, Preflight API and Preflight worker. Its indicators
follow acknowledged requests and persisted mission/task/result states. A complete
preparation remains a proposal for human review; it does not approve a business
action. The local AI provider is simulated and the returned provenance remains
visible. Rehearsals are separate from the [read-only inbox](preflight-inbox.md).

Activation requires `PREFLIGHT_REHEARSAL_ENABLED=true`, a Funding environment of
`development` or `test` and the configured HTTPS localhost public URL. Production
activation is rejected by the backend. The default is disabled. Server credentials
are the existing scoped Preflight service client; no human token or client secret
enters the browser. The rehearsal transport is separately bounded to mission
submission and observation; the inbox transport keeps its read-only restriction.

The [configuration example](../../.env.example) documents the flag and private
storage directory. Layer the [rehearsal overlay](../../docker-compose.preflight-rehearsal.yml)
after the [inbox overlay](../../docker-compose.preflight-inbox.yml), retaining the
existing local TLS and identity files. A private environment file may contain only
the explicit rehearsal flag and directory; retain the existing private inbox
environment file for the protected secret path and configured HTTPS endpoints.

```sh
docker compose --env-file .env --env-file var/preflight-inbox/inbox.env --env-file var/preflight-inbox/rehearsal.env -f docker-compose.yml -f docker-compose.local-tls.yml -f docker-compose.identity.yml -f docker-compose.identity.local.yml -f docker-compose.preflight-inbox.yml -f docker-compose.preflight-rehearsal.yml config --quiet
```

Do not display the interpolated composition or place private configuration in
Git. Keep both explicit overlays and environment files on subsequent local API
recreations. No Keycloak account, realm, certificate or business database changes
are required for this dashboard.

The API runs as UID 1000. Its image pre-creates `/app/var/preflight-rehearsals`
with mode `0700`; the named volume inherits this ownership when first created.
The volume persists run records across API restarts and recreations, separately
from Funding business data and Preflight's own database. File-backed Windows
mounts can report `0777` despite private host ACLs, so a Docker named volume is
used for these private records. The existing client-secret source stays read-only
and is copied into its private runtime tmpfs when either inbox or rehearsal is
enabled. Never disable TLS or expose a database port for this recipe.

Run identifiers and mission/event identifiers must remain stable during a retry.
An uncertain acknowledgement requires reconciliation before resubmission. The
dashboard displays source version, timestamps, blocking states and safe errors;
it does not turn a timeout into success or silently create another run. Funding
retrieves the returned proposal from Preflight rather than receiving a push.
The detailed API contract and runtime limits are maintained with the rehearsal
implementation and its public Funding types.

## Private API contract

The following routes require a valid Funding admin session. `reader`, `operator`
and `owner` may observe; only `operator` and `owner` may launch or resume. Every
POST requires an Origin exactly equal to the configured Funding public origin
and a JSON body of at most 2048 bytes. Unknown fields, query parameters and
caller-supplied tenant/application/role scope headers are rejected. Both
`/api/admin` and `/admin` prefixes are supported. Recipe responses use
`Cache-Control: private, no-store`; authentication failures remain private admin
responses with `no-store`.

| Method | Path                                         | Request and effect                                                                                                          |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/preflight/rehearsals`            | Lists recent runs and observes the latest, if present.                                                                      |
| POST   | `/api/admin/preflight/rehearsals`            | `{ "requestId": "<uuid>", "scenario": "standard" }`; persists and submits one fixed synthetic mission.                      |
| GET    | `/api/admin/preflight/rehearsals/:id`        | Observes the selected run; never submits or resumes a mission.                                                              |
| POST   | `/api/admin/preflight/rehearsals/:id/resume` | Empty JSON object `{}`; reconciles the existing mission first and resends only when Preflight confirms it was not received. |

The second supported scenario, `missing_input`, deliberately omits required
information. Its expected result is a real Preflight `waiting_input` state, with
the returned-proposal step still pending. It demonstrates a blocked preparation;
it does not fabricate a completed output. `standard` can reach `review_ready`,
then Funding verifies the source snapshot, versions, correlation, result checks
and simulated provenance before recording the returned proposal.

The common response is `{ enabled, canLaunch, consoleUrl, run, runs }`. A disabled
GET returns `enabled=false`, `canLaunch=false`, `run=null`, `runs=[]` without
reading the store or contacting Preflight. POST while disabled returns 409.
An empty enabled journal has `run=null`. Public types are defined in
[funding-core](../../packages/funding-core/src/preflight-rehearsal.ts).

`run` contains its scenario, synthetic source reference and source version, stable
mission ID, delivery state, mission status, timestamps, six steps, observed tasks,
verified proposals/output and a safe error when present. The step keys are
`created`, `submitted`, `processing`, `prepared`, `returned`, `review`; their
states are `pending`, `active`, `confirmed`, `attention`, `failed`. Delivery is
`prepared`, `sending`, `acknowledged`, `uncertain` or `rejected`. A 200 run response
can still describe an unavailable service, uncertain submission or blocked work;
the UI must inspect the run state instead of treating HTTP success as completed
preparation. The terminal flag stops automatic observation and leaves manual
inspection/recovery available.

The request UUID is the persisted run key. Replaying the same UUID and scenario
returns that run; changing the scenario for that UUID returns
`409 PREFLIGHT_REHEARSAL_IDEMPOTENCY_CONFLICT`. A retry retains its mission and
event identifiers. Standard and missing-input runs both use the existing
`sponsorship-preparation-v1` workflow with `maxCostUsd=0`, mandatory human review
and `expectedSimulation=true`. The machine role is not limited to reads, so the
dedicated recipe transport itself restricts submissions to these synthetic
constraints and observation to mission GET requests.

The private single-API journal allows at most 100 runs, 512 KiB per run and 200
audit entries per run; it refuses further work at its limit without deleting
older evidence. Atomic files have mode `0600`; the directory is `0700`. Symlinks,
wrong owners/permissions on POSIX and invalid stored records fail closed. Runs
are retained for audit and restart recovery. This storage is scoped to the
configured tenant and is not a substitute for the durable business connector.

Validation failures return 400, unauthorized roles/origins 403, unsupported
methods 405 and content types 415. Missing runs return 404. Disabled launch,
idempotency conflicts and capacity/audit limits return 409. Storage or unexpected
service failures return safe 503 responses. Remote execution failures normally
remain visible in `run.error`, with no secret or provider response body exposed.
