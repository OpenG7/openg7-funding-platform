# Publication feeds: preparation, approval and delivery

The calendar is at `/admin/fundraiser/publications/calendar`. The delivery cockpit
is at `/admin/fundraiser/publications/automation`, with its own calendar including
editorial posts. The three existing publication workspaces remain separate.

Manual slot date/time fields use the slot's selected IANA timezone; draft scheduling
uses `America/Toronto`, matching the calendar. Text-only edits retain the exact
stored instant, including seconds and the selected occurrence during a clock change.
New or edited dates that do not exist or occur twice during a clock change are
rejected: choose a unique local time before saving. Changing a slot's timezone
interprets its entered local date/time in the new timezone.

## Dossier bridge

The sponsorship dossier’s Publication step links to this workspace with
`sponsorshipId=<uuid>` and optionally `deliveryId=<uuid>`. These filters are also
accepted by `GET /api/admin/publication-automation`: they intersect, are validated,
and apply before the 200-delivery limit. Invalid UUIDs return `400 INVALID_FILTER`.
The filtered view includes all delivery states and a return link to step 6.
Counters, worker controls and feed settings remain global. Collective deliveries
retain their full membership: approval still covers the whole displayed post.
A missing delivery is reported without opening another one or composing a batch.

Sponsorship composition now preserves a complete recognition block per source:
title, body and disclosure. Its public identity comes from the dossier; custom
titles receive a separate identity line. Each beneficiary needs a distinct block,
including homonymous dossiers. Incidental mentions do not qualify. Complete blocks
can be reordered and copy added around them. Editorial preferences are retained
only when every block survives and the resulting message stays within the budget.
The check runs at approval, immediately before dispatch and at completion, including
reconciliation. Draft editing still revokes authorization; an incomplete draft
cannot be approved. See the [decision](../decisions/2026-10-11-sponsorship-recognition-blocks.md).
This protects sponsorship `publication_deliveries` with a batch. Legacy social
jobs and manual batch/slot status changes do not use this guard; their convergence
remains part of the open work and cannot be claimed as validated by these checks.

