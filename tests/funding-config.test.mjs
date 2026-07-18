import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { OPENG7_FUNDING_CONFIG } from '../dist/apps/funding-web/src/app/features/funding/config/openg7-funding.config.js';
import {
  createMockCheckoutResult,
  DEFAULT_SPONSORSHIP_PRICING_CONFIG,
  isValidSponsorshipAmount,
  resolveSponsorshipBenefits
} from '../dist/packages/funding-core/src/index.js';

const extractBetween = (source, start, end, label) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label} start marker was not found`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${label} end marker was not found`);
  return source.slice(startIndex, endIndex);
};

test('OpenG7 config uses required default values', () => {
  assert.equal(OPENG7_FUNDING_CONFIG.projectName, 'OpenG7');
  assert.equal(OPENG7_FUNDING_CONFIG.campaignTitle, 'Le Fonds des Bâtisseurs');
  assert.equal(OPENG7_FUNDING_CONFIG.currency, 'CAD');
  assert.equal(OPENG7_FUNDING_CONFIG.locale, 'fr-CA');
  assert.deepEqual(OPENG7_FUNDING_CONFIG.contributionAmounts, [5, 10, 25, 50]);
});

test('Funding core returns documented mock checkout result', () => {
  const result = createMockCheckoutResult({
    amount: 25,
    currency: 'CAD',
    projectId: 'openg7',
    successUrl: 'https://example.org/success',
    cancelUrl: 'https://example.org/cancel',
    contributionType: 'personal_support',
    publicDisplayConsent: false,
    displayAmountConsent: false,
    nonCharityAcknowledged: true
  });

  assert.equal(result.status, 'mocked');
  assert.ok(result.checkoutId.includes('25'));
});

test('Fundraiser MVP database migration creates required private tables', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/002_create_fundraiser_mvp_tables.sql',
    'utf8'
  );

  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS stripe_events'));
  assert.ok(migration.includes('processing_status TEXT NOT NULL'));
  assert.ok(
    migration.includes('CREATE TABLE IF NOT EXISTS stripe_checkout_sessions')
  );
  assert.ok(
    migration.includes('CREATE TABLE IF NOT EXISTS fund_contributions')
  );
});

test('fund_contributions ON CONFLICT targets match its partial unique index', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/002_create_fundraiser_mvp_tables.sql',
    'utf8'
  );
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );

  assert.ok(
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_contributions_stripe_session_id\s+ON fund_contributions \(stripe_session_id\)\s+WHERE stripe_session_id IS NOT NULL/.test(
      migration
    ),
    'fund_contributions.stripe_session_id must stay a partial unique index'
  );

  const onConflictClauses = [
    ...repository.matchAll(
      /INSERT INTO fund_contributions[\s\S]*?ON CONFLICT \(stripe_session_id\)([\s\S]{0,80}?)(?:DO NOTHING|DO UPDATE)/g
    )
  ];

  assert.ok(
    onConflictClauses.length >= 2,
    'expected fund_contributions inserts in insertCheckoutSessionRecord and upsertCheckoutSessionFromWebhook'
  );

  for (const [, between] of onConflictClauses) {
    assert.ok(
      between.includes('WHERE stripe_session_id IS NOT NULL'),
      'ON CONFLICT (stripe_session_id) on fund_contributions must repeat the partial index predicate, or Postgres throws 42P10 at runtime'
    );
  }
});

test('PostgreSQL compose service is private and profile-gated', () => {
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');

  assert.ok(compose.includes('postgres:'));
  assert.ok(compose.includes('profiles:'));
  assert.ok(compose.includes('openg7-data'));
  assert.ok(compose.includes('internal: true'));
  assert.ok(compose.includes('FUNDING_ADMIN_SESSION_SECRET'));
  assert.ok(compose.includes('FUNDING_SPONSOR_LOGO_STORAGE_DIR'));
  assert.ok(compose.includes('openg7-sponsor-logos'));
  assert.equal(/['"]?5432:5432['"]?/.test(compose), false);
});

test('Backup and restore helpers cover PostgreSQL and sponsor logo volumes', () => {
  const backupScript = fs.readFileSync('scripts/backup.sh', 'utf8');
  const script = fs.readFileSync('scripts/restore-from-backup.sh', 'utf8');
  const vps = fs.readFileSync('scripts/vps.mjs', 'utf8');
  const docs = fs.readFileSync('docs/docker-deployment.md', 'utf8');

  assert.ok(
    backupScript.includes(
      'SPONSOR_LOGOS_VOLUME_NAME="${SPONSOR_LOGOS_VOLUME_NAME:-openg7-sponsor-logos}"'
    )
  );
  assert.ok(backupScript.includes('openg7-sponsor-logos-${STAMP}.tar.gz'));
  assert.ok(
    backupScript.includes(
      'docker volume inspect "${SPONSOR_LOGOS_VOLUME_NAME}"'
    )
  );
  assert.ok(backupScript.includes('docker run --rm'));
  assert.ok(
    script.includes(
      'POSTGRES_VOLUME_NAME="${POSTGRES_VOLUME_NAME:-openg7-postgres-data}"'
    )
  );
  assert.ok(
    script.includes(
      'SPONSOR_LOGOS_VOLUME_NAME="${SPONSOR_LOGOS_VOLUME_NAME:-openg7-sponsor-logos}"'
    )
  );
  assert.ok(script.includes('--sponsor-logos-backup'));
  assert.ok(script.includes('Type RESTORE OPENG7 to continue.'));
  assert.ok(script.includes('docker volume rm "${POSTGRES_VOLUME_NAME}"'));
  assert.ok(script.includes('docker volume rm "${SPONSOR_LOGOS_VOLUME_NAME}"'));
  assert.ok(
    script.includes('docker volume create "${SPONSOR_LOGOS_VOLUME_NAME}"')
  );
  assert.ok(script.includes('psql -v ON_ERROR_STOP=1'));
  assert.ok(script.includes('bash scripts/check.sh'));
  assert.ok(vps.includes('latest-sponsor-logos-backup.tar.gz'));
  assert.ok(vps.includes('remoteFileExists'));
  assert.ok(docs.includes('bash scripts/restore-from-backup.sh'));
  assert.ok(docs.includes('--sponsor-logos-backup'));
});

test('Production rehearsal docs cover PostgreSQL sponsor lifecycle', () => {
  const launchChecklist = fs.readFileSync(
    'docs/production-launch-checklist.md',
    'utf8'
  );
  const mvpStatus = fs.readFileSync('docs/fundraiser-mvp-status.md', 'utf8');
  const agentChecklist = fs.readFileSync(
    'apps/production-launch-agent/checklists/production-launch-checklist.yaml',
    'utf8'
  );

  assert.equal(mvpStatus.includes('- upload et moderation de logos;'), false);
  assert.equal(mvpStatus.includes('- Aucun upload de logo'), false);
  assert.ok(
    mvpStatus.includes(
      "L'upload de fichier logo reste reserve au back-office admin"
    )
  );

  assert.ok(launchChecklist.includes('## PostgreSQL-Backed Rehearsal'));
  assert.ok(launchChecklist.includes('POST /api/admin/session'));
  assert.ok(launchChecklist.includes('GET /api/admin/sponsorships/logo'));
  assert.ok(
    launchChecklist.includes('POST /api/admin/sponsorships/logo/delete')
  );
  assert.match(
    launchChecklist,
    /previous controlled file is no longer\s+served/
  );
  assert.ok(
    launchChecklist.includes(
      'scripts/restore-from-backup.sh --sponsor-logos-backup'
    )
  );
  assert.ok(launchChecklist.includes('PLA_ROLE=operator'));
  assert.ok(agentChecklist.includes('post-deploy-api-logs'));
  assert.ok(agentChecklist.includes('analyze-post-deploy-api-logs'));
});

test('Stripe webhook service handles MVP idempotent event set', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/stripe-webhook.service.ts',
    'utf8'
  );

  for (const eventType of [
    'checkout.session.completed',
    'checkout.session.expired',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'charge.updated',
    'charge.refunded',
    'charge.dispute.created',
    'payout.paid',
    'payout.failed'
  ]) {
    assert.ok(source.includes(eventType));
  }

  assert.ok(source.includes('insertStripeEventRecord'));
  assert.ok(source.includes('markStripeEventProcessed'));
  assert.ok(source.includes('markStripeEventFailed'));
});

test('Stripe charge.updated backfills contribution transaction fees', () => {
  const webhookSource = fs.readFileSync(
    'apps/funding-api/src/stripe-webhook.service.ts',
    'utf8'
  );
  const repositorySource = fs.readFileSync(
    'apps/funding-api/src/fund-transparency.repository.ts',
    'utf8'
  );

  assert.ok(webhookSource.includes("event.type === 'charge.updated'"));
  assert.ok(webhookSource.includes('updateContributionFundTransactionBalance'));
  assert.ok(repositorySource.includes('UPDATE fund_transactions'));
  assert.ok(repositorySource.includes("type = 'payment_intent.succeeded'"));
  assert.ok(repositorySource.includes('stripe_balance_transaction_id = $2'));
  assert.ok(repositorySource.includes('fee = $4'));
  assert.ok(repositorySource.includes('net = $5'));
});

test('Checkout sessions require fundraiser metadata and consent fields', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  assert.ok(source.includes('allowedContributionAmounts.has(amount)'));
  assert.ok(source.includes("'personal_support'"));
  assert.ok(source.includes("'sponsorship_interest'"));
  assert.ok(source.includes('parsed.nonCharityAcknowledged !== true'));
  assert.ok(source.includes('resolveCheckoutReturnUrl'));

  for (const metadata of [
    "project: 'openg7'",
    "program: 'builders_fund'",
    'publicReference,',
    'contributionType: parsed.contributionType',
    'publicDisplayConsent: String(parsed.publicDisplayConsent)',
    'displayAmountConsent: String(parsed.displayAmountConsent)',
    'nonCharityAcknowledged: String(parsed.nonCharityAcknowledged)',
    'requiresReview: String(requiresReview)'
  ]) {
    assert.ok(source.includes(metadata));
  }
});

