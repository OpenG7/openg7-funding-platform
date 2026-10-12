# Recorded sponsorship commitments

Apply the complete current schema, including
[041](../../apps/funding-api/migrations/041_sponsorship_commitments.sql),
[043](../../apps/funding-api/migrations/043_sponsorship_fulfilment_evidence.sql),
[045](../../apps/funding-api/migrations/045_sponsorship_publication_formats.sql) and
[046](../../apps/funding-api/migrations/046_obligation_reservation_release.sql),
before this API. The [Checkout contract](checkout.md) captures the server offer
before Stripe. Confirmed payment activates obligations once; payment, consent,
moderation, visibility and publication remain independent. Existing financial
facts, issued invoices and queued email bodies are preserved.

`GET /api/admin/sponsorship-commitments?contributionId=<uuid>` returns
`{ commitment }`. The record contains its offer, provenance, version and individual
obligations: benefit, channel, logical destination, ordinal, state, blocking reason,
version, recorded publication format and fulfilment evidence ID. `accepted_offer` refers to a captured Checkout
offer. `historical_unverified` remains `needs_confirmation`, with no invented
offer or obligations. `qualified_historical` records an explicitly reviewed agreement.
The private sponsor follow-up projects provenance, state, the public offer and
`fulfilmentEvidence`: evidence/obligation IDs, channel, destination, provenance,
delivery date, public post URL and dated visibility observation. Admin progress
uses the same projection. Each read shares the dossier database snapshot; the
sponsor read validates its private token first. Evidence projections exclude
administrative reasons, proof message/source/media snapshots, storage keys and contacts.
Its separate `commitment.obligations` projection shows current channel/destination,
format, ordinal, state, version and evidence ID. Blocking reasons use a bounded
public code list; unknown reasons become `null`. An adjustment updates this work
projection without rewriting the accepted offer. Only the token's dossier is read.

Owner-only `POST /api/admin/sponsorship-commitments/qualify` requires:

```text
requestId, contributionId, expectedVersion, confirmation: contributionId,
reason, evidenceReference, offer
```

Historical terms use version `historical-qualification-v1`, integer `amountMinor`
and `currency: "CAD"` matching the original financial fact. Each benefit records
its ID, channel, destination, quantity, required elements and nullable deadline/
duration. Qualification requires a previously unqualified dossier and preserves
its historical provenance; it never invents a past Checkout acceptance or N0.

Owner-only `POST /api/admin/sponsorship-commitments/adjust` requires:

```text
requestId, obligationId, expectedVersion, confirmation: obligationId,
reason, kind: "destination" | "waiver" | "format", target?, format?
```

`target` (`openg7` or `openg20`) is required only for `destination`. Completed or
already waived obligations cannot be rewritten. Both actions return `{ commitment }`,
use transactional audit and immutable change records, replay identical requests and
reject incompatible request UUIDs or stale versions. Adjustments retain the original
offer and revoke delivery authorization with the existing fencing/uncertainty guards.
They authorize no payment, moderation approval or new publication.

The administration dossier's Publication tab contains the owner qualification
and adjustment forms. Historical term rows start empty: quantity, destination,
required elements and any established periods are entered from the agreement,
not current pricing. The confirmed amount/currency are read only. Confirmation
requires the exact dossier/obligation UUID, current version and internal reason;
qualification also requires an evidence reference. Accepted terms and current
obligations are displayed separately. Owner adoption preview pages contain 25 or
50 dossiers and link to this individual review; no bulk mutation is offered.
Uncertain responses retain the original UUID/payload in component memory and
lock new commands until an exact retry. No private draft is written to browser
storage. After closing/reloading, read current server state before any new action.

`format` is required only for a social `format` adjustment: `collective_text`,
`individual_portrait` or `collective_composite`. `image_collection` is refused
with `FORMAT_UNAVAILABLE` while no qualified multi-image adapter exists. Old
offers omit the field and old obligations keep a nullable format: only text is
promised, never a silently upgraded image. Historical qualification may record
an explicitly evidenced format. Original accepted snapshots and their hashes
remain unchanged. Format changes increment the obligation version and revoke
delivery authorization just like destination changes; they do not create a
new approval, payment or evidence of fulfilment.

