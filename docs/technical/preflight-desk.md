# Funding operational desk in Preflight

`GET /api/admin/preflight/desk` is an authenticated read-only Funding projection.
It reuses the campaign source query, preparation receipts, publication workflow
and qualified fulfilment evidence. It neither submits missions nor creates
approvals, publications, payments or business records.

The existing service-delivery demonstration is presentation-only. This desk uses
real recorded sponsorship obligations instead. Its commercial groups are Funding
contributions with their recorded commitment and public reference; they do not
introduce a universal order or a second service-execution engine.

Query: `page` 1–100000, `pageSize` 10/20/50 (default 20), `stage`
`all|to_prepare|to_review|to_deliver|delivered`, and optional `search` of at most
120 characters. Repeated/unknown fields and control characters are rejected.
The existing admin authorization allows readers, operators and owners to read.
Responses are `private, no-store`; mutations return 405. Invalid queries return
400; unavailable storage or projections return 503, never an empty success.

The universe is paid-at sponsorship contributions with active commitments and
recorded accepted/qualified offers, as in the existing campaigns API. Recorded
`adjusted` obligations are excluded and counted separately as `excludedAdjusted`;
they are waived work, not deliveries. Historical unqualified promises are not
silently invented. Every other recorded passage belongs to exactly one bucket:

| Stage        | Evidence                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `delivered`  | Obligation fulfilled, qualified exact evidence and workflow `complete/publication_done`.                                                                                                                                                         |
| `to_deliver` | An exact live delivery in approved/publishing state, with the existing workflow proving scheduling, retry, publishing, pause or disabled-worker state. A website duration already started by its own dated observation also remains in delivery. |
| `to_review`  | Current content exists and its preparation is ready, review-required or approved; final delivery authority is not established.                                                                                                                   |
| `to_prepare` | Remaining work, including missing or incomplete usable preparation.                                                                                                                                                                              |

An approved preparation receipt alone grants no publication right. An approved
delivery belonging to another obligation or ordinal cannot authorize this one.
An old published declaration, a URL or a mocked publication cannot establish
delivery. Blockers and uncertainty are complementary attributes, never extra
entries in these four totals. Existing Funding workflows continue to own the
decisions and their version/audit checks.

The response includes `generatedAt`, `summary`, complete `orders`, and dossier
`pagination`. Search defines the summary universe; the stage filter selects
groups containing matching services while retaining each group's complete
non-waived service list. Summary counts therefore remain stable when changing
the stage filter. Groups are paginated after aggregation, not split by passage.
The total and its four stage counts derive from one repeatable-read, read-only
database snapshot. Preparation/progress queries are cached per contribution.

The source metadata includes integer minor units as a decimal string and a
separate currency; no cross-currency financial aggregate is created. Each service
retains `AdminCampaignItem` facts and adds its stage, blockers and an exact
`reviewUrl` to the existing campaigns page, scoped by contribution/obligation IDs.
Opening or closing a card does not mutate or reload its business source.

Cards show the company name first and the public reference beneath it when
distinct; an unnamed contribution shows its reference once. Status cards,
badges and preparation panels use the active admin palette in mineral, night
and graphite themes. Search controls wrap within the available page width.

Preparation origin is explicitly `funding`, and `preflightLink=unverified`.
The external inbox's synthetic and generic source references are not matched
to commercial records by names, dates or amounts. Adopting an external draft
requires a separately validated commitment/version/snapshot binding and the
existing human review; this projection does not claim that contract is active.
The full Preflight proposal body, media analysis and destination-specific
approvals remain owned by their existing systems and contracts.

Public shapes: [preflight-desk.ts](../../packages/funding-core/src/preflight-desk.ts).
Existing sources: [campaigns](../../apps/funding-api/src/admin-campaigns.service.ts),
[commitments](sponsorship-commitments.md), and the
[read-only external inbox](preflight-inbox.md).