test('Checkout creates a public contribution reference for Stripe receipts and recovery', () => {
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const webhook = fs.readFileSync(
    'apps/funding-api/src/stripe-webhook.service.ts',
    'utf8'
  );
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/009_add_contribution_public_reference.sql',
    'utf8'
  );
  const core = fs.readFileSync('packages/funding-core/src/index.ts', 'utf8');
  const followupPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.ts',
    'utf8'
  );
  const adminContributionsPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-contributions-page/admin-contributions-page.component.ts',
    'utf8'
  );
  const adminSponsorsPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts',
    'utf8'
  );

  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS public_reference'));
  assert.ok(migration.includes('idx_fund_contributions_public_reference'));
  assert.ok(migration.includes('CREATE EXTENSION IF NOT EXISTS pgcrypto'));
  assert.ok(api.includes('createContributionPublicReference'));
  assert.ok(api.includes('client_reference_id: publicReference'));
  assert.ok(
    /description:\s*buildContributionReceiptDescription\(\s*publicReference\s*\)/.test(
      api
    )
  );
  assert.ok(api.includes('name: `OpenG7 ${projectId} - ${publicReference}`'));
  assert.ok(api.includes('publicReference: followup.publicReference'));
  assert.ok(
    webhook.includes('metadata.publicReference ?? session.client_reference_id')
  );
  assert.ok(repository.includes('public_reference = COALESCE('));
  assert.ok(repository.includes('publicReference: row.public_reference'));
  assert.ok(core.includes('readonly publicReference: string | null;'));
  assert.ok(core.includes('readonly public_reference: string | null;'));
  assert.ok(followupPage.includes('current.publicReference'));
  assert.ok(adminContributionsPage.includes('contribution.public_reference'));
  assert.ok(adminSponsorsPage.includes('sponsorship.public_reference'));
});

test('resolveCheckoutReturnUrl allows http localhost/127.0.0.1 only outside production', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  const match = source.match(/const resolveCheckoutReturnUrl[\s\S]*?\n};/);
  assert.ok(match, 'expected to find resolveCheckoutReturnUrl function body');
  const fnSource = match[0];

  assert.ok(
    fnSource.includes("candidate.hostname === 'localhost'") &&
      fnSource.includes("candidate.hostname === '127.0.0.1'"),
    'expected an exact-equality check against localhost and 127.0.0.1 hostnames'
  );
  assert.ok(
    fnSource.includes("candidate.protocol === 'http:'"),
    'expected the dev allowance to require the http: protocol'
  );

  const devAllowanceMatch = fnSource.match(
    /if\s*\(([\s\S]{0,200}?candidate\.hostname === '127\.0\.0\.1'[\s\S]{0,50}?)\)\s*\{/
  );
  assert.ok(
    devAllowanceMatch,
    'expected an if-condition guarding the localhost allowance'
  );
  assert.ok(
    /!isProduction/.test(devAllowanceMatch[1]),
    'the localhost/127.0.0.1 http allowance must be gated behind !isProduction so it never applies in production'
  );

  assert.equal(
    /^\s*if\s*\(\s*candidate\.hostname === '(localhost|127\.0\.0\.1)'/m.test(
      fnSource
    ),
    false,
    'the localhost/127.0.0.1 allowance must not be reachable unconditionally (without an isProduction guard)'
  );
});

test('Public transparency can read aggregate data from fund contributions', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/fund-transparency.repository.ts',
    'utf8'
  );

  assert.ok(source.includes('has_fund_contributions'));
  assert.ok(source.includes('FROM fund_contributions'));
  assert.ok(source.includes("data_source: 'database'"));
  assert.ok(source.includes("status IN ('paid', 'refunded', 'disputed')"));
  assert.equal(/SELECT[\s\S]*email_private/.test(source), false);
});

test('Public builders are exposed only through consented public fields', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/fund-transparency.repository.ts',
    'utf8'
  );

  assert.ok(source.includes('public_builders'));
  assert.ok(source.includes('public_display_consent IS TRUE'));
  assert.ok(source.includes('public_name IS NOT NULL'));
  assert.ok(source.includes('display_amount_consent IS TRUE'));
  assert.equal(source.includes('email_private AS'), false);
});

test('Stripe-direct transparency marks its public data source', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/stripe-transparency.service.ts',
    'utf8'
  );

  assert.ok(source.includes("data_source: 'stripe_direct'"));
});

test('Builders page is routed and prerendered in both languages', () => {
  const routes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.ts',
    'utf8'
  );
  const serverRoutes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.server.ts',
    'utf8'
  );
  const sitemap = fs.readFileSync('apps/funding-web/src/sitemap.xml', 'utf8');

  assert.ok(routes.includes("path: 'batisseurs'"));
  assert.ok(serverRoutes.includes("path: 'batisseurs'"));
  assert.ok(serverRoutes.includes("path: 'en/batisseurs'"));
  assert.ok(sitemap.includes('https://openg7.org/batisseurs'));
  assert.ok(sitemap.includes('https://openg7.org/en/batisseurs'));
});

test('Sponsorship details migration adds optional company follow-up columns', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/003_add_sponsorship_details.sql',
    'utf8'
  );

  for (const column of [
    'sponsor_company_name',
    'sponsor_contact_name',
    'sponsor_contact_email',
    'sponsor_website_url',
    'sponsor_logo_url',
    'sponsor_message',
    'sponsor_details_submitted_at'
  ]) {
    assert.ok(migration.includes(column));
  }
});

test('recordSponsorshipDetails upserts against the partial unique index', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );

  const match = source.match(
    /export const recordSponsorshipDetails[\s\S]*?ON CONFLICT \(stripe_session_id\)([\s\S]{0,80}?)DO UPDATE/
  );

  assert.ok(
    match,
    'expected recordSponsorshipDetails to upsert on stripe_session_id'
  );
  assert.ok(match[1].includes('WHERE stripe_session_id IS NOT NULL'));
  assert.ok(source.includes("sponsor_review_status = 'pending_review'"));
  assert.ok(source.includes('sponsor_reviewed_at = NULL'));
});

test('Sponsorship details endpoint validates required fields and payment state', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  assert.ok(source.includes("'/sponsorship-details'"));
  assert.ok(source.includes("'/api/sponsorship-details'"));
  assert.ok(source.includes('isNonEmptySponsorText(parsed.companyName'));
  assert.ok(source.includes('isNonEmptySponsorText(parsed.contactName'));
  assert.ok(source.includes('isValidSponsorEmail(parsed.contactEmail)'));
  assert.ok(source.includes('isValidOptionalHttpsUrl(parsed.websiteUrl)'));
  assert.ok(source.includes('isValidOptionalHttpsUrl(parsed.logoUrl)'));
  assert.ok(
    /normalizeContributionType\(sessionMetadata\.contributionType\)\s*!==\s*'sponsorship_interest'/.test(
      source
    )
  );
  assert.ok(source.includes("session.payment_status !== 'paid'"));
  assert.ok(source.includes('recordSponsorshipDetails(dbPool'));
});

test('Checkout requires a public display name when public display consent is granted', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  assert.ok(
    source.includes('parsed.publicDisplayConsent === true') &&
      source.includes(
        "'Public display name is required when public display consent is granted.'"
      ),
    'expected main.ts to require publicDisplayName when publicDisplayConsent is true'
  );
  assert.ok(
    /isNonEmptySponsorText\(\s*parsed\.publicDisplayName/.test(source),
    'expected publicDisplayName to be validated as non-empty bounded text'
  );
});

test('publicDisplayName is discarded server-side when public display consent is not granted', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  const match = source.match(/const publicDisplayName =\s*([\s\S]{0,160}?);/);
  assert.ok(
    match,
    'expected to find the publicDisplayName derivation before it is sent to Stripe/DB'
  );
  assert.ok(
    /parsed\.publicDisplayConsent === true/.test(match[1]),
    'expected publicDisplayName to only be kept when publicDisplayConsent is true, so a name typed without consent is never sent to Stripe metadata or persisted to public_name'
  );
});

test('fund_contributions writes public_name on both the checkout-creation and webhook paths', () => {
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );

  assert.ok(
    /export const insertCheckoutSessionRecord[\s\S]*?public_name/.test(
      repository
    ),
    'expected insertCheckoutSessionRecord to write public_name'
  );
  assert.ok(
    /export const upsertCheckoutSessionFromWebhook[\s\S]*?public_name/.test(
      repository
    ),
    'expected upsertCheckoutSessionFromWebhook to write public_name'
  );
  assert.ok(
    repository.includes(
      'public_name = COALESCE(EXCLUDED.public_name, fund_contributions.public_name)'
    ),
    'expected the webhook upsert to preserve an existing public_name when a later event omits it'
  );
});

test('Stripe webhook service reads publicDisplayName from checkout session metadata', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/stripe-webhook.service.ts',
    'utf8'
  );

  assert.ok(source.includes('metadata.publicDisplayName'));
  assert.ok(source.includes('publicName:'));
});

test('Public display name input has matching i18n keys in both locales', () => {
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  for (const locale of [fr, en]) {
    const contribution = locale.funding.home.contribution;
    assert.ok(contribution.publicDisplayNameLabel);
    assert.ok(contribution.publicDisplayNamePlaceholder);
  }
});

test('Custom contribution amount input accepts only decimal numeric values', () => {
  const source = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts',
    'utf8'
  );
  const styles = fs.readFileSync('apps/funding-web/src/styles.css', 'utf8');
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  assert.ok(source.includes('class="custom-amount-input"'));
  assert.ok(source.includes('type="text"'));
  assert.ok(source.includes('inputmode="decimal"'));
  assert.ok(source.includes('pattern="[0-9]+([.,][0-9]{0,2})?"'));
  assert.ok(source.includes('sanitizeCustomContributionValue'));
  assert.ok(source.includes("normalizedValue.replace(/[^0-9.]/g, '')"));
  assert.ok(source.includes("decimalParts.join('').slice(0, 2)"));
  assert.ok(source.includes('parseCustomContributionAmount'));
  assert.ok(source.includes('/^\\d+(?:\\.\\d{0,2})?$/.test(value)'));
  assert.ok(source.includes('!this.hasInvalidCustomContribution()'));
  assert.ok(source.includes('normalizeCustomContributionFromEvent'));
  assert.ok(styles.includes(".custom-amount-input[aria-invalid='true']"));

  for (const locale of [fr, en]) {
    assert.ok(locale.funding.home.contribution.amountFormatHint);
    assert.ok(locale.funding.home.contribution.amountFormatError);
  }
});

