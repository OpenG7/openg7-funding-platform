# Publication feeds: preparation, approval and delivery

The calendar is at `/admin/fundraiser/publications/calendar`. The delivery cockpit
is at `/admin/fundraiser/publications/automation`, with its own calendar including
editorial posts. The three existing publication workspaces remain separate.

## Operating model

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

Apply additive migrations `022_create_publication_automation.sql` and
`023_prepare_publications_for_human_review.sql` to the intended
environment using the repository migration procedure. Production migration and
deployment require an explicit operational instruction and verified backup.
Existing batches, drafts and historical jobs are preserved. No backfill is needed.

All feeds start **paused** and the server worker is disabled by default. Migration
023 enables private automatic preparation on all four feeds, including existing
ones, without enabling sending or changing any payment/consent/review decision.
It can be disabled per feed in settings. Set `SOCIAL_PUBLICATION_MODE=mock` for rehearsal.
`SOCIAL_PUBLICATION_WORKER_ENABLED=true` enables the 30-second worker. It processes
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
content and membership. It never changes an approved or uncertain delivery.
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

## Authorization and concurrency

`GET /api/admin/publication-automation` returns safe feed metadata, summaries and
up to 200 recent/actionable deliveries. `GET .../media` lists up to 200 approved,
eligible assets. `POST /api/admin/publication-automation` accepts the shared typed
commands for settings, preparation, composition, editing, approval, rejection, cancellation,
connection checks and reconciliation. All routes use the existing server admin
authentication, role/origin checks and rate limiter. No token is returned.

Approval binds a version, exact message, account, mode, timestamp, source drafts
and media snapshot. Stale versions return 409. Workers recheck consent, review,
payment, hidden status, source content, batch schedule, media hash and destination.
Preparation accepts paid, consenting sponsors with review pending or approved.
Sending requires approval. Combined acceptance lists sponsor IDs and dossier
versions explicitly; stale details, revoked consent, missing presentation media
or failed destination checks roll back the entire decision. Each sponsor approval
and delivery authorization is audited. Approved content is never silently rebuilt.

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
- **Uncertain:** inspect the actual destination account. For text-only posts,
  supply the existing external ID; the API checks author, exact text and published
  state before recording success. Image cases require investigation of the image
  as well and are not automatically reconciled by text alone.
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

Provider contracts: [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-06),
[LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-06),
[LinkedIn organization roles](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-06),
and [Meta's Page SDK](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/page.js).
