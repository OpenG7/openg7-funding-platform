import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

const assertIncludesAll = (source, values, label) => {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} must include ${value}`);
  }
};

const extractBetween = (source, start, end, label) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label} start marker was not found`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${label} end marker was not found`);
  return source.slice(startIndex, endIndex);
};

const coverageDoc = read('docs/sponsorship-e2e-coverage.md');

test('E2E 1/8: enterprise sponsorship checkout returns with recovery token', () => {
  const fundingPage = read(
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts'
  );
  const fundingService = read(
    'apps/funding-web/src/app/features/funding/services/funding.service.ts'
  );
  const api = read('apps/funding-api/src/main.ts');
  const checkoutMetadataBlock = extractBetween(
    api,
    'const checkoutMetadata',
    'const session = await stripe.checkout.sessions.create',
    'checkout metadata'
  );

  assertIncludesAll(
    fundingPage,
    [
      "setContributionType('sponsorship_interest')",
      'showSponsorFollowUp',
      'pendingSponsorFollowupToken',
      "params.get('followup_token')",
      'sponsor-followup-steps',
      'funding.home.checkout.sponsorFollowupCta'
    ],
    'funding page sponsorship checkout'
  );
  assert.equal(fundingPage.includes("params.get('session_id')"), false);
  assert.equal(fundingPage.includes('submitSponsorDetails()'), false);

  assertIncludesAll(
    fundingService,
    [
      "successUrl: this.buildReturnUrl('success', consent.contributionType)",
      "cancelUrl: this.buildReturnUrl('cancel')",
      'contributionType'
    ],
    'funding service return URL builder'
  );
  assert.equal(
    fundingService.includes('session_id={CHECKOUT_SESSION_ID}'),
    false
  );

  assertIncludesAll(
    api,
    [
      'createSponsorshipFollowupToken',
      'hashSponsorshipFollowupToken',
      'buildSponsorshipCheckoutSuccessUrl',
      'fonds-des-batisseurs/suivi-commandite',
      "url.searchParams.set('token', token)",
      'sponsorshipFollowupTokenHash',
      'createContributionPublicReference',
      'client_reference_id: publicReference',
      'buildContributionReceiptDescription'
    ],
    'checkout API follow-up token flow'
  );
  assert.equal(api.includes('appendQueryParam'), false);
  assert.equal(
    checkoutMetadataBlock.includes('sponsorshipFollowupToken,'),
    false
  );
});

test('E2E 2/8: sponsor can reopen token follow-up and submit company details', () => {
  const routes = read('apps/funding-web/src/app/app.routes.ts');
  const followupPage = read(
    'apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.ts'
  );
  const fundingService = read(
    'apps/funding-web/src/app/features/funding/services/funding.service.ts'
  );
  const api = read('apps/funding-api/src/main.ts');

  assertIncludesAll(
    routes,
    [
      "path: 'fonds-des-batisseurs/suivi-commandite'",
      'SponsorshipFollowupPageComponent'
    ],
    'follow-up route'
  );

  assertIncludesAll(
    followupPage,
    [
      'queryParamMap.get',
      "'token'",
      'history.replaceState',
      'getSponsorshipFollowup',
      'submitSponsorshipFollowupDetails',
      'current.publicReference',
      "'paid'",
      "'refunded'",
      "'disputed'"
    ],
    'follow-up page token workflow'
  );

  assertIncludesAll(
    fundingService,
    [
      '/sponsorship-followup?',
      '/sponsorship-followup/details',
      'SponsorshipFollowupDetailsRequest'
    ],
    'follow-up API service'
  );

  assertIncludesAll(
    api,
    [
      "'/sponsorship-followup'",
      "'/api/sponsorship-followup'",
      "'/sponsorship-followup/details'",
      "'/api/sponsorship-followup/details'",
      'publicReference: followup.publicReference',
      'recordSponsorshipDetailsForContribution'
    ],
    'follow-up API routes'
  );
});

test('E2E 3/8: invalid or missing follow-up token stays private and shows an error', () => {
  const followupPage = read(
    'apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.ts'
  );
  const api = read('apps/funding-api/src/main.ts');

  assertIncludesAll(
    followupPage,
    [
      'if (!this.token())',
      "this.state.set('error')",
      'Lien introuvable',
      'Contacter le support'
    ],
    'follow-up invalid token UI'
  );

  assertIncludesAll(
    api,
    [
      'isValidFollowupToken',
      'getSponsorshipFollowupTokenCutoffIso',
      'Invalid sponsorship follow-up token.',
      'Sponsorship follow-up was not found.'
    ],
    'follow-up invalid token API'
  );
});

test('E2E 4/8: admin can list paid sponsorships behind admin authorization', () => {
  const routes = read('apps/funding-web/src/app/app.routes.ts');
  const adminPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts'
  );
  const adminService = read(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts'
  );
  const api = read('apps/funding-api/src/main.ts');
  const repository = read(
    'apps/funding-api/src/fund-contributions.repository.ts'
  );

  assertIncludesAll(
    routes,
    ["path: 'admin/fundraiser/sponsors'", 'AdminSponsorsPageComponent'],
    'admin route'
  );

  assertIncludesAll(
    adminPage,
    [
      'loadSponsorships()',
      'visibleCount',
      'activeCount',
      'totalContribution',
      'visibilityLabel',
      'uploadLogo',
      'deleteLogo',
      'logoPreviewSourceFor',
      'sponsorship.public_reference',
      'image/png,image/jpeg,image/webp'
    ],
    'admin sponsorship list UI'
  );

  assertIncludesAll(
    adminService,
    [
      '/admin/sponsorships',
      '/admin/sponsorships/logo',
      '/admin/sponsorships/logo/delete',
      'uploadSponsorLogo',
      'getSponsorLogoPreview',
      'deleteSponsorLogo',
      '/admin/session',
      'Authorization: `Bearer ${sessionToken}`'
    ],
    'admin sponsorship service'
  );

  assertIncludesAll(
    api,
    [
      'ensureAdminAccess',
      'FUNDING_ADMIN_TOKEN',
      'verifyAdminSession',
      'parseMultipartFormData',
      'detectSponsorLogoFileType',
      'sponsorship.logo.upload',
      'sponsorship.logo.delete',
      'deleteControlledSponsorLogoFile',
      "'/admin/sponsorships'"
    ],
    'admin sponsorship API'
  );

  assertIncludesAll(
    repository,
    [
      'listAdminSponsorships',
      'updateSponsorshipLogoUrl',
      'clearSponsorshipLogoUrl',
      'getAdminSponsorshipLogoUrl',
      'isPublicApprovedSponsorshipLogoUrl',
      'public_reference',
      "contribution_type = 'sponsorship_interest'",
      "status IN ('paid', 'refunded', 'disputed')"
    ],
    'admin sponsorship repository'
  );
});

test('E2E 5/8: admin can approve, reset, or reject sponsorship visibility', () => {
  const adminPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts'
  );
  const adminService = read(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts'
  );
  const api = read('apps/funding-api/src/main.ts');
  const repository = read(
    'apps/funding-api/src/fund-contributions.repository.ts'
  );

  assertIncludesAll(
    adminPage,
    [
      "review(selected, 'pending_review')",
      "review(selected, 'rejected')",
      "review(selected, 'approved')",
      'reviewNoteFor'
    ],
    'admin review buttons'
  );

  assertIncludesAll(
    adminService,
    ['/admin/sponsorships/review', 'AdminSponsorshipReviewRequest'],
    'admin review service'
  );

  assertIncludesAll(
    api,
    [
      "'/admin/sponsorships/review'",
      'isAllowedSponsorshipReviewStatus',
      'ADMIN_REVIEW_NOTE_MAX_LENGTH'
    ],
    'admin review API validation'
  );

  assertIncludesAll(
    repository,
    ['updateSponsorshipReview', 'sponsor_review_status = $2'],
    'admin review repository'
  );
});

test('E2E 6/8: admin can prepare OpenG7/OpenG20 Facebook and LinkedIn feed placement', () => {
  const adminPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts'
  );
  const adminService = read(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts'
  );
  const api = read('apps/funding-api/src/main.ts');
  const repository = read(
    'apps/funding-api/src/fund-contributions.repository.ts'
  );
  const migration = read(
    'apps/funding-api/migrations/006_add_sponsorship_publication_feed.sql'
  );
  const allSource = [adminPage, adminService, api, repository, migration].join(
    '\n'
  );

  assertIncludesAll(
    adminPage,
    [
      'publication-editor',
      'savePublication(selected)',
      'publicationDirtyFor',
      'slugErrorFor',
      '<option value="openg7">OpenG7</option>',
      '<option value="openg20">OpenG20</option>',
      'Facebook',
      'LinkedIn',
      'feedPublicUrl'
    ],
    'admin publication UI'
  );

  assertIncludesAll(
    api,
    [
      "'/admin/sponsorships/publication'",
      'isAllowedSponsorFeedTarget',
      'parseSponsorFeedChannelsFromRequest',
      'isAllowedSponsorFeedStatus',
      'isValidOptionalHttpsUrl(parsed.feedPublicUrl)'
    ],
    'admin publication API validation'
  );

  assertIncludesAll(
    repository,
    [
      'updateSponsorshipPublication',
      'sponsor_feed_target = $4',
      'sponsor_feed_channels = $5::jsonb',
      'sponsor_feed_status = $6'
    ],
    'admin publication repository'
  );

  assertIncludesAll(
    migration,
    [
      'sponsor_feed_target',
      'sponsor_feed_channels JSONB',
      'sponsor_feed_status TEXT',
      'sponsor_feed_public_url'
    ],
    'publication migration'
  );

  assert.equal(
    /graph\.facebook\.com|api\.linkedin\.com/i.test(allSource),
    false
  );
});

test('E2E 7/8: public sponsors page exposes only approved consented sponsorships', () => {
  const routes = read('apps/funding-web/src/app/app.routes.ts');
  const sponsorsPage = read(
    'apps/funding-web/src/app/features/funding/pages/sponsors-page/sponsors-page.component.ts'
  );
  const sponsorshipsService = read(
    'apps/funding-web/src/app/features/funding/services/sponsorships.service.ts'
  );
  const repository = read(
    'apps/funding-api/src/fund-contributions.repository.ts'
  );
  const publicListBody = extractBetween(
    repository,
    'export const listPublicSponsorships',
    'export interface SponsorshipFollowupLookup',
    'public sponsorship list'
  );

  assertIncludesAll(
    routes,
    ["path: 'commanditaires'", 'SponsorsPageComponent'],
    'sponsors public route'
  );

  assertIncludesAll(
    sponsorshipsService,
    ['/public/sponsorships', 'PublicSponsorshipsResponse'],
    'public sponsorship service'
  );

  assertIncludesAll(
    sponsorsPage,
    [
      'hasFeedPlacement',
      'feedStatusLabel',
      'feed_public_url',
      'funding.sponsorsPage.directory.feedLink',
      'funding.sponsorsPage.empty.title'
    ],
    'public sponsors page UI'
  );

  assertIncludesAll(
    publicListBody,
    [
      'public_display_consent IS TRUE',
      "sponsor_review_status = 'approved'",
      'sponsor_company_name IS NOT NULL',
      'display_amount_consent IS TRUE'
    ],
    'public sponsorship query filters'
  );

  assert.equal(
    /sponsor_contact_email|email_private|stripe_session_id|stripe_payment_intent_id/.test(
      publicListBody
    ),
    false
  );
});

test('E2E 8/8: FR/EN navigation, prerender, sitemap, and deployment docs cover sponsor routes', () => {
  const header = read(
    'apps/funding-web/src/app/features/funding/components/funding-header/funding-header.component.ts'
  );
  const i18nService = read(
    'apps/funding-web/src/app/features/funding/services/funding-i18n.service.ts'
  );
  const serverRoutes = read('apps/funding-web/src/app/app.routes.server.ts');
  const sitemap = read('apps/funding-web/src/sitemap.xml');
  const readme = read('README.md');
  const dockerDocs = read('docs/docker-deployment.md');
  const launchChecklist = read('docs/production-launch-checklist.md');
  const fr = JSON.parse(read('apps/funding-web/src/assets/i18n/fr-CA.json'));
  const en = JSON.parse(read('apps/funding-web/src/assets/i18n/en.json'));

  assertIncludesAll(
    header,
    [
      'sponsorsPath',
      "this.i18n.localizedPath('/commanditaires')",
      'funding.nav.sponsors'
    ],
    'header sponsor navigation'
  );

  assertIncludesAll(
    i18nService,
    ["| '/commanditaires'", "'/commanditaires'"],
    'localized sponsor path'
  );

  assertIncludesAll(
    serverRoutes,
    ["path: 'commanditaires'", "path: 'en/commanditaires'"],
    'sponsor prerender routes'
  );

  assertIncludesAll(
    sitemap,
    [
      'https://openg7.org/commanditaires',
      'https://openg7.org/en/commanditaires'
    ],
    'sponsor sitemap entries'
  );

  for (const locale of [fr, en]) {
    assert.ok(locale.funding.nav.sponsors);
    assert.ok(locale.funding.seo.sponsors.title);
    assert.ok(locale.funding.sponsorsPage.hero.title);
    assert.ok(locale.funding.sponsorsPage.feedStatus.published);
  }

  assertIncludesAll(
    [readme, dockerDocs, launchChecklist, coverageDoc].join('\n'),
    [
      '006_add_sponsorship_publication_feed.sql',
      'GET /api/public/sponsorships',
      '/commanditaires',
      '/en/commanditaires',
      '100%'
    ],
    'documentation coverage'
  );
});