test('Business sponsorship contribution choice is controlled by runtime flag', () => {
  const source = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts',
    'utf8'
  );
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding.service.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const envExample = fs.readFileSync('.env.example', 'utf8');
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');
  const styles = fs.readFileSync('apps/funding-web/src/styles.css', 'utf8');
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  assert.ok(envExample.includes('FUNDING_BUSINESS_SPONSORSHIP_ENABLED=false'));
  assert.ok(
    compose.includes(
      'FUNDING_BUSINESS_SPONSORSHIP_ENABLED: ${FUNDING_BUSINESS_SPONSORSHIP_ENABLED:-false}'
    )
  );
  assert.ok(
    api.includes('const businessSponsorshipEnabled = parseBooleanEnv(')
  );
  assert.ok(api.includes('/public/funding-config'));
  assert.ok(api.includes('business_sponsorship_enabled'));
  assert.ok(api.includes('Business sponsorship checkout is disabled.'));
  assert.ok(service.includes('getPublicFundingConfig'));
  assert.ok(
    source.includes(
      'readonly sponsorshipSelectionEnabled = signal<boolean>(false)'
    )
  );
  assert.ok(source.includes('[disabled]="!sponsorshipSelectionEnabled()"'));
  assert.ok(source.includes("type === 'sponsorship_interest'"));
  assert.ok(source.includes('!this.sponsorshipSelectionEnabled()'));
  assert.ok(source.includes('funding.home.contribution.sponsorship.disabled'));
  assert.ok(
    source.includes('funding.home.contribution.sponsorship.afterPaymentNote')
  );
  assert.ok(
    source.includes('funding.home.contribution.sponsorship.manualReviewNote')
  );
  assert.ok(styles.includes('.sponsorship-selection-note'));
  assert.ok(styles.includes('.contribution-type-card:disabled'));

  for (const locale of [fr, en]) {
    assert.ok(locale.funding.home.contribution.sponsorship.disabled);
    assert.ok(locale.funding.home.contribution.sponsorship.afterPaymentNote);
    assert.ok(locale.funding.home.contribution.sponsorship.manualReviewNote);
  }
});

test('Sponsorship pricing config resolves tiers and benefits from the real paid amount', () => {
  assert.deepEqual(
    DEFAULT_SPONSORSHIP_PRICING_CONFIG.presetAmounts,
    [5, 10, 25, 50]
  );
  assert.equal(DEFAULT_SPONSORSHIP_PRICING_CONFIG.minimumAmount, 5);
  assert.deepEqual(
    OPENG7_FUNDING_CONFIG.sponsorship,
    DEFAULT_SPONSORSHIP_PRICING_CONFIG
  );

  const cases = [
    { amount: 5, tier: 'website_only', benefits: ['website_mention'] },
    { amount: 10, tier: 'website_only', benefits: ['website_mention'] },
    { amount: 24.99, tier: 'website_only', benefits: ['website_mention'] },
    {
      amount: 25,
      tier: 'website_facebook',
      benefits: ['website_mention', 'facebook_batch']
    },
    {
      amount: 49.99,
      tier: 'website_facebook',
      benefits: ['website_mention', 'facebook_batch']
    },
    {
      amount: 50,
      tier: 'website_facebook_linkedin',
      benefits: ['website_mention', 'facebook_batch', 'linkedin_batch']
    },
    {
      amount: 75,
      tier: 'website_facebook_linkedin',
      benefits: ['website_mention', 'facebook_batch', 'linkedin_batch']
    }
  ];

  for (const { amount, tier, benefits } of cases) {
    const result = resolveSponsorshipBenefits(
      amount,
      DEFAULT_SPONSORSHIP_PRICING_CONFIG
    );
    assert.equal(result.tier, tier, `amount ${amount} tier mismatch`);
    assert.deepEqual(
      result.achievedBenefits,
      benefits,
      `amount ${amount} achieved benefits mismatch`
    );
  }

  const belowMinimum = resolveSponsorshipBenefits(
    4.99,
    DEFAULT_SPONSORSHIP_PRICING_CONFIG
  );
  assert.equal(belowMinimum.tier, null);
  assert.deepEqual(belowMinimum.achievedBenefits, []);

  const atWebsiteOnly = resolveSponsorshipBenefits(
    10,
    DEFAULT_SPONSORSHIP_PRICING_CONFIG
  );
  assert.deepEqual(
    atWebsiteOnly.upcomingBenefits.map((benefit) => benefit.id),
    ['facebook_batch', 'linkedin_batch']
  );

  const atFacebookTier = resolveSponsorshipBenefits(
    25,
    DEFAULT_SPONSORSHIP_PRICING_CONFIG
  );
  assert.deepEqual(
    atFacebookTier.upcomingBenefits.map((benefit) => benefit.id),
    ['linkedin_batch']
  );

  const atTopTier = resolveSponsorshipBenefits(
    50,
    DEFAULT_SPONSORSHIP_PRICING_CONFIG
  );
  assert.deepEqual(atTopTier.upcomingBenefits, []);

  assert.equal(
    isValidSponsorshipAmount(4.99, DEFAULT_SPONSORSHIP_PRICING_CONFIG),
    false
  );
  assert.equal(
    isValidSponsorshipAmount(5, DEFAULT_SPONSORSHIP_PRICING_CONFIG),
    true
  );
  assert.equal(
    isValidSponsorshipAmount(75, DEFAULT_SPONSORSHIP_PRICING_CONFIG),
    true
  );
});

test('Sponsorship amount grid and benefits recap react to the selected amount without touching personal contribution behavior', () => {
  const source = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts',
    'utf8'
  );
  const config = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/config/openg7-funding.config.ts',
    'utf8'
  );

  assert.ok(config.includes('sponsorship: {'));
  assert.ok(config.includes('presetAmounts: [5, 10, 25, 50],'));
  assert.ok(config.includes('minimumAmount: 5,'));
  assert.ok(config.includes('websiteMention: { minimumAmount: 5 },'));
  assert.ok(config.includes('facebookBatch: { minimumAmount: 25 },'));
  assert.ok(config.includes('linkedinBatch: { minimumAmount: 50 }'));

  assert.ok(source.includes('resolveSponsorshipBenefits'));
  assert.ok(source.includes('isValidSponsorshipAmount'));
  assert.ok(
    source.includes(
      'readonly activeAmountPresets = computed<readonly number[]>(() =>'
    )
  );
  assert.ok(source.includes('? this.config.sponsorship.presetAmounts'));
  assert.ok(source.includes(': this.config.contributionAmounts'));
  assert.ok(source.includes('*ngFor="let amount of activeAmountPresets()"'));
  assert.ok(
    source.includes(
      '!isValidSponsorshipAmount(amount, this.config.sponsorship)'
    )
  );
  assert.ok(source.includes('readonly sponsorshipBenefits = computed(() =>'));
  assert.ok(source.includes('sponsorshipBenefits().achievedBenefits'));
  assert.ok(source.includes('sponsorshipBenefits().upcomingBenefits'));
  assert.ok(
    source.includes('funding.home.contribution.sponsorship.amountFormatError')
  );

  // Personal contribution keeps its original, unconditional custom-amount path.
  assert.ok(source.includes('if (customValue.length === 0) {'));
});

test('Checkout API validates sponsorship custom amounts against the real minimum, not the fixed personal allowlist', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  // @openg7/funding-core has no local package build (only the monorepo-wide
  // dist/), so a real (non-type) cross-package import only resolves inside
  // the Angular bundle. The API keeps its own local mirror instead, same
  // convention as allowedContributionAmounts/FUNDING_ALLOWED_AMOUNTS.
  assert.ok(source.includes('const sponsorshipMinimumAmount = 5;'));
  assert.ok(
    source.includes(
      'const isValidSponsorshipAmount = (amount: number): boolean =>'
    )
  );
  assert.ok(
    source.includes(
      'Number.isFinite(amount) && amount >= sponsorshipMinimumAmount;'
    )
  );
  assert.ok(source.includes('const isSponsorshipContribution ='));
  assert.ok(
    source.includes("parsed.contributionType === 'sponsorship_interest';")
  );
  assert.ok(source.includes('businessSponsorshipEnabled'));
  assert.ok(source.includes('Business sponsorship checkout is disabled.'));
  assert.ok(
    source.includes('const isAmountAllowed = isSponsorshipContribution')
  );
  assert.ok(source.includes('? isValidSponsorshipAmount(amount)'));
  assert.ok(source.includes(': allowedContributionAmounts.has(amount);'));
  assert.ok(source.includes('allowedContributionAmounts.has(amount)'));
  assert.ok(
    source.includes('if (!Number.isFinite(amount) || !isAmountAllowed) {')
  );
});

test('Sponsorship follow-up benefits are derived server-side from the paid amount, never trusted from the client', () => {
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const core = fs.readFileSync('packages/funding-core/src/index.ts', 'utf8');

  assert.ok(
    repository.includes(
      'const sponsorshipBenefits = resolveSponsorshipBenefits(amount);'
    )
  );
  assert.ok(repository.includes('const resolveSponsorshipBenefits = ('));
  assert.ok(repository.includes('amount: number'));
  assert.ok(repository.includes('sponsorshipTier: sponsorshipBenefits.tier,'));
  assert.ok(
    repository.includes(
      'sponsorshipBenefits: sponsorshipBenefits.achievedBenefits,'
    )
  );
  assert.ok(api.includes('sponsorshipTier: followup.sponsorshipTier,'));
  assert.ok(api.includes('sponsorshipBenefits: followup.sponsorshipBenefits,'));

  // The client-submitted follow-up payload never carries benefits or a tier:
  // only company/contact details, so nothing benefit-related can be spoofed.
  const followupDetailsRequest = extractBetween(
    core,
    'export interface SponsorshipFollowupDetailsRequest {',
    '}',
    'SponsorshipFollowupDetailsRequest'
  );
  assert.equal(followupDetailsRequest.toLowerCase().includes('benefit'), false);
  assert.equal(followupDetailsRequest.toLowerCase().includes('tier'), false);
});

