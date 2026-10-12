# Publication reliability: read-only incidents

The existing Reliability panel in `/admin/fundraiser/publications/automation`
keeps complete aggregate counters independent of dossier, delivery and source
queue filters. Its first 50 correlations remain available in the state response.
Each correlation now includes safe persisted dossier, delivery, batch or slot
identifiers when a corresponding object exists. No provider account identifier,
contact, private source text, storage key or evidence body is copied.

## Incident examination

`GET /api/admin/publication-automation/incidents` and its `/admin/` alias require
the existing admin session and API role guard. Readers, operators and owners may
read this endpoint; it has no write method. Filters are optional `code` and
`subjectType` (`obligation`, `delivery`, `batch`, `slot`). Invalid values or malformed
continuations return `400 INVALID_FILTER` before persistence access.

The response contains `scope: global`, `evaluatedAt`, `globalTotal`,
`filteredTotal`, `limit: 50`, `incidents`, `snapshot` and `nextCursor`. `globalTotal`
counts every persisted incident; it is never derived from a response page or the
selected filters. `filteredTotal` describes the complete matching set.
Ordering is stable by `code, subjectType, subjectId`; continuation uses these keys
rather than an offset. The opaque cursor binds that position to its filters and
an incident-set fingerprint. Do not construct a cursor or move it between filters.

Every page owns a `REPEATABLE READ READ ONLY` transaction. The fingerprint covers
all incident keys and their safe object correlations. If this set changes between
HTTP requests, continuation fails with `409 RELIABILITY_SNAPSHOT_CHANGED`; the
panel asks the administrator to refresh and start again. No database snapshot or
connection remains open between requests. This detects incident-set changes; it
does not freeze unrelated metrics, provider facts or the state of linked pages.

The panel loads pages on explicit interaction, shows global and filtered totals,
and supports filters, previous/next and refresh. Late replies cannot replace a
newer filter or a disposed page. A refused continuation never restarts itself.

## Actions and links

Every incident explains its reason and expected next step in French and English.
Links use the existing selection parameters of the dossier (`sponsorshipId`,
`tab=publication`), delivery (`deliveryId`), batch (`batchId`) and calendar
(`slotId`) workspaces. Opening a correlation does not compose, approve, publish,
waive, release a reservation or retry a provider operation.

An uncertain result directs the administrator to the existing reconciliation
workflow. Reservation, lease and proof discrepancies require examination;
technical corrections retain their existing authorization and audit requirements.
No diagnostic repairs data automatically or removes immutable publication evidence.

The complete detector remains shared with operation-alert episodes; the 50-item
page limit never restricts alerts. A documented expired deadline and a promised
deadline without a recorded origin emit `SPONSORSHIP_DEADLINE_EXCEEDED` and
`SPONSORSHIP_DEADLINE_ORIGIN_UNKNOWN` respectively for open or blocked obligations.
Their counts and pending website durations are global. A payment/moderation block
does not erase a documented late commitment; an adjusted or fulfilled obligation
does not emit these deadline incidents. Timing facts come from migration 051;
no historical origin is inferred by the reliability reader. Implementation owners are
`publication-automation/reliability-facts.ts`, `reliability.ts`,
`reliability-incidents.ts`, their public repository port, and the existing Web
panel with its read-only paging controller. The shared DTOs live in
`packages/funding-core/src/publication-reliability.ts`.