Refusal, consent withdrawal and refund block pending work without completing or
waiving it. Current media eligibility reuses the approved presentation predicate;
the optional logo is separate. `fulfilled` requires qualified evidence, not a legacy
`published` status or current website visibility alone. Progress counts obligations
from the recorded offer; evidence history remains distinct from current visibility.
Preserved files and historical visibility observations do not qualify current
image rights. Managed historical assets remain `needs_confirmation` until their
usage is established and their current content reviewed; public image routes
can return 404 and a profile without an admissible presentation can disappear.
Legacy logo declarations remain separate from qualified media evidence. See the
[media usage contract](sponsor-media-usage.md) before adopting an existing dataset.

For later social passages, new drafts bind a remaining owned obligation; the
published draft and batch remain historical records. This binding and visual
source selections are reviewed content, not inherited authorization from the
first passage. Current target/format amendments preserve the accepted offer and
hold uncertain provider operations until reconciliation.

The existing administrative publication state includes optional `reliability`
with complete global counts and a dated snapshot, independent of dossier filters,
delivery pages or preparation scans. Open/undated obligations, qualified evidence,
effective capacity, account schedule collisions, uncertain results and reservation/
proof discrepancies are aggregated in SQL. The displayed correlation excerpt is
limited to 50 codes and internal UUIDs; `incidentTotal` counts the complete scope.
GET performs no writes. The complete detector also feeds existing idempotent
operations alert episodes, without configuring or activating any external webhook.

The read-only administrative assistant emits `qualify_commitment` for unknown
terms. Historical published drafts alone remain under monitoring; completion
requires recorded fulfilment evidence or an explicit waiver for every obligation.

Owner-only `GET /api/admin/sponsorship-commitments/adoption-preview` inventories
paid, refunded and disputed business dossiers with `pageSize=25|50|100` and an
optional UUID `cursor`. The response `{ items, pageSize, nextCursor }` distinguishes
`accepted_snapshot`, `qualified_historical`, `legacy_declarations` and `unqualified`.
Declaration counts and obligations with recorded evidence stay distinct. The page
exposes no contacts, private bodies or evidence references; it performs no writes,
external verification, N0 or bulk adoption. Review the original agreement before
using the separate confirmed qualification action. Reads use `Cache-Control: no-store`.

Recorded term changes, authorized live publication dates and qualified fulfilment
enqueue `sponsorship_obligation` email messages in the event transaction. SQL ties
the message to its exact change, approved revision/date with an active obligation
reservation, or immutable evidence ID. The deduplication key includes the event,
obligation and version. Recipients come from confirmed payment records and locale
from stored Checkout metadata; internal reasons are excluded. The existing queue
worker sends after commit, and an uncertain SMTP result keeps its existing hold.
Simulation creates no fulfilment notice. No provider or SMTP is called by enqueue.

The [local adoption and release guide](../operations/sponsorship-delivery-adoption.md)
consolidates owner qualification, aggregate checks and external activation limits.

The stable `changes.ts` exports delegate historical qualification to
[`qualification.ts`](../../apps/funding-api/src/sponsorship-commitments/qualification.ts),
adjustments to [`adjustments.ts`](../../apps/funding-api/src/sponsorship-commitments/adjustments.ts),
and common validation, request fingerprints, history and audit to
[`change-support.ts`](../../apps/funding-api/src/sponsorship-commitments/change-support.ts).
The error class remains a single definition; extraction preserves transaction
ordering and the existing public request contracts.

Targeted tests use synthetic providers and disposable PostgreSQL only:

```sh
node --test tests/sponsorship-commitments.test.mjs tests/public-payments-http.test.mjs tests/sponsorship-progress.test.mjs
node --test tests/integration/sponsorship-commitments.integration.mjs tests/integration/sponsorship-invoice-benefits.integration.mjs tests/integration/sponsorship-progress.integration.mjs
```