test('Sponsorship never publishes automatically and stays gated behind manual review', () => {
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );
  const followupPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.ts',
    'utf8'
  );

  const recordDetailsBody = extractBetween(
    repository,
    'export const recordSponsorshipDetailsForContribution',
    'export const markSponsorshipFollowupEmailResult',
    'sponsorship follow-up recording'
  );
  assert.equal(recordDetailsBody.includes('sponsor_feed_status'), false);
  assert.ok(
    recordDetailsBody.includes("sponsor_review_status = 'pending_review'")
  );

  assert.ok(followupPage.includes('current.sponsorshipBenefits'));
  assert.ok(followupPage.includes('benefitLabel(benefit)'));
  assert.match(
    followupPage,
    /jamais publi(?:e|é)es automatiquement au\s+paiement/
  );
});

test('Mock checkout fallback never claims a confirmed Stripe payment or webhook run', () => {
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding.service.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  assert.ok(service.includes('canUseDevelopmentCheckoutFallback'));
  assert.ok(
    service.includes(
      "throw new Error('Mock checkout is disabled outside local development.');"
    )
  );
  assert.ok(api.includes('if (!isProduction) {'));
  assert.ok(api.includes('createDevelopmentCheckoutResult'));

  const result = createMockCheckoutResult({
    amount: 25,
    currency: 'CAD',
    projectId: 'openg7',
    successUrl: 'https://example.org/success',
    cancelUrl: 'https://example.org/cancel',
    contributionType: 'sponsorship_interest',
    publicDisplayConsent: false,
    displayAmountConsent: false,
    nonCharityAcknowledged: true
  });
  assert.equal(result.status, 'mocked');
});

test('Sponsorship MVP pricing tiers are documented', () => {
  const mvpStatus = fs.readFileSync('docs/fundraiser-mvp-status.md', 'utf8');

  assert.ok(mvpStatus.includes('Commandite 5 $ a 24,99 $'));
  assert.ok(mvpStatus.includes("mention de l'entreprise sur OpenG7.org"));
  assert.ok(mvpStatus.includes('Commandite 25 $ a 49,99 $'));
  assert.ok(mvpStatus.includes('Commandite 50 $ et plus'));
  assert.ok(mvpStatus.includes('resolveSponsorshipBenefits'));
  assert.ok(mvpStatus.includes('revue manuelle'));
  assert.ok(mvpStatus.includes('prochain lot disponible'));
  assert.ok(
    mvpStatus.includes('5 $ a 50 $ constituent la gamme accessible du MVP')
  );
});

test('Sponsor follow-up screen has matching i18n keys in both locales', () => {
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  for (const locale of [fr, en]) {
    const checkout = locale.funding.home.checkout;
    assert.ok(checkout.sponsorTitle);
    assert.ok(checkout.sponsorCopy);
    assert.ok(checkout.sponsorStages.paymentReceived);
    assert.ok(checkout.sponsorStages.detailsIncomplete);
    assert.ok(checkout.sponsorStages.manualReview);
    assert.ok(checkout.sponsorStages.publication);
    assert.ok(checkout.sponsorFollowupCta);
    assert.ok(checkout.sponsorForm.companyNameLabel);
    assert.ok(checkout.sponsorForm.contactNameLabel);
    assert.ok(checkout.sponsorForm.contactEmailLabel);
    assert.ok(checkout.sponsorForm.submit);
    assert.ok(checkout.sponsorForm.successTitle);
    assert.ok(checkout.sponsorForm.nextStepsLink);
  }
});

test('Sponsorship review and follow-up migrations add private workflow columns', () => {
  const reviewMigration = fs.readFileSync(
    'apps/funding-api/migrations/004_add_sponsorship_review.sql',
    'utf8'
  );
  const followupMigration = fs.readFileSync(
    'apps/funding-api/migrations/005_add_sponsorship_followup_token.sql',
    'utf8'
  );

  for (const column of [
    'sponsor_review_status',
    'sponsor_review_note',
    'sponsor_reviewed_at'
  ]) {
    assert.ok(reviewMigration.includes(column));
  }

  assert.ok(followupMigration.includes('sponsorship_followup_token_hash'));
  assert.ok(
    followupMigration.includes(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_contributions_followup_token_hash'
    )
  );
  assert.ok(
    followupMigration.includes(
      'WHERE sponsorship_followup_token_hash IS NOT NULL'
    )
  );
});

test('Checkout creates sponsorship follow-up URL and DB hash without raw Stripe metadata', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const fundingService = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding.service.ts',
    'utf8'
  );
  const checkoutMetadataBlock = extractBetween(
    source,
    'const checkoutMetadata',
    'const session = await stripe.checkout.sessions.create',
    'checkout metadata'
  );

  assert.ok(source.includes('createSponsorshipFollowupToken'));
  assert.ok(source.includes('hashSponsorshipFollowupToken'));
  assert.ok(source.includes('buildSponsorshipCheckoutSuccessUrl'));
  assert.ok(source.includes('fonds-des-batisseurs/suivi-commandite'));
  assert.ok(source.includes("url.searchParams.set('token', token)"));
  assert.equal(source.includes("'followup_token'"), false);
  assert.equal(
    checkoutMetadataBlock.includes('sponsorshipFollowupToken,'),
    false
  );
  assert.ok(source.includes('sponsorshipFollowupTokenHash'));
  assert.equal(
    fundingService.includes('session_id={CHECKOUT_SESSION_ID}'),
    false
  );
});

test('Sponsorship follow-up endpoints are token based and do not require Stripe session ids', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const fundingPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts',
    'utf8'
  );
  const fundingService = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding.service.ts',
    'utf8'
  );

  assert.ok(source.includes("'/sponsorship-followup'"));
  assert.ok(source.includes("'/api/sponsorship-followup'"));
  assert.ok(source.includes("'/sponsorship-followup/details'"));
  assert.ok(source.includes("'/api/sponsorship-followup/details'"));
  assert.ok(source.includes('isValidFollowupToken'));
  assert.ok(source.includes('getSponsorshipFollowupByTokenHash'));
  assert.ok(source.includes('recordSponsorshipDetailsForContribution'));
  assert.ok(fundingPage.includes("params.get('followup_token')"));
  assert.ok(fundingPage.includes('pendingSponsorFollowupToken'));
  assert.ok(fundingPage.includes('sponsorshipFollowupTokenPattern'));
  assert.ok(fundingPage.includes('sponsorshipFollowupPath'));
  assert.equal(fundingPage.includes("params.get('session_id')"), false);
  assert.equal(fundingPage.includes('submitSponsorDetails()'), false);
  assert.equal(fundingService.includes('submitSponsorshipDetails'), false);
});

test('Sponsorship follow-up email is sent from checkout completion only when recoverable', () => {
  const webhook = fs.readFileSync(
    'apps/funding-api/src/stripe-webhook.service.ts',
    'utf8'
  );
  const email = fs.readFileSync(
    'apps/funding-api/src/email-notification.service.ts',
    'utf8'
  );

  assert.ok(webhook.includes('queueSponsorshipFollowupEmail'));
  assert.ok(webhook.includes('buildSponsorshipFollowupUrl'));
  assert.ok(webhook.includes('extractSponsorshipFollowupTokenFromSession'));
  assert.ok(webhook.includes('followupToken'));
  assert.ok(webhook.includes('followupEmail'));
  assert.ok(webhook.includes('markSponsorshipFollowupEmailResult'));
  assert.ok(email.includes("templateKey: 'sponsorship_followup'"));
  assert.ok(email.includes('RESEND_API_KEY'));
  assert.ok(email.includes('FUNDING_EMAIL_FROM'));
});

test('Sponsorship follow-up tokens expire and details edits return to review', () => {
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );
  const followupPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.ts',
    'utf8'
  );
  const recordDetailsBody = extractBetween(
    repository,
    'export const recordSponsorshipDetailsForContribution',
    'export const markSponsorshipFollowupEmailResult',
    'sponsorship follow-up recording'
  );

  assert.ok(api.includes('FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS'));
  assert.ok(api.includes('getSponsorshipFollowupTokenCutoffIso'));
  assert.ok(
    repository.includes(
      'sponsorship_followup_token_created_at >= $2::timestamptz'
    )
  );
  assert.ok(
    recordDetailsBody.includes("sponsor_review_status = 'pending_review'")
  );
  assert.ok(recordDetailsBody.includes('sponsor_reviewed_at = NULL'));
  assert.ok(followupPage.includes('history.replaceState'));
  assert.ok(followupPage.includes("url.searchParams.delete('token')"));
});

test('Sponsorship follow-up form explains disabled submit and browser autofill state', () => {
  const followupPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.ts',
    'utf8'
  );

  assert.ok(followupPage.includes('SponsorshipFollowupFormErrors'));
  assert.ok(followupPage.includes('ReactiveFormsModule'));
  assert.ok(followupPage.includes('[formGroup]="sponsorshipForm"'));
  assert.ok(followupPage.includes('formControlName="contactEmail"'));
  assert.ok(
    followupPage.includes(
      'readonly sponsorshipForm = this.formBuilder.nonNullable.group'
    )
  );
  assert.ok(followupPage.includes('Validators.required'));
  assert.ok(followupPage.includes('optionalHttpsUrlValidator'));
  assert.ok(followupPage.includes('readonly formErrors = computed'));
  assert.ok(followupPage.includes('readonly formErrorMessages = computed'));
  assert.ok(followupPage.includes("errorFor('companyName')"));
  assert.ok(followupPage.includes("errorFor('contactEmail')"));
  assert.ok(followupPage.includes('class="field-error"'));
  assert.ok(followupPage.includes('class="form-error-summary full"'));
  assert.ok(followupPage.includes('scheduleAutofillSync'));
  assert.ok(followupPage.includes('syncFormControlsFromInputs'));
  assert.ok(followupPage.includes('this.sponsorshipForm.patchValue(values)'));
  assert.ok(followupPage.includes('this.sponsorshipForm.getRawValue()'));
});

