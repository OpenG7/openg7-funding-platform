# Public API and journeys

Reference extracted from the main README. Read only the relevant section; current
feature guides and implementation define the exact contract. Commands run from
the repository root. [Documentation index](../README.md).

## Public sponsorship page

Approved, consented sponsorships are exposed through:

```text
GET /api/public/sponsorships
GET /api/public/sponsor-logos/<file>
```

The public pages are:

```text
/commanditaires
/en/commanditaires
```

Eligibility requires `public_display_consent=true`,
`sponsor_review_status=approved`, a company name and an approved, undeleted
presentation image. The existing policy allows `paid`, `refunded` and
`disputed` records; inclusion is not a statement of the current payment balance.
The separate visibility hold after combined social approval must also be respected;
see [publication approval and visibility](../operations/publication-automation.md).
Amounts require separate consent. Private contacts, Stripe IDs and internal
notes are never exposed. See [pagination, totals and visibility](../public-sponsors.md)
and the separate [builders directory](../public-builders-and-support.md).

## Usage and refund policy

The public policy pages are:

```text
/politique-utilisation-remboursement
/en/politique-utilisation-remboursement
```

They explain contribution use, Stripe payment handling, refund requests,
disputes, sponsorship review, feed visibility, and privacy limits. Keep this
policy reviewed before accepting real payments.

## Sponsorship follow-up links

Paid sponsorships receive a non-guessable follow-up token when Checkout is
created. The token is stored server-side as a hash, is no longer written to new
Stripe metadata as a raw secret, and expires after
`FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS` days. The public recovery/status
page is:

```text
/fonds-des-batisseurs/suivi-commandite?token=...
```

It can reload the sponsorship status and resubmit company details through:

```text
GET /api/sponsorship-followup?token=...
POST /api/sponsorship-followup/details
```

When PostgreSQL, SMTP email configuration, and the required migrations are
configured, the `checkout.session.completed` webhook queues the follow-up link
and creates an app-generated sponsorship invoice snapshot for the Stripe
customer email. The invoice includes a stable invoice number, issuer details,
sponsor recipient snapshot, Stripe references, line item, totals, tax label,
and a non-charity receipt disclaimer. Without email configuration, the immediate
Stripe return shows a tokenized follow-up action. Recovery from the follow-up
page or `/support` sends a new private link to the payment email when SMTP is
available. Admin owners in OIDC mode can also resend access from the dossier.
Text drafts are saved server-side with revision checks; saving a draft does not
submit it for review. See [recovery and drafts](../sponsorship-access-and-drafts.md).
Admins can still see paid but incomplete sponsorships from the admin screen. If
details are
resubmitted after approval, the sponsorship returns to `pending_review` before
any public display continues. Without PostgreSQL, Stripe-direct transparency
still works, but the recoverable sponsorship follow-up and public sponsor
profile lifecycle are not available.

API rate limits cover checkout, sponsorship follow-up, access recovery,
public reference lookup, reference recovery, admin authentication and sponsorship routes.
Configure the window and limits with
`FUNDING_RATE_LIMIT_WINDOW_MS`, `FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX`,
`FUNDING_SPONSORSHIP_FOLLOWUP_RATE_LIMIT_MAX`,
`FUNDING_REFERENCE_RECOVERY_RATE_LIMIT_MAX`,
`FUNDING_REFERENCE_LOOKUP_RATE_LIMIT_MAX`, and
`FUNDING_ADMIN_RATE_LIMIT_MAX`; keep proxy-level limits enabled as a second
layer in production.

## Public read-only endpoint

Endpoint:

- `GET /api/public/fund-transparency`

Returns only aggregated values:

- `total_received`
- `total_fees`
- `total_net`
- `total_refunded`
- `total_payouts`
- `current_available_estimate`
- `contributions_count`
- `currency`
- `monthly_summary`
- `latest_public_allocations`
- `last_updated_at`

## Frontend transparency page

Public route:

- `/fonds-des-batisseurs/transparence`

The page consumes `/api/public/fund-transparency` and displays civic, readable aggregate reporting with an explicit privacy statement.
See the [current transparency contract](../funding-transparency.md) for fee
completeness, source/freshness fields, monthly filters and exports.

## Public routing and performance

The main funding page stays eager; secondary public and admin pages load on
demand. The production initial-bundle budgets are 800 kB (warning) and 900 kB
(error). The build prerenders 24 routes, including `/404` and `/en/404`.
Nginx serves unknown URLs with localized HTTP 404 pages; only explicitly
declared client-rendered routes receive the application shell.
