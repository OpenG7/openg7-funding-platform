import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

const assertIncludesAll = (source, values, label) => {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} must include ${value}`);
  }
};

test('admin back-office exposes dashboard, contributions, and CSV export', () => {
  const routes = read('apps/funding-web/src/app/app.routes.ts');
  const adminService = read(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts'
  );
  const dashboardPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-dashboard-page/admin-dashboard-page.component.ts'
  );
  const loginPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-login-page/admin-login-page.component.ts'
  );
  const contributionsPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-contributions-page/admin-contributions-page.component.ts'
  );
  const expensesPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expenses-page.component.ts'
  );
  const transparencyPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-transparency-page/admin-transparency-page.component.ts'
  );
  const publicationsPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-publications-page/admin-publications-page.component.ts'
  );
  const auditPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-audit-page/admin-audit-page.component.ts'
  );
  const sponsorsPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts'
  );
  const adminNav = read(
    'apps/funding-web/src/app/features/funding/components/admin-nav/admin-nav.component.ts'
  );
  const siteMusic = read(
    'apps/funding-web/src/app/features/funding/components/site-music/site-music.component.ts'
  );
  const api = read('apps/funding-api/src/main.ts');
  const repository = read(
    'apps/funding-api/src/fund-contributions.repository.ts'
  );
  const adminRepository = read('apps/funding-api/src/fund-admin.repository.ts');
  const migration = read(
    'apps/funding-api/migrations/007_add_admin_audit_and_publication_drafts.sql'
  );
  const core = read('packages/funding-core/src/index.ts');
  const readme = read('README.md');

  assertIncludesAll(
    routes,
    [
      "path: 'admin/login'",
      'AdminLoginPageComponent',
      'adminSessionRequired',
      "createUrlTree(['/admin/login']",
      "path: 'admin/fundraiser'",
      'canMatch: [adminSessionRequired]',
      'AdminDashboardPageComponent',
      "path: 'admin/fundraiser/contributions'",
      'AdminContributionsPageComponent',
      "path: 'admin/fundraiser/publications'",
      'AdminPublicationsPageComponent',
      "path: 'admin/fundraiser/expenses'",
      'AdminExpensesPageComponent',
      "path: 'admin/fundraiser/transparency'",
      'AdminTransparencyPageComponent',
      "path: 'admin/fundraiser/audit'",
      'AdminAuditPageComponent'
    ],
    'admin Angular routes'
  );

  assertIncludesAll(
    adminNav,
    [
      'routerLink="/admin/fundraiser"',
      'routerLink="/admin/fundraiser/contributions"',
      'routerLink="/admin/fundraiser/sponsors"',
      'routerLink="/admin/fundraiser/publications"',
      'routerLink="/admin/fundraiser/expenses"',
      'routerLink="/admin/fundraiser/transparency"',
      'routerLink="/admin/fundraiser/audit"'
    ],
    'admin navigation'
  );

  assertIncludesAll(
    siteMusic,
    [
      'isAdminRoute()',
      "routerPath.startsWith('/admin/')",
      "browserPath.startsWith('/admin/')",
      'this.isAvailable.set(false)',
      'this.stopMusic()'
    ],
    'admin music suppression'
  );

  assertIncludesAll(
    adminService,
    [
      'getDashboard',
      '/admin/dashboard',
      'getContributions',
      '/admin/contributions',
      'getContributionsCsv',
      '/admin/contributions.csv',
      'getExpenses',
      '/admin/expenses',
      'updateExpense',
      '/admin/expenses/update',
      'getTransparency',
      '/admin/transparency',
      'getPublicationDrafts',
      '/admin/publication-drafts',
      'updatePublicationDraft',
      '/admin/publication-drafts/update',
      'getAuditLog',
      '/admin/audit-log',
      'uploadSponsorLogo',
      'getSponsorLogoPreview',
      'deleteSponsorLogo',
      '/admin/sponsorships/logo',
      '/admin/sponsorships/logo/delete',
      'FormData',
      'getSavedAdminToken',
      'saveAdminToken',
      'clearAdminSession',
      'hasValidAdminSession',
      'signIn',
      'createAdminSession',
      '/admin/session',
      'openg7-admin-session-token',
      'openg7-admin-session-expires-at'
    ],
    'admin service'
  );

  assertIncludesAll(
    loginPage,
    [
      'Acces admin',
      'signIn()',
      'hasValidAdminSession',
      'navigateByUrl',
      'returnUrl'
    ],
    'admin login page'
  );

  assertIncludesAll(
    dashboardPage,
    [
      'sponsorship_review.pending',
      'feed_publication.active',
      'stripe_events.failed',
      'recent_contributions'
    ],
    'admin dashboard page'
  );

  assertIncludesAll(
    contributionsPage,
    [
      'filteredContributions',
      'typeFilter',
      'statusFilter',
      'publicFilter',
      'exportCsv',
      'saveCsv',
      'contribution.public_reference',
      'reference-cell'
    ],
    'admin contributions page'
  );

  assertIncludesAll(
    sponsorsPage,
    [
      'filteredSponsorships',
      'reviewFilter',
      'feedFilter',
      'sponsors-board',
      'sponsor-detail-panel',
      'detail-tabs',
      'visibleCount',
      'activeCount',
      'totalContribution',
      'uploadLogo',
      'deleteLogo',
      'logoPreviewSourceFor',
      'secondary-danger-action',
      'sponsorship.public_reference',
      'copyReference',
      'image/png,image/jpeg,image/webp',
      'sponsorLogoMaxBytes',
      'review-toast',
      'selection-pulse',
      'scrollSelectedSponsorshipIntoView',
      'scrollIntoView',
      'reviewMessageTimers',
      'setTimeout(() => {',
      '}, 3000)',
      'reviewSuccessMessage'
    ],
    'admin sponsorship filters'
  );

  assertIncludesAll(
    expensesPage,
    [
      'createExpense',
      'saveExpense',
      'filteredExpenses',
      'published',
      'archived'
    ],
    'admin expenses page'
  );

  assertIncludesAll(
    transparencyPage,
    [
      'getTransparency',
      'publishedExpenses',
      'public_summary',
      'expenses_summary'
    ],
    'admin transparency page'
  );

  assertIncludesAll(
    publicationsPage,
    [
      'eligibleSponsorships',
      'createPublicationDraft',
      'updatePublicationDraft',
      'copyDraft',
      'pending_review',
      'published'
    ],
    'admin publications page'
  );

  assertIncludesAll(
    auditPage,
    ['getAuditLog', 'filteredEntries', 'entityLabel', 'Journal admin'],
    'admin audit page'
  );

  assertIncludesAll(
    api,
    [
      "'/admin/dashboard'",
      "'/admin/contributions'",
      "'/admin/contributions.csv'",
      "'/admin/session'",
      "'/admin/sponsorships/logo'",
      "'/admin/sponsorships/logo/delete'",
      'SPONSOR_LOGO_PUBLIC_PATH_PREFIX',
      'FUNDING_SPONSOR_LOGO_STORAGE_DIR',
      'FUNDING_SPONSOR_LOGO_MAX_BYTES',
      'parseMultipartFormData',
      'detectSponsorLogoFileType',
      'deleteControlledSponsorLogoFile',
      'getAdminSponsorshipLogoUrl',
      'clearSponsorshipLogoUrl',
      'isPublicApprovedSponsorshipLogoUrl',
      'sponsorship.logo.upload',
      'sponsorship.logo.delete',
      "'/admin/expenses'",
      "'/admin/expenses/update'",
      "'/admin/transparency'",
      "'/admin/publication-drafts'",
      "'/admin/publication-drafts/update'",
      "'/admin/audit-log'",
      'ensureAdminAccess',
      'createAdminSession',
      'verifyAdminSession',
      'FUNDING_ADMIN_SESSION_SECRET',
      'FUNDING_ADMIN_SESSION_TTL_MINUTES',
      'public_reference',
      'insertAdminAuditLog',
      'buildAdminContributionsCsv',
      'writeCsv'
    ],
    'admin API routes'
  );

  assertIncludesAll(
    repository,
    [
      'getAdminDashboard',
      'listAdminContributions',
      'getAdminContributionsSummary',
      'getAdminStripeEventSummary',
      'listRecentAdminContributions',
      'updateSponsorshipLogoUrl',
      'clearSponsorshipLogoUrl',
      'getAdminSponsorshipLogoUrl',
      'previous_logo_url',
      'isPublicApprovedSponsorshipLogoUrl'
    ],
    'admin repository'
  );

  assertIncludesAll(
    adminRepository,
    [
      'listAdminPublicationDrafts',
      'createAdminPublicationDraft',
      'updateAdminPublicationDraft',
      'listAdminExpenses',
      'createAdminExpense',
      'updateAdminExpense',
      'insertAdminAuditLog',
      'listAdminAuditLog',
      'allowedPublicationDraftStatuses'
    ],
    'admin publication and audit repository'
  );

  assertIncludesAll(
    migration,
    [
      'admin_audit_log',
      'sponsor_publication_drafts',
      'idx_sponsor_publication_drafts_unique_channel'
    ],
    'admin publication and audit migration'
  );

  assertIncludesAll(
    core,
    [
      'AdminDashboardResponse',
      'AdminContributionRecord',
      'AdminContributionsResponse',
      'AdminContributionsSummary',
      'AdminExpenseRecord',
      'AdminExpensesResponse',
      'AdminTransparencyResponse',
      'AdminSessionResponse',
      'AdminSponsorLogoUploadResult',
      'AdminSponsorLogoDeleteResult',
      'public_reference',
      'PublicationDraftStatus',
      'AdminPublicationDraftRecord',
      'AdminAuditLogEntry'
    ],
    'admin shared contracts'
  );

  assertIncludesAll(
    readme,
    [
      '/admin/fundraiser',
      'POST /api/admin/session',
      'GET /api/admin/dashboard',
      'POST /api/admin/sponsorships/logo',
      'GET /api/admin/sponsorships/logo',
      'POST /api/admin/sponsorships/logo/delete',
      'GET /api/public/sponsor-logos/<file>',
      'GET /api/admin/contributions',
      'GET /api/admin/contributions.csv',
      'GET /api/admin/expenses',
      'GET /api/admin/transparency',
      'GET /api/admin/publication-drafts',
      'GET /api/admin/audit-log',
      '007_add_admin_audit_and_publication_drafts.sql'
    ],
    'admin docs'
  );
});