test('Sensitive sponsorship API routes have in-process rate limiting', () => {
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const envExample = fs.readFileSync('.env.example', 'utf8');

  assert.ok(api.includes('createRateLimiter'));
  assert.ok(api.includes('getRequestRateLimiter'));
  assert.ok(api.includes('enforceRateLimit'));
  assert.ok(api.includes('Retry-After'));
  assert.ok(api.includes('FUNDING_RATE_LIMIT_WINDOW_MS'));
  assert.ok(api.includes('FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX'));
  assert.ok(api.includes('FUNDING_SPONSORSHIP_FOLLOWUP_RATE_LIMIT_MAX'));
  assert.ok(api.includes('FUNDING_ADMIN_RATE_LIMIT_MAX'));
  assert.ok(api.includes('FUNDING_ADMIN_SESSION_SECRET'));
  assert.ok(api.includes('FUNDING_ADMIN_SESSION_TTL_MINUTES'));
  assert.ok(api.includes('FUNDING_SPONSOR_LOGO_STORAGE_DIR'));
  assert.ok(api.includes('FUNDING_SPONSOR_LOGO_MAX_BYTES'));
  assert.ok(
    envExample.includes('FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS=30')
  );
  assert.ok(envExample.includes('FUNDING_ADMIN_RATE_LIMIT_MAX=120'));
  assert.ok(envExample.includes('FUNDING_ADMIN_SESSION_SECRET='));
  assert.ok(envExample.includes('FUNDING_ADMIN_SESSION_TTL_MINUTES=60'));
  assert.ok(envExample.includes('FUNDING_SPONSOR_LOGO_STORAGE_DIR='));
  assert.ok(envExample.includes('FUNDING_SPONSOR_LOGO_MAX_BYTES=524288'));
});

test('Sponsorship follow-up page is routed but not added to the sitemap', () => {
  const routes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.ts',
    'utf8'
  );
  const sitemap = fs.readFileSync('apps/funding-web/src/sitemap.xml', 'utf8');

  assert.ok(routes.includes("path: 'fonds-des-batisseurs/suivi-commandite'"));
  assert.equal(sitemap.includes('suivi-commandite'), false);
});

test('Public builders hide sponsorships until admin approval is recorded', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/fund-transparency.repository.ts',
    'utf8'
  );

  assert.ok(source.includes('has_sponsor_review_status'));
  assert.ok(source.includes("sponsor_review_status = 'approved'"));
  assert.ok(source.includes("contribution_type <> 'sponsorship_interest'"));
});

test('Sponsorship publication migration adds public profile and feed fields', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/006_add_sponsorship_publication_feed.sql',
    'utf8'
  );

  for (const column of [
    'sponsor_public_slug',
    'sponsor_public_summary',
    'sponsor_feed_target',
    'sponsor_feed_channels',
    'sponsor_feed_status',
    'sponsor_feed_public_url',
    'sponsor_feed_notes',
    'sponsor_visibility_updated_at'
  ]) {
    assert.ok(migration.includes(column));
  }

  assert.ok(migration.includes('idx_fund_contributions_sponsor_public_slug'));
});

test('Admin audit and publication draft migration adds private back-office tables', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/007_add_admin_audit_and_publication_drafts.sql',
    'utf8'
  );

  for (const tableOrColumn of [
    'CREATE TABLE IF NOT EXISTS admin_audit_log',
    'CREATE TABLE IF NOT EXISTS sponsor_publication_drafts',
    'actor TEXT NOT NULL',
    'metadata JSONB NOT NULL',
    'contribution_id UUID NOT NULL REFERENCES fund_contributions(id)',
    'disclosure_text TEXT NOT NULL',
    'status TEXT NOT NULL DEFAULT',
    'public_url TEXT',
    'idx_admin_audit_log_created_at',
    'idx_sponsor_publication_drafts_unique_channel'
  ]) {
    assert.ok(migration.includes(tableOrColumn));
  }
});

test('Publication batch migration adds the batches table and links drafts to it', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/008_add_sponsorship_publication_batches.sql',
    'utf8'
  );

  for (const marker of [
    'CREATE TABLE IF NOT EXISTS sponsor_publication_batches',
    'capacity INTEGER NOT NULL CHECK (capacity > 0)',
    "status TEXT NOT NULL DEFAULT 'open'",
    'scheduled_at TIMESTAMPTZ',
    'published_at TIMESTAMPTZ',
    'idx_sponsor_publication_batches_channel_status',
    'idx_sponsor_publication_batches_scheduled_at',
    'ALTER TABLE sponsor_publication_drafts',
    'ADD COLUMN IF NOT EXISTS batch_id UUID',
    'REFERENCES sponsor_publication_batches(id) ON DELETE SET NULL',
    'idx_sponsor_publication_drafts_batch_id'
  ]) {
    assert.ok(migration.includes(marker), `migration must include ${marker}`);
  }
});

test('Publication batch repository enforces capacity, channel match, and approval before assignment', () => {
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-admin.repository.ts',
    'utf8'
  );

  assert.ok(repository.includes('export const listAdminPublicationBatches'));
  assert.ok(repository.includes('export const createAdminPublicationBatch'));
  assert.ok(repository.includes('export const assignDraftToPublicationBatch'));
  assert.ok(
    repository.includes('export const unassignDraftFromPublicationBatch')
  );
  assert.ok(repository.includes('export const scheduleAdminPublicationBatch'));
  assert.ok(repository.includes('export const publishAdminPublicationBatch'));
  assert.ok(repository.includes('export const cancelAdminPublicationBatch'));

  // Capacity is enforced atomically in a single statement, not read-then-write.
  assert.ok(repository.includes('WITH target_batch AS ('));
  assert.ok(repository.includes("draft.status = 'approved'"));
  assert.ok(repository.includes('draft.channel = target_batch.channel'));
  assert.ok(repository.includes("target_batch.status = 'open'"));
  assert.ok(repository.includes('target_batch.used < target_batch.capacity'));

  // Capacity math is derived from actual assigned drafts, not client input.
  assert.ok(
    repository.includes(
      'capacityAvailable: Math.max(0, capacity - capacityUsed),'
    )
  );
});

test('Publication batch lifecycle requires schedule before publish and preserves published drafts on unassign', () => {
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-admin.repository.ts',
    'utf8'
  );

  // Scheduling cascades scheduled_at/status to member drafts, only from open/scheduled.
  assert.ok(repository.includes("AND status IN ('open', 'scheduled')"));
  assert.ok(
    repository.includes(
      "SET status = 'scheduled', scheduled_at = $2::timestamptz, updated_at = NOW()"
    )
  );

  // Publishing is only possible from an already-scheduled batch (never open -> published directly).
  assert.ok(repository.includes("AND status = 'scheduled'"));
  assert.ok(repository.includes("status = 'published',"));
  assert.ok(
    repository.includes('published_at = COALESCE(published_at, NOW()),')
  );
  assert.ok(repository.includes("status IN ('approved', 'scheduled')"));

  // Cancelling releases drafts back to 'approved' so they can be re-batched.
  assert.ok(
    repository.includes("SET status = 'cancelled', updated_at = NOW()")
  );
  assert.ok(
    repository.includes(
      "status = CASE WHEN status = 'scheduled' THEN 'approved' ELSE status END,"
    )
  );

  // A published draft can never be unassigned or silently rewritten.
  assert.ok(repository.includes('AND batch_id IS NOT NULL'));
  assert.ok(repository.includes("AND status <> 'published'"));
});

test('Publication batch admin endpoints are authenticated, validated, rate-limited, and audited', () => {
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  for (const route of [
    "'/admin/publication-batches'",
    "'/api/admin/publication-batches'",
    "'/admin/publication-batches/assign'",
    "'/api/admin/publication-batches/assign'",
    "'/admin/publication-batches/unassign'",
    "'/api/admin/publication-batches/unassign'",
    "'/admin/publication-batches/schedule'",
    "'/api/admin/publication-batches/schedule'",
    "'/admin/publication-batches/publish'",
    "'/api/admin/publication-batches/publish'",
    "'/admin/publication-batches/cancel'",
    "'/api/admin/publication-batches/cancel'"
  ]) {
    assert.ok(api.includes(route), `main.ts must route ${route}`);
  }

  assert.ok(api.includes('const PUBLICATION_BATCH_MIN_CAPACITY = 1;'));
  assert.ok(api.includes('const PUBLICATION_BATCH_MAX_CAPACITY = 50;'));
  assert.ok(api.includes('isValidPublicationBatchCapacity'));

  for (const action of [
    "'publication_batch.create'",
    "'publication_batch.assign'",
    "'publication_batch.unassign'",
    "'publication_batch.schedule'",
    "'publication_batch.publish'",
    "'publication_batch.cancel'"
  ]) {
    assert.ok(
      api.includes(`action: ${action}`),
      `main.ts must audit-log ${action}`
    );
  }

  // Every batch route starts the same way as every other admin route.
  const handlerCount =
    api.split('ensureAdminAccess(request, response)').length - 1;
  assert.ok(handlerCount >= 12, 'admin routes must all call ensureAdminAccess');
});

