# Publication feeds: preparation, approval and delivery

The calendar is at `/admin/fundraiser/publications/calendar`. The delivery cockpit
is at `/admin/fundraiser/publications/automation`, with its own calendar including
editorial posts. The three existing publication workspaces remain separate.

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
up to 200 recent/actionable deliveries. `GET .../media` lists up to 200 approved,
eligible assets. `POST /api/admin/publication-automation` accepts the shared typed
commands for worker control, settings, preparation, composition, editing, approval, rejection, cancellation,
connection checks and reconciliation. All routes use the existing server admin
authentication, role/origin checks and rate limiter. No token is returned.

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
the delivery with `MEDIA_NOT_APPROVED`; a changed metadata version blocks it with
`MEDIA_CHANGED`, even if the asset was rejected and reapproved between worker
passes. The worker clears the old authorization and audits `media_invalidated`
once. Before dispatch it checks the asset again under a database lock and hashes
the stored bytes. A media failure at that stage also clears authorization.

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
Existing website visibility is preserved for previously approved sponsors. Saving
the dossier's explicit **visibility/publication settings** releases this hold;
ordinary social preparation/approval never does. Image previews use the existing
authenticated admin media endpoint, so private assets can be reviewed without
publishing them on the website. Public queries tolerate pre-023
schemas while the new worker requires both migrations.
Database guards prevent older batch/draft controls from changing the contents,
membership or lifecycle of an authorized, in-flight or uncertain batch. Save the
delivery as a draft or cancel its authorization before changing its source. Mixed
OpenG7/OpenG20 legacy batches must be split before a destination can be approved.

Claims use PostgreSQL row locks with `SKIP LOCKED`. A five-minute expired claim
becomes `uncertain`. Remote publication, its local result and audit cannot share
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

- **Blocked:** repair the connection, source, media or date; save the draft and
  approve again. Deliveries more than 24 hours overdue require rescheduling.
  A refunded or disputed payment remains ineligible: editing or approving the
  blocked delivery cannot bypass that requirement. After the worker revokes an
  authorization, replaying an earlier payment confirmation does not restore it.
- **Uncertain:** inspect the actual destination account. For text-only posts,
  supply the existing external ID; the API checks author, exact text and published
  state before recording success. Image cases require investigation of the image
  as well and are not automatically reconciled by text alone.
  An interrupted send has no automatic retry date. Provider lookup failures
  return `503 REMOTE_POST_UNVERIFIED`, leave the delivery uncertain and explain
  that an inaccessible identifier does not establish absence. Wrong content or
  account still returns `POST_MISMATCH`; neither result records success.
  Reconciliation rejects a changed simulation/live mode before checking the
  external reference, including when the server has been switched to mock mode.
- **Confirmed absent:** only after checking provider history, an operator can
  attest that no post was created and record a non-sensitive reason. This changes
  the job to blocked, revokes approval and permits new preparation/approval. An
  incorrect human attestation can still cause a duplicate; it is audited.
- **Pause:** stops future claims; an already submitted provider request cannot be
  recalled. Disabling the worker leaves persistent state available for inspection.
- **Restart/database interruption:** the next worker reconciles expired claims
  into exceptions. Audit or completion failure never returns a false success.

The cockpit provides the operational summary and exceptions; it does not send a
new daily email or external chat notification. Existing operations monitoring
remains separate. Settings changes affect future recurring slots, not dates already
prepared. Cancel or reschedule existing slots explicitly when changing cadence.

## Validation and references

`tests/publication-automation.test.mjs` exercises provider payloads, destination
isolation, time zones/DST, error classification, upload resumption and remote checks.
`tests/integration/publication-automation.integration.mjs` uses disposable PostgreSQL
for migrations, concurrent claims/planning, source revocation, approval versions,
stale leases and a database failure after provider success. Browser fixtures cover
exact approval, edits, stale versions, exceptions, mobile focus and accessibility.

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