Dossier progress reads the matching automatic delivery by batch and destination,
with legacy job fallback. It exposes its identifier, state, mode, safe error code,
feed pause, date and public result link; it never exposes draft text or credentials.
Live publication evidence completes the matching channel; simulations do not.
Website visibility has its own card and confirmed publish/hide actions in step 6.
Completion requires all promised benefits, including the currently visible website
profile; see the [dossier contract](../admin-ux-lot-4.md#visibilité-web-et-contreparties-livrées).

## Operating model

The global worker switch also gates the private website card preparation added
in migration 027. Payment notifications remain independent of this switch.
See [contribution activity](contribution-activity.md) for that two-second worker,
its reasons and local notification rehearsal. It does not publish website profiles.

1. Configure and check each destination: OpenG7/OpenG20 × Facebook/LinkedIn.
2. Select recurrence weekdays, local time, IANA timezone, capacity and horizon.
3. The worker prepares eligible sponsorship drafts and fills recurring batches,
   including partial batches, without waiting for sponsor review. Preparation
   continues while sending is paused or accounts are not yet connected.
4. Review the **exact** text (maximum 2,900 UTF-16 code units), optional approved
   image, destination account, simulation/live mode and date. Approve each final
   draft once. **Accept and schedule** also approves the explicitly listed pending
   sponsors in the same transaction. Their approved presentation photo remains a
   prerequisite; incomplete dossiers are linked from the review panel.
   News, achievements and campaign updates can also be composed.
5. Resume the feed. The server sends due, authorized content, including when the
   browser is closed. Editing revokes authorization. The cockpit shows exceptions,
   pending approvals, scheduled deliveries and the previous 24 hours of results.

The worker is deterministic. There is no autonomous AI publishing decision, no
publication based on payment alone, and no automatic approval of generated text.
The recurring planner uses public summaries (or a neutral thank-you when absent)
and distinct Facebook/LinkedIn titles;
it does not fetch external news or generate images. Existing approved sponsor
media can be selected; this version supports **one image per publication**.
The existing media workflow manages uploads and review. Editorial text can be
entered directly; videos, multi-image posts and a general editorial asset library
are outside this implementation.

<a id="source-preparation-queue"></a>

## Source preparation queue

Preparation and source repair select complete recognition blocks with the shared
pure policy, including authoritative identities, separators and disclosure. The
budget is 2,900 UTF-16 code units. Existing eligible members are preserved; an invalid
existing batch receives no additional members. An individually impossible source
is left for correction while following sources advance. A source that fits alone
but not in the current batch moves to the next recurrence, together with later
valid sources in their existing `created_at, id` order. New payments do not pass
those deferred sources. Selection never truncates or rejects a source block.

One preparation examines at most 400 new candidates. Valid deferred candidates
remain available to subsequent recurrences in that pass. Individual rendering
failures are recorded transactionally in append-only audit as
`publication_automation.source_render_blocked`, entity `sponsor_publication_draft`.
Only the reason, rendered length, budget, policy version and SHA-256 fingerprint
are recorded; no source body is copied to this diagnostic. Unchanged failures are
excluded **before** the next candidate limit, so 400 impossible sources do not
permanently hide source 401. Correcting the identity or source text invalidates
the fingerprint while preserving its creation date. A policy or budget change
also causes reevaluation. Collective capacity, missing dates and human refusals
never enter this negative cache. Audit failures roll back preparation.
Changes to rendering or individual admissibility must advance
`PUBLICATION_RECOGNITION_POLICY_VERSION` to invalidate older diagnostics.

The cockpit and `GET /api/admin/publication-automation` expose `queue` even when
no delivery exists. Its entries describe private, eligible sources awaiting
preparation or review: retained in a complete final draft, deferred with a reason,
or requiring individual correction. Each entry carries its source/dossier IDs,
destination, complete individual block length, budget, current proposed date or
absence, and any batch/delivery reference. This does not describe an authorized
send or a completed benefit. Authorized, in-flight, uncertain, published and
rejected deliveries stay in their existing delivery/investigation workflows.
A source reserved directly in a manual slot remains visible with
`MANUAL_RESERVATION`; the recurring planner does not reassign it. A final draft
with an ineligible member is reported as an invalid batch, preserving the
remaining eligible sources for review rather than announcing them as retained.

Sources never individually reviewed remain eligible for private preparation.
When a dossier or source already has a moderation decision, only its current N0
permits another assignment; a restriction, open appeal or stale review leaves it
visible as deferred with `MODERATION_REVIEW_REQUIRED`. A final draft whose own
review or any source review is no longer current receives the same diagnosis.
This projection grants no editorial approval and never restores an authorization.
Assigning a previously reviewed source to a batch can invalidate that source's
reviewed revision; review its new revision before treating it as retained.
An explicit repair can still remove financially ineligible members, including
withdrawn consent; its preview lists those removals. This does not restore
moderation approval for the remaining sources or final delivery.

Queue totals cover the full selected scope, independently of the 200-delivery
limit. `sponsorshipId` and `deliveryId` intersect for both lists; existing delivery
counters and controls remain global. `queueOffset` pages only the source list, in
groups of 200. The response includes `total`, `offset`, `limit`, `hasMore`, scope
and evaluation time. Each GET evaluates current facts in a read-only repeatable
snapshot, scanning the full scope in chunks; only the requested page is retained
in memory. This is linear work over the scope and is not a performance guarantee
for an arbitrarily large backlog. Separate pages are fresh reads; corrections or
new arrivals can move their boundaries. Refresh or prepare again to return to
the first page. Older API responses without `queue` show an unavailable state.

The source queue remains independent of the local destination filter for
deliveries. A missing date is explicit. `NO_SLOT_IN_HORIZON` is reported only after
preparation against unchanged source/feed facts and when no compatible batch in
the current horizon can accept that source. Failed composition without a delivery
is visible as `PREPARATION_FAILED`. Open the linked source draft, save the
correction and prepare its destination again; check the confirmed distribution
and approve the exact final proposal separately. Human-edited and blocked final
drafts keep their text: open the delivery, restore the corrected source blocks
and save the final message separately. Preparation does not overwrite these
decisions. Creation dates remain unchanged.
This uses current drafts, not frozen offers or durable benefit obligations;
those, manual-path convergence and effective-account scheduling remain open in
the [construction tasks](../development/sponsorship-publication-tasks.md#sp09).

## Configuration and activation

Apply the missing additive migrations through
`026_create_publication_worker_settings.sql` to the intended
environment using the repository migration procedure. Production migration and
deployment require an explicit operational instruction and verified backup.
Existing batches, drafts and historical jobs are preserved. No backfill is needed.

All feeds start **paused** and the server worker is disabled by default. Migration
023 enables private automatic preparation on all four feeds, including existing
ones, without enabling sending or changing any payment/consent/review decision.
It can be disabled per feed in settings. Set `SOCIAL_PUBLICATION_MODE=mock` for rehearsal.
The **Automatic processing** On / Off switch in the cockpit controls the
30-second worker without restarting the server. Only owners (or the existing
token administrator) can change it. Turning it on requires explicit confirmation:
already approved deliveries can become eligible for sending on active,
connected destinations. It does not change feed pauses, provider mode, credentials
or any publication approval. Turning it off stops new claims and upcoming
preparation; work already in progress may finish, including a provider request
already submitted.

Migration 026 creates a singleton setting with a nullable override: until the
first administrative decision, `SOCIAL_PUBLICATION_WORKER_ENABLED` remains the
default (`false` when absent). An explicit On or Off choice then takes precedence,
persists across restarts and is read by every server instance. Configuration
reads fail closed when the table is absent or inaccessible. Apply the migration
before starting the updated API, and stop old workers that only read the
environment variable. The migration itself does not activate processing.

The worker processes
at most five due deliveries per pass and prepares each enabled feed at most once
per five minutes, with a horizon of 1–28 days and capacity of 1–10 sponsors.
The provider's text limit may result in smaller batches. Empty calendar slots
are reserved; only nonempty batches produce review proposals.

Explicit sponsor destinations/channels take precedence. When unset, confirmed
CAD orders use the existing promised benefit thresholds (Facebook from 25,000
minor units, LinkedIn from 50,000) on OpenG7. Other currencies need explicit
routing. No private sponsor message, contact details or payment amount enters
generated copy. Rejected, hidden, unpaid or nonconsenting sponsors are excluded.

Untouched automatic proposals can fill as new payments arrive; their version
changes and any stale review fails. Overdue untouched proposals are repacked at
the next recurrence. Once a human edits a proposal, the planner preserves that
content and membership. It never rewrites an approved or uncertain delivery.
The preflight eligibility guard can revoke a draft/approved delivery whose
source payment, consent, review, visibility or destination is no longer eligible,
before its due date. A reviewed recomposition returns it to draft; see
[the editorial programme](editorial-programme.md).
**Reject** retains the batch reservation and cannot be undone by the planner;
it rejects that publication, not the sponsor's entire dossier. **Cancel** revokes
a scheduled sending authorization and allows later preparation.

For each target/channel pair, configure server-side:

```text
SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCOUNT_ID
SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN
SOCIAL_PUBLICATION_OPENG7_FACEBOOK_EXPIRES_AT
```

Replace `OPENG7` with `OPENG20` and/or `FACEBOOK` with `LINKEDIN`. LinkedIn account
IDs identify organizations. Expiry is an ISO timestamp obtained from the provider;
when omitted, expiry is unknown, not infinite. The UI does not collect secrets.
Legacy global Facebook/LinkedIn credentials remain a fallback **only for OpenG7**.
Graph/API base URLs and LinkedIn version retain their existing environment keys.
The worker refreshes connection checks every six hours for active configured feeds.

The connection check reads account identity/access without publishing. It is not
a guarantee of every publishing permission. Changing a token or account invalidates
the saved connection check. Expired credentials block authorization/delivery.
There is no OAuth enrollment or automatic token refresh: credential renewal is a
server operation. Live permission verification and a controlled real post remain
necessary before operational activation. No real provider calls are made by tests.

Simulation deliveries are visibly labelled and do not mark sponsorship batches or
drafts as genuinely published. After switching to live, preparing the same batch
archives its completed simulation and requires a fresh content approval.

For isolated rehearsals, the private server-only `SOCIAL_PUBLICATION_MOCK_URL`
option connects mock deliveries to a local HTTP receiver. It is optional; absent,
the existing immediate mock success remains available. Startup rejects the option
unless mode is `mock`, the environment is explicitly development/test, and the URL
uses HTTP on loopback or the acceptance `stripe-stub` hostname, with path
`/__test__/social` and no credentials, query or fragment. Redirects are refused.
The disposable acceptance Compose file supplies this receiver; inherited shell
credentials or URLs cannot override it. It is not a production provider setting.
Changing the receiver invalidates the saved connection check.

The receiver keeps posts and every send request independently of the API process.
Its test-only controls can lose a response after accepting a post or without
creating one. It deliberately does not deduplicate requests, so a worker resend
would remain observable. These controls are part of the isolated fixture server,
not application admin endpoints. Only synthetic content belongs in this receiver.

## Authorization and concurrency

`GET /api/admin/publication-automation` returns safe feed metadata, summaries and
up to 200 recent/actionable deliveries.
`GET /api/admin/publication-automation/media?deliveryId=<uuid>` lists up to 200
approved, eligible assets for that delivery. A sponsorship delivery restricts
the catalogue to contributions belonging to its batch, before applying the limit.
An editorial delivery, or a request without `deliveryId`, uses the global eligible
catalogue. An invalid identifier returns `400 INVALID_FILTER`; an unknown delivery
returns `404 DELIVERY_NOT_FOUND`.
`POST /api/admin/publication-automation` accepts the shared typed
commands for worker control, settings, preparation, composition, editing, approval, rejection, cancellation,
connection checks and reconciliation. All routes use the existing server admin
authentication, role/origin checks and rate limiter. No token is returned.

The sponsorship image field uses the restricted catalogue. Any dossier in the
batch may supply the selected image; editorial composition keeps the global
catalogue. The API enforces this ownership when composing, editing and approving,
independently of the picker. A foreign asset returns `409 MEDIA_NOT_APPROVED`
before storage reads or command writes. Combined acceptance checks ownership
before approving pending dossiers, then verifies media eligibility within the
same transaction after those approvals. A pending dossier's image is absent from
the catalogue until its dossier is approved, but its already saved selection may
be approved through this combined decision.

Each delivery's sponsor metadata includes its current `paymentStatus`, alongside
review and presentation readiness. Clients tolerate its absence from older API
responses. A `SOURCE_NOT_ELIGIBLE` blocked delivery identifies refunded/disputed
sponsors in the review panel and links to the corresponding admin dossier.
These payment facts explain the block; they never authorize a new delivery.

State includes `workerEnabled` and `workerVersion`. The owner-only `worker`
command carries `enabled`, `version` and `confirmation` (`enable-worker` or
`disable-worker`). Changes and audit are committed together. An immediate replay
of the same version and desired state has no additional effect; an intervening
decision returns `409 WORKER_VERSION_CONFLICT`. Refresh before deciding again.
The audit records actor, previous/new state and versions. Worker claims serialize
with the switch, and dispatch checks it again after preflight. If processing was
stopped before dispatch, the claim is released while keeping its authorization.

Approval binds a version, exact message, account, mode, timestamp, source drafts
and media snapshot. Stale versions return 409. Workers recheck consent, review,
payment, hidden status, source content, batch schedule, media hash and destination.
Preparation accepts paid, consenting sponsors with review pending or approved.
Sending requires approval. Combined acceptance lists sponsor IDs and dossier
versions explicitly; stale details, revoked consent, missing presentation media
or failed destination checks roll back the entire decision. Each sponsor approval
and delivery authorization is audited. Approved content is never silently rebuilt.

A submitted dossier revision also invalidates its older delivery authorization.
Preflight blocks an authorized delivery when its sponsor is back in review, or
when `sponsor_details_submitted_at` is later than the delivery's `approved_at`.
The database comparison retains timestamp precision and catches a dossier that
was already reapproved before the worker ran. The same check runs before dispatch.
The submission date uses the database clock at the write, so a transaction begun
before authorization cannot backdate a revision written afterwards.
`SPONSOR_REVIEW_REQUIRED` identifies this case; the cockpit explains the required
review and links to the dossier. Save the exact revised publication as a draft
and explicitly approve it again. Approving the dossier alone never restores the
old delivery authorization. Private autosave and an identical submission retry
do not advance the dossier submission date or invalidate a fresh authorization.
This uses existing columns and requires no migration. A request already sent to
the provider cannot be recalled by a later dossier revision.

Preflight also checks the selected media of sponsorship and editorial deliveries,
including future deliveries on paused feeds. A removed or unapproved asset blocks
the delivery with `MEDIA_NOT_APPROVED`. The same code blocks a sponsorship delivery
whose asset belongs to a contribution outside its batch. A changed metadata version
blocks it with `MEDIA_CHANGED`, even if the asset was rejected and reapproved
between worker passes. The worker clears the old authorization and audits
`media_invalidated` once. Before dispatch it checks the asset again under a database
lock and hashes the stored bytes. Batch membership is checked before reading bytes,
including for older authorized deliveries. A media failure at that stage also
clears authorization.

The cockpit explains the block and, for sponsorship deliveries, links to the
dossier's Media tab. It avoids
loading the invalidated preview, so a removed file does not produce a misleading
generic action-failed message on opening the panel. Approving a
replacement alone does not authorize a delivery: edit the publication, select
the approved replacement or explicitly choose no image, save and approve each
destination again. The worker never substitutes an image or drops one silently.
These checks use existing columns. They cannot recall an already dispatched
request or remove a copy previously downloaded from the website/social network.
The optional local mock receiver records the prepared JPEG's SHA-256 alongside
its media ID, allowing recipes to verify the actual prepared image without
including image bytes in the receipt.

Combined acceptance sets `sponsor_site_visibility_held` for newly approved sponsors:
their site profile, builder identity, logo and public media routes remain private.
Existing website visibility is preserved for previously approved sponsors. The
explicit **Publish profile on the website** action releases this hold after server
validation. New ordinary dossier approvals also set the hold; saving advanced
metadata preserves it. Social preparation/approval never releases it. Image previews use the existing
authenticated admin media endpoint, so private assets can be reviewed without
publishing them on the website. Public queries tolerate pre-023
schemas while the new worker requires both migrations.
Database guards prevent older batch/draft controls from changing the contents,
membership or lifecycle of an authorized, in-flight or uncertain batch. Save the
delivery as a draft or cancel its authorization before changing its source. Mixed
OpenG7/OpenG20 legacy batches must be split before a destination can be approved.

Claims use PostgreSQL row locks with `SKIP LOCKED` and, with migration 042,
a second lease for the effective provider/account/mode tuple. LinkedIn organization
IDs and URNs identify the same account; OpenG7/OpenG20 feeds sharing it serialize
their sends. Live approvals reserve a 60-second technical window. This fixed spacing
is not a provider quota or a promised cadence. Mock spacing is zero, while concurrent
claims remain serialized. Approval checks the database clock after acquiring locks.
Every claim advances the delivery version and account fence. Provider requests,
image-reference persistence and completion check the active authority and five-minute
leases. The first actual dispatch starts live spacing against the database clock;
future recipe times and resumed backlogs cannot bypass it. Other accounts can advance.
An expired or ambiguous lease remains held for investigation, rather than admitting
another send. A legacy overlapping authorization becomes blocked with
`ACCOUNT_SLOT_RESERVED` and an explicit qualification audit; published history is
never silently rewritten. Reprepare and review the exact remaining proposal.
Remote publication, its local result and audit cannot share
one distributed transaction; a timeout, 5xx, missing post ID or failed database
commit after sending therefore **never causes a blind retry**. A definitely
rejected rate limit can retry with bounded backoff (four attempts maximum).
LinkedIn image upload references persist so processing can resume without uploading
a new image each time. Images are read from approved storage, hashed and converted
to JPEG; arbitrary external image URLs are never downloaded.

The old immediate `/publication-batches/publish-social` endpoint returns 409
`FINAL_APPROVAL_REQUIRED`. Its UI action now opens final preparation. Historical
legacy sends in `publishing`, `published` or `failed` block a competing new batch
delivery until their outcome is investigated. During rollout, stop old API workers
before starting the new version; do not run versions with different sending rules
concurrently.

## Exceptions and recovery

- **Blocked/draft `SOURCE_CONTENT_MISSING`:** at least one source block or its dossier identity
  is missing from the final message. Restore the complete block, or correct its
  source under `/admin/fundraiser/publications/drafts`, recompose, save and approve
  again. This also applies to earlier abbreviated authorizations; no historical
  snapshot is silently rewritten. The drawer provides the source-draft link.
- **Uncertain `SOURCE_CONTENT_MISSING`:** a provider response may have been
  received before the content check failed, for example when the dossier identity
  changed during dispatch. Inspect the result observations and actual account.
  This state cannot be edited, and reconciliation applies the same content check:
  a real existing post can therefore remain uncertain. Keep that evidence; never
  attest absence or authorize another send when the post exists. Closing such a
  case requires the dedicated historical/obligation proof work tracked in
  SP19–SP21, rather than rewriting the approved snapshot or forcing published.
  The drawer and reconciliation feedback show investigation guidance in both
  languages, without an edit link or approval action in this state.
- **Blocked:** repair the connection, source, media or date; save the draft and
  approve again. Deliveries more than 24 hours overdue require rescheduling.
  A refunded or disputed payment remains ineligible: editing or approving the
  blocked delivery cannot bypass that requirement. After the worker revokes an
  authorization, replaying an earlier payment confirmation does not restore it.
- **Uncertain:** inspect the actual destination account. For text-only posts,
  supply the existing external ID; the API checks author, exact text and published
  state outside any open transaction. It retains a separate
  `reconciliation_result_observed` audit, then relocks the delivery and rechecks
  version, destination and credentials before qualified completion. A decision
  changed during HTTP or a completion failure preserves that observation without
  granting published status. Provider-verified evidence remains distinct from an
  original provider acknowledgement. A caller-owned transaction is refused with
  `RECONCILIATION_TRANSACTION_UNAVAILABLE`. Image cases require investigation of the image
  as well and are not automatically reconciled by text alone.
  An interrupted send has no automatic retry date. Provider lookup failures
  return `503 REMOTE_POST_UNVERIFIED`, leave the delivery uncertain and explain
  that an inaccessible identifier does not establish absence. Wrong content or
  account still returns `POST_MISMATCH`; neither result records success.
  Reconciliation rejects a changed simulation/live mode before checking the
  external reference, including when the server has been switched to mock mode.
- **Confirmed absent:** only after checking provider history, an operator can
  attest that no post was created and record a non-sensitive reason. This changes
  the job to blocked, revokes approval and releases only that delivery's account
  hold and obligation reservations. A newer blocked moderation decision can carry
  `accountRecoveryRequired`; its reason/restriction survives the same explicit
  absence review. Neither path grants N0, approval, a resend or a refund. An incorrect
  human attestation can still cause a duplicate; it is audited.
- **Pause:** stops future claims; an already submitted provider request cannot be
  recalled. Disabling the worker leaves persistent state available for inspection.
- **Restart/database interruption:** the next worker reconciles expired claims
  into exceptions. Audit or completion failure never returns a false success.
  An active claim's provider response is first committed independently as
  `publication_automation.provider_result_observed`, with delivery, claim version,
  feed, mode and external ID/URL. Replaying the same observation has no new effect;
  a conflicting reference is rejected. Completion failure leaves the delivery
  uncertain and does not mark its batch or sponsors published. If the observation
  itself fails, the uncertainty audit retains those references when writable.
  Inspect both observations and uncertainty audits before attesting absence.
  A database outage or process interruption before either write can still lose
  the local reference and requires inspection of provider history.
  A successful provider response received after claim loss is retained in
  `publication_automation.late_result` with the claim version and external ID/URL;
  it does not change the current delivery or its projections. Inspect this audit
  and provider history before attesting absence or authorizing another attempt.
  A request submitted before lease expiration or revocation cannot be recalled.

With migration 043, `check-visibility` records dated, immutable observations against
the qualified fulfilment evidence. The command requires delivery ID/version,
confirmation and a UUID request ID; an identical replay adds no second observation.
It compares the historical proof's text/account, not an edited current draft.
Verified content is `visible`; a provider mismatch is `changed`; inaccessible
403/404, network failure and unsupported media verification remain `unknown`.
None establishes deletion by assumption. These observations preserve payment,
fulfilled obligations and original evidence. They authorize no replacement send
or automatic compensation. Mock/historical deliveries without qualified evidence
return `VISIBILITY_EVIDENCE_REQUIRED`.

The [provider format qualification](../technical/publication-formats.md) separates
one delivered JPEG from a multi-image collection. Every derived image remains a
media investigation for reconciliation, even when it has no source-asset foreign
key; a composite cannot be qualified through text-only verification.

The cockpit provides the operational summary and exceptions; it does not send a
new daily email or external chat notification. Existing operations monitoring
remains separate. Settings changes affect future recurring slots, not dates already
prepared. Cancel or reschedule existing slots explicitly when changing cadence.

Historical `social_publication_jobs` are exposed by a read-only admin GET endpoint.
The older `buildSocialPublicationText` summary generator and
`publishSocialPublicationJob` sender have no caller in the mounted application
composition; the job creator is exercised only by compatibility/persistence tests.
Their legacy summaries do not feed the active dispatch. Current publication uses
the complete shared recognition renderer and the separate
`publication-automation/provider.ts` worker with exact source approval. An older
job, truncated summary or displayed historical URL grants no new send authority.

## Validation and references

Manual assignments to batches and slots, and slot capacity reductions, now lock
the shared parent before counting and changing membership, in the order slot,
batch, drafts. Coupled schedule changes commit together; failures roll them back.
The future-date guard uses the database clock after lock waits.
Live automatic completion locks the delivery first, then the same slot and batch,
before updating draft and slot projections. A deterministic PostgreSQL test
reproduced a deadlock with the earlier batch-before-slot completion order and
passes with this order; a changed association cannot produce published projections.
`tests/integration/publication-capacity-concurrency.integration.mjs` reproduces
last-place races and checks the corrected paths with disposable PostgreSQL 16.
This does not yet provide a common effective-account reservation, final text
capacity checks on every assignment path, or cross-feed collision prevention;
those remain tracked in [SP07/SP12–SP17](../development/sponsorship-publication-tasks.md#sp12).

`tests/publication-automation.test.mjs` exercises provider payloads, destination
isolation, time zones/DST, error classification, upload resumption and remote checks.
`tests/integration/publication-automation.integration.mjs` uses disposable PostgreSQL
for migrations, concurrent claims/planning, source revocation, approval versions,
stale leases and a database failure after provider success. Browser fixtures cover
exact approval, edits, stale versions, exceptions, mobile focus and accessibility.

[`publication-worker-claims.integration.mjs`](../../tests/integration/publication-worker-claims.integration.mjs)
uses disposable PostgreSQL and simulated provider responses to resume an expired
worker after reconciliation and a newer claim, including late results and image
reference writes. No request reaches an external provider.

[`publication-media-scope.integration.mjs`](../../tests/integration/publication-media-scope.integration.mjs)
uses disposable PostgreSQL to cover foreign-image refusal without command writes
or storage reads, both dossiers of a batch, the global editorial catalogue,
batch filtering before the catalogue limit, combined pending-dossier acceptance,
and revocation of older authorizations before dispatch. These scope checks use
the existing media/source snapshots and require no migration.

### Local connection recovery recipe

`yarn test:e2e:identity` includes
[social-connection-recovery.spec.ts](../../tests/identity/social-connection-recovery.spec.ts).
It requires Node 22, Yarn 4, local Docker with `postgres:16-alpine` and Chromium.
To run only this scenario after the API and production Angular builds:

```sh
yarn exec playwright test --config tests/playwright-identity.config.mjs social-connection-recovery.spec.ts
```

The browser uses the real API, disposable PostgreSQL and a signed local OIDC
provider. The Facebook and LinkedIn HTTP adapters use a local protocol fixture.
Its `live` adapter mode exercises HTTP requests, but both base URLs are fixed to
the fixture's loopback origin, credentials are synthetic, and no `.env` is read.
No external social account is contacted. The receiver deliberately does not
deduplicate posts, so unintended resends remain observable.

The scenario checks missing credentials, an incorrect LinkedIn organization,
expiry before dispatch, a provider `403`, and an independent OpenG20 destination.
After credentials change and the API restarts, connection checks must be renewed;
blocked deliveries remain blocked. A new draft binds the changed destination and
requires fresh, versioned approval. The worker sends after the browser closes,
then restarts and refreshes stale connection checks without sending again.
Assertions also cover reader/anonymous/origin refusals, worker confirmation,
FR/EN mobile layout, accessibility, unchanged financial/email counts, attributed
approval/publication audits and absence of credentials from responses/UI/audit.

Evidence is under `test-results/identity/`: the JSON result and attachments include
the mobile screenshot and synthetic provider receipts/audits. This recipe does not
qualify real provider permissions, OAuth enrollment, token renewal, image upload,
HTTPS or external publication. Those require a separately scoped test environment.

Local evidence, 25 September 2026, Windows / Node 22.23.2, `7f57937` plus these
working-tree changes: the social scenario passed in 132.9 seconds, with 13
provider requests, four send attempts (including the rejected LinkedIn request),
three posts and 38 audit entries. All 31 publication UI tests passed. The recipe
exposed a nested `main` landmark in the cockpit; the page now relies on the admin
layout's existing landmark, and mobile/desktop accessibility checks cover the
whole cockpit. The UI suite's local Web server required manual shutdown after
the assertions; the runner then exited successfully.

The complete identity suite finished with **8 passed / 1 failed**: the SMTP
journey timed out waiting for the accepted result after releasing its local SMTP
gate. The failure also reproduced in isolation and with the unchanged `main`
stack helper, so that run was not fully passing. Diagnostic traces are under
`test-results/identity-smtp-isolated/` and `test-results/identity-smtp-baseline/`.
API and Angular/SSR builds, TypeScript, lint and
targeted formatting passed; existing warnings remain for the 823.59 kB initial
Angular bundle (800 kB budget) and the unused ESLint directive in `smoke-public.mjs`.

The follow-up [SMTP diagnosis and validation](../email-smtp.md#local-mailpit-greeting-delays)
on 25 September identified Mailpit reverse DNS delaying the local greeting.
Disabling that lookup for local test containers restored the complete identity
suite to **9/9 passing**, including this social recovery journey.

### Other delivery recipes

The isolated browser recipe
`tests/playwright/publication-payment-ineligibility-acceptance.spec.ts` follows
three confirmed 500 CAD sponsorships through scheduling, a full refund and a
signed dispute event. It checks that the worker blocks those four deliveries
before their deadline, while the eligible control sends once to each destination.
It also checks payment replay, audit and dossier links. See the
[recipe and limits](../sponsorship-e2e-coverage.md#recette-navigateur--paiement-invalidé-après-programmation).
This does not recall an already submitted provider request or decide whether an
existing public website profile should be withdrawn.

`tests/playwright/publication-uncertain-recovery-acceptance.spec.ts` follows two
lost-response outcomes on both OpenG7 channels, restarts only the disposable API,
then checks verified reconciliation and explicitly approved resending after human
absence review. Provider receipts and audit prove one post per delivery; healthy
controls prove the restarted worker is processing other jobs. See the
[recovery recipe and limits](../sponsorship-e2e-coverage.md#recette-navigateur--résultat-incertain-et-reprise-sans-doublon).

Provider contracts: [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-06),
[LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-06),
[LinkedIn organization roles](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-06),
and [Meta's Page SDK](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/page.js).