test('Publication batch types and admin UI expose capacity, next availability, and scheduled status', () => {
  const core = fs.readFileSync('packages/funding-core/src/index.ts', 'utf8');
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts',
    'utf8'
  );
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-publications-page/admin-publications-page.component.ts',
    'utf8'
  );

  assert.ok(core.includes('export type PublicationBatchStatus ='));
  assert.ok(core.includes("'open' | 'scheduled' | 'published' | 'cancelled';"));
  assert.ok(core.includes('readonly capacity: number;'));
  assert.ok(core.includes('readonly capacityUsed: number;'));
  assert.ok(core.includes('readonly capacityAvailable: number;'));
  assert.ok(core.includes('readonly scheduledAt: string | null;'));
  assert.ok(core.includes('readonly assignedDraftIds: readonly string[];'));

  for (const method of [
    'getPublicationBatches',
    'createPublicationBatch',
    'assignDraftToBatch',
    'unassignDraftFromBatch',
    'schedulePublicationBatch',
    'publishPublicationBatch',
    'cancelPublicationBatch'
  ]) {
    assert.ok(
      service.includes(`async ${method}(`),
      `service must expose ${method}`
    );
  }

  assert.ok(page.includes('Lots de publication collective'));
  assert.ok(page.includes('createBatch()'));
  assert.ok(page.includes('scheduleBatch(batch)'));
  assert.ok(page.includes('publishBatch(batch)'));
  assert.ok(page.includes('cancelBatch(batch)'));
  assert.ok(page.includes('assignToBatch(draft)'));
  assert.ok(page.includes('unassignFromBatch(draft)'));
  assert.ok(page.includes('batch.capacityUsed'));
  assert.ok(page.includes('Prochaine disponibilite'));
  assert.ok(page.includes("aucune publication n'est jamais automatique"));
});

test('Admin sponsors page derives the sponsorship tier from the paid amount instead of showing nothing', () => {
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts',
    'utf8'
  );

  assert.ok(page.includes('DEFAULT_SPONSORSHIP_PRICING_CONFIG'));
  assert.ok(page.includes('resolveSponsorshipBenefits'));
  assert.ok(
    page.includes(
      'sponsorshipTierLabel(sponsorship: AdminSponsorshipRecord): string {'
    )
  );
  assert.ok(
    page.includes(
      'sponsorshipBenefitsLabel(sponsorship: AdminSponsorshipRecord): string {'
    )
  );
  assert.match(page, /\{\{\s*sponsorshipTierLabel\(sponsorship\)\s*\}\}/);
  assert.match(
    page,
    /\{\{\s*sponsorshipBenefitsLabel\((sponsorship|selected)\)\s*\}\}/
  );
  // Derived from the record's own amount, never a value the client could send.
  assert.ok(page.includes('resolveSponsorshipBenefits('));
  assert.ok(page.includes('sponsorship.amount,'));
});

test('Admin sponsors publication channels are preselected from amount-based benefits', () => {
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts',
    'utf8'
  );

  assert.ok(page.includes('benefitFeedChannelMap'));
  assert.ok(page.includes("facebook_batch: 'facebook'"));
  assert.ok(page.includes("linkedin_batch: 'linkedin'"));
  assert.ok(page.includes('promisedFeedChannelsFor('));
  assert.ok(page.includes('isPromisedFeedChannel('));
  assert.ok(page.includes("isPromisedFeedChannel(selected, 'facebook')"));
  assert.ok(page.includes("isPromisedFeedChannel(selected, 'linkedin')"));
  assert.ok(
    page.includes('this.toPublicationDraft(sponsorship, false, false)')
  );
});

test('Admin sponsor rows are color-coded by processing state', () => {
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts',
    'utf8'
  );

  for (const marker of [
    'type SponsorProcessingState =',
    'sponsorshipProcessingState(',
    'sponsorshipRowStateClass(',
    'sponsorshipProcessingLabel(',
    '[ngClass]="sponsorshipRowStateClass(sponsorship)"',
    '[attr.title]="sponsorshipProcessingLabel(sponsorship)"',
    'sponsor-row-state-action-required',
    'sponsor-row-state-approved-ready',
    'sponsor-row-state-publication-progress',
    'sponsor-row-state-published',
    'sponsor-row-state-blocked',
    'sponsor-row-state-waiting-payment',
    '--sponsor-row-accent'
  ]) {
    assert.ok(page.includes(marker), `sponsors page must include ${marker}`);
  }

  assert.ok(page.includes("sponsorship.sponsor_review_status === 'rejected'"));
  assert.ok(page.includes("sponsorship.payment_status !== 'paid'"));
  assert.ok(
    page.includes("sponsorship.sponsor_review_status === 'pending_review'")
  );
  assert.ok(page.includes("sponsorship.sponsor_feed_status === 'published'"));
  assert.ok(page.includes("sponsorship.sponsor_feed_status === 'planned'"));
  assert.ok(page.includes("sponsorship.sponsor_feed_status === 'drafted'"));
});

test('Admin sponsor rejection requires a reason and can notify the sponsor', () => {
  const core = fs.readFileSync('packages/funding-core/src/index.ts', 'utf8');
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts',
    'utf8'
  );
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );
  const email = fs.readFileSync(
    'apps/funding-api/src/email-notification.service.ts',
    'utf8'
  );

  assert.ok(core.includes('AdminSponsorshipRejectionRefundHandling'));
  assert.ok(core.includes('readonly notifySponsor?: boolean;'));
  assert.ok(core.includes('readonly notificationEmail?: string;'));
  assert.ok(core.includes('readonly sponsorMessage?: string;'));
  assert.ok(core.includes('readonly refundHandling?:'));
  assert.ok(core.includes('readonly notification?: {'));

  assert.ok(service.includes('reviewSponsorship'));
  assert.ok(service.includes('/admin/sponsorships/review'));

  for (const marker of [
    'openRejectionPanel',
    'confirmRejection',
    'rejection-workflow',
    'rejectionValidationMessage',
    'notifySponsor',
    'recipientEmail',
    'sponsorMessage',
    'refundHandling',
    'manual_required',
    'manual_completed'
  ]) {
    assert.ok(page.includes(marker), `sponsors page must include ${marker}`);
  }

  assert.ok(api.includes('A rejection reason is required.'));
  assert.ok(api.includes('A valid sponsor notification email is required.'));
  assert.ok(api.includes('A sponsor-facing rejection message is required.'));
  assert.ok(api.includes('isAllowedSponsorshipRejectionRefundHandling'));
  assert.ok(api.includes('queueSponsorshipRejectionEmail'));
  assert.ok(api.includes('refundHandling'));
  assert.ok(api.includes('notificationMessageId'));

  assert.ok(repository.includes('getAdminSponsorshipById'));
  assert.ok(repository.includes('mapAdminSponsorshipRow'));

  assert.ok(email.includes("'sponsorship_rejection'"));
  assert.ok(email.includes('renderSponsorshipRejectionEmail'));
  assert.ok(email.includes('queueSponsorshipRejectionEmail'));
  assert.ok(email.includes('rejectionRefundHandlingLabel'));
});

test('Admin sponsorship refund uses Stripe with explicit confirmation and audit', () => {
  const core = fs.readFileSync('packages/funding-core/src/index.ts', 'utf8');
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts',
    'utf8'
  );
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );
  const readme = fs.readFileSync('README.md', 'utf8');

  assert.ok(core.includes('AdminSponsorshipRefundRequest'));
  assert.ok(core.includes('AdminSponsorshipRefundResult'));

  assert.ok(service.includes('refundSponsorship'));
  assert.ok(service.includes('/admin/sponsorships/refund'));

  for (const marker of [
    'refund-workflow',
    'openRefundPanel',
    'confirmRefund',
    'refundConfirmationText',
    'refundValidationMessage',
    'refundActionId',
    'canRefundSponsorship',
    'Rembourser Stripe'
  ]) {
    assert.ok(page.includes(marker), `sponsors page must include ${marker}`);
  }

  for (const marker of [
    "'/admin/sponsorships/refund'",
    "'/api/admin/sponsorships/refund'",
    'stripe.refunds.create',
    'amount: target.amountCents',
    'idempotencyKey: `sponsorship-refund:',
    'SPONSORSHIP_REFUND_NOT_ELIGIBLE',
    'sponsorship_refund.stripe_full',
    'updateContributionStatusByPaymentIntent'
  ]) {
    assert.ok(api.includes(marker), `API must include ${marker}`);
  }

  assert.ok(repository.includes('getSponsorshipRefundTarget'));
  assert.ok(repository.includes('stripe_payment_intent_id'));
  assert.ok(readme.includes('POST /api/admin/sponsorships/refund'));
});

test('Admin sponsorship list uses backend pagination, filters, payment rules, and optimistic locking', () => {
  const core = fs.readFileSync('packages/funding-core/src/index.ts', 'utf8');
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts',
    'utf8'
  );
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );

  assert.ok(core.includes('export interface AdminPagination'));
  assert.ok(core.includes('readonly version: string;'));
  assert.ok(
    core.includes('readonly items: readonly AdminSponsorshipRecord[];')
  );
  assert.ok(core.includes('readonly pagination: AdminPagination;'));
  assert.ok(core.includes('readonly expectedVersion: string;'));

  assert.ok(service.includes('export interface AdminSponsorshipListQuery'));
  assert.ok(service.includes('const params = new URLSearchParams();'));
  assert.ok(service.includes("params.set('page', String(query.page));"));
  assert.ok(
    service.includes("params.set('paymentStatus', query.paymentStatus);")
  );
  assert.ok(service.includes("body.set('expectedVersion', expectedVersion);"));
  assert.ok(service.includes('errorMessageFromResponse'));

  assert.ok(page.includes('readonly pagination = signal<AdminPagination>'));
  assert.ok(page.includes('readonly paymentFilter = signal'));
  assert.ok(page.includes('response.items ?? response.sponsorships'));
  assert.ok(page.includes('paymentStatus: this.paymentFilter()'));
  assert.ok(page.includes('expectedVersion: sponsorship.version'));
  assert.ok(page.includes('paymentEligibilityMessage'));
  assert.ok(page.includes('canApproveSponsorship'));
  assert.ok(page.includes('canSavePublication'));
  assert.ok(page.includes('messageFromError'));

  assert.ok(api.includes('parseAdminSponsorshipsQuery'));
  assert.ok(
    api.includes('const adminSponsorshipPageSizes = new Set([6, 10, 25]);')
  );
  assert.ok(api.includes('SPONSORSHIP_CONCURRENT_UPDATE'));
  assert.ok(api.includes('SPONSORSHIP_PAYMENT_NOT_ELIGIBLE'));
  assert.ok(api.includes('isValidAdminExpectedVersion'));
  assert.ok(api.includes('items: sponsorships.items'));
  assert.ok(api.includes('pagination: sponsorships.pagination'));

  assert.ok(repository.includes('export interface AdminSponsorshipListInput'));
  assert.ok(repository.includes('export interface AdminSponsorshipListResult'));
  assert.ok(repository.includes('COUNT(*)::text AS total_items'));
  assert.ok(repository.includes('MAX(updated_at)::text AS last_updated_at'));
  assert.ok(repository.includes('ILIKE ${placeholder}'));
  assert.ok(repository.includes('LIMIT ${limitPlaceholder}'));
  assert.ok(repository.includes('OFFSET ${offsetPlaceholder}'));
  assert.ok(repository.includes('updated_at::text AS version'));
  assert.ok(repository.includes('payment_not_eligible'));
  assert.ok(repository.includes('visibilityMetadataChanged'));
  assert.ok(repository.includes('AND updated_at::text = $4'));
  assert.ok(repository.includes('AND updated_at::text = $9'));
});

