# Preflight proposals inbox

`GET /api/admin/preflight/inbox?page=1&pageSize=20` serves the page
`/admin/fundraiser/preflight`. A valid Funding admin session with `reader`,
`operator` or `owner` rights is required before any upstream call. Responses use
`Cache-Control: private, no-store`. Only GET is supported; missing/expired sessions
and denied permissions remain authentication/authorization failures.

Pagination accepts `page` from 1 to 100000 and `pageSize` from 1 to 100, defaulting
to 1 and 20. Unknown or repeated parameters and client-supplied scope headers
return `400 PREFLIGHT_INVALID_REQUEST`. Tenant and application come only from
server configuration and its signed service token; the upstream read is fixed to
`application=funding-platform&status=prepared`.

| HTTP | `state`       | Meaning                                                                                    |
| ---- | ------------- | ------------------------------------------------------------------------------------------ |
| 200  | `disabled`    | Inbox disabled; no upstream call, empty items and zero total.                              |
| 200  | `ready`       | Remote page with `items`, `total`, `page`, `pageSize`; an empty page is a successful read. |
| 503  | `unavailable` | `PREFLIGHT_UNAVAILABLE`: transport or service failure.                                     |
| 502  | `unavailable` | `PREFLIGHT_RESPONSE_INVALID`: invalid upstream contract; no partial proposals returned.    |

The response includes a configured public HTTPS `consoleUrl`, or null. Proposal
metadata contains source/version, explanations, checks, limitations, blockers and
explicit simulation provenance. Draft bodies and dossier links are not included.
`authority=source_application` and `businessDecisionExecuted=false` preserve
Funding's authority. This is a remote view of proposals available in Preflight;
it does not import them durably, start a new worker or approve a business action.
The separate [local rehearsal dashboard](preflight-rehearsals.md) can submit and
observe explicitly synthetic missions when its own local-only flag is enabled.
Public response types live in
[funding-core](../../packages/funding-core/src/preflight-inbox.ts).

The [configuration example](../../.env.example) documents the server-only
`PREFLIGHT_INBOX_ENABLED`, HTTPS endpoints, tenant/client identifiers and protected
client-secret file path; the console URL alone is public. Add the explicit
[inbox Compose overlay](../../docker-compose.preflight-inbox.yml) to the existing
stack and retain it, together with its private environment file, on subsequent
recreations. It disables the producer and stages the read-only secret source into
an API-owned tmpfs directory `0700`, file `0400`, before executing the normal API
process. This preserves strict file checks even with Docker Desktop host mounts.

Provision a dedicated client with the Preflight `service_integration` role and
the exact tenant/application scope. That machine role also permits integration
writes; the Funding inbox transport restricts requests to its OAuth token POST
and proposal GET. Credentials remain on the server. For local CA/HTTPS and shared
Keycloak, see the [local identity guide](../operations/keycloak-local.md) and
`docs/shared-realm-sso.md` in the Preflight checkout; never disable TLS checks.
