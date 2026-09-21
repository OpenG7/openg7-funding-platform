# Publication feeds: preparation, approval and delivery

The calendar is at `/admin/fundraiser/publications/calendar`. The delivery cockpit
is at `/admin/fundraiser/publications/automation`, with its own calendar including
editorial posts. The three existing publication workspaces remain separate.

## Operating model

1. Configure and check each destination: OpenG7/OpenG20 × Facebook/LinkedIn.
2. Select recurrence weekdays, local time, IANA timezone, capacity and horizon.
3. Prepare eligible sponsorship drafts and fill recurring batches. A full batch
   becomes a final draft; partial batches can be prepared from their calendar detail.
4. Review the **exact** text (maximum 2,900 UTF-16 code units), optional approved
   image, destination account, simulation/live mode and date. Approve each final
   draft once. News, achievements and campaign updates can also be composed.
5. Resume the feed. The server sends due, authorized content, including when the
   browser is closed. Editing revokes authorization. The cockpit shows exceptions,
   pending approvals, scheduled deliveries and the previous 24 hours of results.

The worker is deterministic. There is no autonomous AI publishing decision, no
publication based on payment alone, and no automatic approval of generated text.
The recurring planner uses public summaries and distinct Facebook/LinkedIn titles;
it does not fetch external news or generate images. Existing approved sponsor
media can be selected; this version supports **one image per publication**.
The existing media workflow manages uploads and review. Editorial text can be
entered directly; videos, multi-image posts and a general editorial asset library
are outside this implementation.

## Configuration and activation

Apply additive migration `022_create_publication_automation.sql` to the intended
environment using the repository migration procedure. Production migration and
deployment require an explicit operational instruction and verified backup.
Existing batches, drafts and historical jobs are preserved. No backfill is needed.

All feeds start **paused**, automatic preparation starts **off**, and the server
worker is disabled by default. Set `SOCIAL_PUBLICATION_MODE=mock` for rehearsal.
`SOCIAL_PUBLICATION_WORKER_ENABLED=true` enables the 30-second worker. It processes
at most five due deliveries per pass and prepares each enabled feed at most once
per hour, with a horizon of 1–28 days and capacity of 1–10 sponsors.

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
commands for settings, preparation, composition, editing, approval, cancellation,
connection checks and reconciliation. All routes use the existing server admin
authentication, role/origin checks and rate limiter. No token is returned.

Approval binds a version, exact message, account, mode, timestamp, source drafts
and media snapshot. Stale versions return 409. Workers recheck consent, review,
payment, hidden status, source content, batch schedule, media hash and destination.
Only approved, public, paid sponsorships may enter recurring preparation, and only
for their selected feed/channel. Approved content is never silently rebuilt.
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