test('Publication batches are listed chronologically per channel, not just by status', () => {
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-admin.repository.ts',
    'utf8'
  );
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-publications-page/admin-publications-page.component.ts',
    'utf8'
  );

  assert.ok(repository.includes('ORDER BY'));
  assert.ok(
    repository.includes('COALESCE(batch.scheduled_at, batch.created_at) ASC')
  );

  assert.ok(page.includes('class="batch-timeline"'));
  assert.ok(page.includes('*ngFor="let channel of batchChannels"'));
  assert.ok(
    page.includes('readonly batchChannels: readonly SponsorFeedChannel[] = [')
  );
  assert.ok(page.includes('batchesForChannel('));
});

test('An admin is notified by email when a publication batch fills up, but nothing publishes automatically', () => {
  const email = fs.readFileSync(
    'apps/funding-api/src/email-notification.service.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const envExample = fs.readFileSync('.env.example', 'utf8');

  assert.ok(
    email.includes(
      'export const queuePublicationBatchFullNotification = async ('
    )
  );
  assert.ok(email.includes('FUNDING_ADMIN_NOTIFICATION_EMAIL'));
  assert.ok(email.includes("templateKey: 'publication_batch_full'"));

  assert.ok(api.includes('queuePublicationBatchFullNotification'));
  assert.ok(
    api.includes(
      'const batch = await getPublicationBatchById(dbPool, parsed.batchId);'
    )
  );
  assert.ok(
    api.includes(
      "if (batch && batch.status === 'open' && batch.capacityAvailable === 0) {"
    )
  );
  // The notification is fired from the assign handler, not from schedule/publish/cancel.
  const assignHandlerBody = extractBetween(
    api,
    "'publication_batch.assign'",
    "'publication_batch.unassign'",
    'assign batch handler'
  );
  assert.ok(
    assignHandlerBody.includes('queuePublicationBatchFullNotification')
  );
  assert.ok(assignHandlerBody.includes('publication-batch:${batch.id}:full'));

  assert.ok(envExample.includes('FUNDING_ADMIN_NOTIFICATION_EMAIL='));
});

test('Email queue stores templates, retries delivery, and sends sponsorship invoices', () => {
  const email = fs.readFileSync(
    'apps/funding-api/src/email-notification.service.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const webhook = fs.readFileSync(
    'apps/funding-api/src/stripe-webhook.service.ts',
    'utf8'
  );
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/010_create_email_messages.sql',
    'utf8'
  );
  const invoiceMigration = fs.readFileSync(
    'apps/funding-api/migrations/011_create_sponsorship_invoices.sql',
    'utf8'
  );
  const invoices = fs.readFileSync(
    'apps/funding-api/src/sponsorship-invoices.repository.ts',
    'utf8'
  );
  const envExample = fs.readFileSync('.env.example', 'utf8');

  for (const marker of [
    'CREATE TABLE IF NOT EXISTS email_messages',
    'idempotency_key TEXT UNIQUE',
    "status TEXT NOT NULL DEFAULT 'queued'",
    'attempts INTEGER NOT NULL DEFAULT 0',
    'max_attempts INTEGER NOT NULL DEFAULT 5',
    'next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    'idx_email_messages_delivery'
  ]) {
    assert.ok(
      migration.includes(marker),
      `email migration must include ${marker}`
    );
  }

  for (const marker of [
    'type EmailTemplateKey =',
    "'sponsorship_confirmation'",
    "'sponsorship_rejection'",
    "'sponsorship_invoice'",
    "'email_configuration_test'",
    'queueSponsorshipInvoiceEmail',
    'queueSponsorshipRejectionEmail',
    'queueSponsorshipConfirmationEmail',
    'queueSponsorshipFollowupEmail',
    'queueEmailConfigurationTest',
    'getEmailQueueStatus',
    'processQueuedEmailMessages',
    'FOR UPDATE SKIP LOCKED',
    "INTERVAL '15 minutes'",
    'nextRetryDate',
    'Resend returned ${response.status}',
    'Facture de commandite OpenG7',
    'Numero de facture',
    'Total paye',
    'recu officiel de don de bienfaisance'
  ]) {
    assert.ok(email.includes(marker), `email service must include ${marker}`);
  }

  for (const marker of [
    'CREATE TABLE IF NOT EXISTS sponsorship_invoices',
    'invoice_number TEXT NOT NULL UNIQUE',
    'contribution_id UUID NOT NULL REFERENCES fund_contributions(id)',
    'line_items JSONB NOT NULL',
    'idx_sponsorship_invoices_contribution_id',
    'idx_sponsorship_invoices_stripe_session_id'
  ]) {
    assert.ok(
      invoiceMigration.includes(marker),
      `invoice migration must include ${marker}`
    );
  }

  for (const marker of [
    'createSponsorshipInvoiceForStripeSession',
    'FUNDING_SPONSORSHIP_INVOICE_PREFIX',
    'FUNDING_INVOICE_ISSUER_NAME',
    'FUNDING_INVOICE_ISSUER_EMAIL',
    'FUNDING_INVOICE_TAX_ID',
    'Commanditaire a confirmer',
    'ON CONFLICT (contribution_id) DO UPDATE',
    'Facture de commandite descriptive'
  ]) {
    assert.ok(
      invoices.includes(marker),
      `invoice repository must include ${marker}`
    );
  }

  assert.ok(webhook.includes('queueSponsorshipInvoiceEmail'));
  assert.ok(webhook.includes('createSponsorshipInvoiceForStripeSession'));
  assert.ok(
    webhook.includes('stripe-session:${session.id}:sponsorship-invoice')
  );
  assert.ok(webhook.includes('sponsorshipInvoiceEmailSent'));
  assert.ok(api.includes('processQueuedEmailMessages'));
  assert.ok(api.includes('buildAdminSetupStatus'));
  assert.ok(api.includes('FUNDING_EMAIL_QUEUE_POLL_INTERVAL_MS'));
  assert.ok(api.includes('FUNDING_EMAIL_QUEUE_BATCH_SIZE'));
  assert.ok(envExample.includes('FUNDING_EMAIL_QUEUE_POLL_INTERVAL_MS=30000'));
  assert.ok(envExample.includes('FUNDING_EMAIL_QUEUE_BATCH_SIZE=10'));
  assert.ok(envExample.includes('FUNDING_SPONSORSHIP_INVOICE_PREFIX='));
  assert.ok(envExample.includes('FUNDING_INVOICE_ISSUER_NAME='));
  assert.ok(envExample.includes('FUNDING_INVOICE_ISSUER_EMAIL='));
});

test('Admin sponsorship invoices can be listed and resent from the back-office', () => {
  const routes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.ts',
    'utf8'
  );
  const nav = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/components/admin-nav/admin-nav.component.ts',
    'utf8'
  );
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts',
    'utf8'
  );
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-invoices-page/admin-invoices-page.component.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const repository = fs.readFileSync(
    'apps/funding-api/src/sponsorship-invoices.repository.ts',
    'utf8'
  );
  const email = fs.readFileSync(
    'apps/funding-api/src/email-notification.service.ts',
    'utf8'
  );
  const core = fs.readFileSync('packages/funding-core/src/index.ts', 'utf8');
  const readme = fs.readFileSync('README.md', 'utf8');

  assert.ok(routes.includes("path: 'admin/fundraiser/invoices'"));
  assert.ok(routes.includes('AdminInvoicesPageComponent'));
  assert.ok(nav.includes('routerLink="/admin/fundraiser/invoices"'));

  assert.ok(service.includes('getSponsorshipInvoices'));
  assert.ok(service.includes('/admin/sponsorship-invoices'));
  assert.ok(service.includes('resendSponsorshipInvoice'));
  assert.ok(service.includes('/admin/sponsorship-invoices/resend'));

  for (const marker of [
    'selectedInvoice',
    'last_email_status',
    'last_email_recipient',
    'invoice_number',
    'line_items',
    'stripe_session_id',
    'resendInvoice()',
    'Renvoyer'
  ]) {
    assert.ok(page.includes(marker), `invoice page must include ${marker}`);
  }

  assert.ok(api.includes("'/admin/sponsorship-invoices'"));
  assert.ok(api.includes("'/api/admin/sponsorship-invoices'"));
  assert.ok(api.includes("'/admin/sponsorship-invoices/resend'"));
  assert.ok(api.includes("'/api/admin/sponsorship-invoices/resend'"));
  assert.ok(api.includes('listAdminSponsorshipInvoices'));
  assert.ok(api.includes('getSponsorshipInvoiceById'));
  assert.ok(api.includes('queueSponsorshipInvoiceEmail'));
  assert.ok(api.includes('sponsorship_invoice.resend'));
  assert.ok(api.includes('AdminSponsorshipInvoiceResendResult'));

  assert.ok(repository.includes('listAdminSponsorshipInvoices'));
  assert.ok(repository.includes('getAdminSponsorshipInvoiceById'));
  assert.ok(repository.includes('last_email_status'));
  assert.ok(repository.includes("metadata->>'invoiceId'"));

  assert.ok(email.includes('readonly followupUrl?: string;'));
  assert.ok(
    email.includes(
      'Pour mettre a jour les informations de commandite, repondez a ce courriel.'
    )
  );

  assert.ok(core.includes('AdminSponsorshipInvoiceRecord'));
  assert.ok(core.includes('AdminSponsorshipInvoicesResponse'));
  assert.ok(core.includes('AdminSponsorshipInvoiceResendRequest'));
  assert.ok(core.includes('AdminSponsorshipInvoiceResendResult'));

  assert.ok(readme.includes('/admin/fundraiser/invoices'));
  assert.ok(readme.includes('GET /api/admin/sponsorship-invoices'));
  assert.ok(readme.includes('POST /api/admin/sponsorship-invoices/resend'));
});

test('Admin setup page wraps Stripe and email configuration in a custom tour', () => {
  const routes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.ts',
    'utf8'
  );
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-setup-page/admin-setup-page.component.ts',
    'utf8'
  );
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts',
    'utf8'
  );
  const nav = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/components/admin-nav/admin-nav.component.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const core = fs.readFileSync('packages/funding-core/src/index.ts', 'utf8');

  assert.ok(routes.includes("path: 'admin/fundraiser/setup'"));
  assert.ok(routes.includes('AdminSetupPageComponent'));
  assert.ok(nav.includes('routerLink="/admin/fundraiser/setup"'));
  assert.ok(service.includes('getSetupStatus'));
  assert.ok(service.includes('/admin/setup-status'));
  assert.ok(service.includes('sendEmailTest'));
  assert.ok(service.includes('/admin/email/test'));
  assert.ok(api.includes("'/admin/setup-status'"));
  assert.ok(api.includes("'/api/admin/setup-status'"));
  assert.ok(api.includes("'/admin/email/test'"));
  assert.ok(api.includes("'/api/admin/email/test'"));
  assert.ok(api.includes('ensureAdminAuthorization'));
  assert.ok(api.includes('buildAdminSetupStatus'));
  assert.ok(core.includes('AdminSetupStatusResponse'));
  assert.ok(core.includes('AdminEmailTestRequest'));
  assert.ok(core.includes('AdminEmailTestResult'));

  for (const marker of [
    'tourSteps',
    'activeTourStep',
    'startTour()',
    'nextTourStep()',
    'data-tour-anchor="stripe"',
    'data-tour-anchor="email"',
    'data-tour-anchor="queue"',
    'data-tour-anchor="database"',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'RESEND_API_KEY',
    'FUNDING_EMAIL_FROM',
    'FUNDING_ADMIN_NOTIFICATION_EMAIL',
    'FUNDING_SPONSORSHIP_INVOICE_PREFIX',
    'FUNDING_INVOICE_ISSUER_NAME',
    'FUNDING_INVOICE_ISSUER_EMAIL',
    'DATABASE_URL'
  ]) {
    assert.ok(page.includes(marker), `setup page must include ${marker}`);
  }
});

test('Public sponsorship batch availability exposes only a date per channel, never sponsor data', () => {
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-admin.repository.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const core = fs.readFileSync('packages/funding-core/src/index.ts', 'utf8');
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding.service.ts',
    'utf8'
  );
  const page = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts',
    'utf8'
  );
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  assert.ok(
    repository.includes(
      'export const getPublicSponsorshipBatchAvailability = async ('
    )
  );
  const availabilityFn = extractBetween(
    repository,
    'export const getPublicSponsorshipBatchAvailability',
    'export const listAdminPublicationBatches',
    'getPublicSponsorshipBatchAvailability'
  );
  assert.ok(availabilityFn.includes("WHERE status = 'scheduled'"));
  assert.equal(availabilityFn.includes('sponsor_company_name'), false);
  assert.equal(availabilityFn.includes('capacity'), false);

  assert.ok(api.includes("'/public/sponsorship-batches/availability'"));
  assert.ok(api.includes("'/api/public/sponsorship-batches/availability'"));

  assert.ok(
    core.includes('export interface PublicSponsorshipBatchAvailability {')
  );
  assert.ok(core.includes('readonly nextAvailableAt: string | null;'));

  assert.ok(
    service.includes(
      'async getSponsorshipBatchAvailability(): Promise<PublicSponsorshipBatchAvailabilityResponse> {'
    )
  );
  assert.ok(service.includes('/public/sponsorship-batches/availability'));

  assert.ok(page.includes('loadSponsorshipBatchAvailability'));
  assert.ok(page.includes('sponsorshipAvailabilityEntries'));
  assert.ok(page.includes('class="sponsorship-tier-availability"'));

  for (const locale of [fr, en]) {
    assert.ok(
      locale.funding.home.contribution.sponsorship.availability.facebook
    );
    assert.ok(
      locale.funding.home.contribution.sponsorship.availability.linkedin
    );
  }
  assert.ok(
    fr.funding.home.contribution.sponsorship.availability.facebook.includes(
      '{{date}}'
    )
  );
  assert.ok(
    en.funding.home.contribution.sponsorship.availability.facebook.includes(
      '{{date}}'
    )
  );
});

test('Public sponsorships are exposed only after consent and approval', () => {
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  assert.ok(api.includes("'/public/sponsorships'"));
  assert.ok(api.includes("'/api/public/sponsorships'"));
  assert.ok(repository.includes('listPublicSponsorships'));
  assert.ok(repository.includes('public_display_consent IS TRUE'));
  assert.ok(repository.includes("sponsor_review_status = 'approved'"));
  assert.equal(repository.includes('sponsor_contact_email AS'), false);
  assert.equal(repository.includes('email_private AS'), false);
});

test('Admin sponsorship publication endpoint validates feed placement fields', () => {
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts',
    'utf8'
  );

  assert.ok(api.includes("'/admin/sponsorships/publication'"));
  assert.ok(api.includes("'/api/admin/sponsorships/publication'"));
  assert.ok(api.includes('isValidOptionalPublicSlug'));
  assert.ok(api.includes('isAllowedSponsorFeedTarget'));
  assert.ok(api.includes('parseSponsorFeedChannelsFromRequest'));
  assert.ok(api.includes('isAllowedSponsorFeedStatus'));
  assert.ok(api.includes('publicationUpdate.feedChannels'));
  assert.ok(repository.includes('mergePromisedSponsorFeedChannels'));
  assert.ok(repository.includes('sponsorshipBenefitFeedChannels'));
  assert.ok(repository.includes("facebook_batch: 'facebook'"));
  assert.ok(repository.includes("linkedin_batch: 'linkedin'"));
  assert.ok(service.includes('/admin/sponsorships/publication'));
});

test('Sponsors page is routed, prerendered, translated, and indexed', () => {
  const routes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.ts',
    'utf8'
  );
  const serverRoutes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.server.ts',
    'utf8'
  );
  const sitemap = fs.readFileSync('apps/funding-web/src/sitemap.xml', 'utf8');
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  assert.ok(routes.includes("path: 'commanditaires'"));
  assert.ok(serverRoutes.includes("path: 'commanditaires'"));
  assert.ok(serverRoutes.includes("path: 'en/commanditaires'"));
  assert.ok(sitemap.includes('https://openg7.org/commanditaires'));
  assert.ok(sitemap.includes('https://openg7.org/en/commanditaires'));

  for (const locale of [fr, en]) {
    assert.ok(locale.funding.nav.sponsors);
    assert.ok(locale.funding.seo.sponsors.title);
    assert.ok(locale.funding.sponsorsPage.hero.title);
    assert.ok(locale.funding.sponsorsPage.feedStatus.published);
  }
});

test('Usage and refund policy page is routed, linked, documented, and indexed', () => {
  const routes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.ts',
    'utf8'
  );
  const serverRoutes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.server.ts',
    'utf8'
  );
  const i18nService = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding-i18n.service.ts',
    'utf8'
  );
  const fundingPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts',
    'utf8'
  );
  const policyPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/usage-refund-policy-page/usage-refund-policy-page.component.ts',
    'utf8'
  );
  const sitemap = fs.readFileSync('apps/funding-web/src/sitemap.xml', 'utf8');
  const docs = [
    fs.readFileSync('README.md', 'utf8'),
    fs.readFileSync('docs/docker-deployment.md', 'utf8'),
    fs.readFileSync('docs/production-launch-checklist.md', 'utf8')
  ].join('\n');
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  assert.ok(routes.includes('UsageRefundPolicyPageComponent'));
  assert.ok(routes.includes("path: 'politique-utilisation-remboursement'"));
  assert.ok(
    serverRoutes.includes("path: 'politique-utilisation-remboursement'")
  );
  assert.ok(
    serverRoutes.includes("path: 'en/politique-utilisation-remboursement'")
  );
  assert.ok(i18nService.includes("| '/politique-utilisation-remboursement'"));
  assert.ok(i18nService.includes("'/politique-utilisation-remboursement'"));
  assert.ok(
    sitemap.includes('https://openg7.org/politique-utilisation-remboursement')
  );
  assert.ok(
    sitemap.includes(
      'https://openg7.org/en/politique-utilisation-remboursement'
    )
  );
  assert.ok(fundingPage.includes('policyPath'));
  assert.ok(fundingPage.includes('funding.home.contribution.policyLink'));
  assert.ok(policyPage.includes('funding.seo.policy.title'));
  assert.ok(policyPage.includes('funding.policyPage.sections.refunds'));
  assert.ok(policyPage.includes('funding.policyPage.sections.sponsorship'));
  assert.ok(docs.includes('/politique-utilisation-remboursement'));
  assert.ok(docs.includes('/en/politique-utilisation-remboursement'));

  for (const locale of [fr, en]) {
    assert.ok(locale.funding.seo.policy.title);
    assert.ok(locale.funding.home.contribution.policyLink);
    assert.ok(locale.funding.policyPage.hero.title);
    assert.ok(locale.funding.policyPage.sections.nature.items.noReceipt);
    assert.ok(locale.funding.policyPage.sections.refunds.items.request);
    assert.ok(locale.funding.policyPage.sections.disputes.items.stripe);
    assert.ok(locale.funding.policyPage.sections.sponsorship.items.followup);
    assert.ok(locale.funding.policyPage.sections.visibility.items.feed);
    assert.ok(locale.funding.policyPage.sections.privacy.items.privateData);
  }
});
