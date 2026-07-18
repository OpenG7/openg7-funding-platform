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
  const setupPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-setup-page/admin-setup-page.component.ts'
  );
  const sponsorsPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts'
  );
  const invoicesPage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-invoices-page/admin-invoices-page.component.ts'
  );
  const emailQueuePage = read(
    'apps/funding-web/src/app/features/funding/pages/admin-email-queue-page/admin-email-queue-page.component.ts'
  );
  const adminNav = read(
    'apps/funding-web/src/app/features/funding/components/admin-nav/admin-nav.component.ts'
  );
  const siteMusic = read(
    'apps/funding-web/src/app/features/funding/components/site-music/site-music.component.ts'
  );
  const api = read('apps/funding-api/src/main.ts');
  const webhookService = read('apps/funding-api/src/stripe-webhook.service.ts');
  const emailService = read(
    'apps/funding-api/src/email-notification.service.ts'
  );
  const pdfService = read(
    'apps/funding-api/src/sponsorship-document-pdf.service.ts'
  );
  const apiPackage = read('apps/funding-api/package.json');
  const repository = read(
    'apps/funding-api/src/fund-contributions.repository.ts'
  );
  const adminRepository = read('apps/funding-api/src/fund-admin.repository.ts');
  const invoiceRepository = read(
    'apps/funding-api/src/sponsorship-invoices.repository.ts'
  );
  const migration = read(
    'apps/funding-api/migrations/007_add_admin_audit_and_publication_drafts.sql'
  );
  const refundStatusMigration = read(
    'apps/funding-api/migrations/013_add_sponsorship_refund_status.sql'
  );
  const refundAmountReasonMigration = read(
    'apps/funding-api/migrations/014_add_sponsorship_refund_amount_reason.sql'
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
      "path: 'admin/fundraiser/invoices'",
      'AdminInvoicesPageComponent',
      "path: 'admin/fundraiser/publications'",
      'AdminPublicationsPageComponent',
      "path: 'admin/fundraiser/expenses'",
      'AdminExpensesPageComponent',
      "path: 'admin/fundraiser/transparency'",
      'AdminTransparencyPageComponent',
      "path: 'admin/fundraiser/audit'",
      'AdminAuditPageComponent',
      "path: 'admin/fundraiser/email-queue'",
      'AdminEmailQueuePageComponent',
      "path: 'admin/fundraiser/setup'",
      'AdminSetupPageComponent'
    ],
    'admin Angular routes'
  );

  assertIncludesAll(
    adminNav,
    [
      'routerLink="/admin/fundraiser"',
      'routerLink="/admin/fundraiser/contributions"',
      'routerLink="/admin/fundraiser/sponsors"',
      'routerLink="/admin/fundraiser/invoices"',
      'routerLink="/admin/fundraiser/publications"',
      'routerLink="/admin/fundraiser/expenses"',
      'routerLink="/admin/fundraiser/transparency"',
      'routerLink="/admin/fundraiser/audit"',
      'routerLink="/admin/fundraiser/email-queue"',
      'routerLink="/admin/fundraiser/setup"'
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
      'getSetupStatus',
      '/admin/setup-status',
      'sendEmailTest',
      '/admin/email/test',
      'getEmailQueue',
      '/admin/email-queue',
      'retryEmailQueueMessage',
      '/admin/email-queue/retry',
      'getSponsorshipInvoices',
      '/admin/sponsorship-invoices',
      'backfillSponsorshipInvoices',
      '/admin/sponsorship-invoices/backfill',
      'resendSponsorshipInvoice',
      '/admin/sponsorship-invoices/resend',
      'getSponsorshipInvoicePdf',
      '/admin/sponsorship-invoices/pdf',
      'resendSponsorshipCreditNote',
      '/admin/sponsorship-credit-notes/resend',
      'getSponsorshipCreditNotePdf',
      '/admin/sponsorship-credit-notes/pdf',
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
      'reviewSponsorship',
      '/admin/sponsorships/review',
      'refundSponsorship',
      '/admin/sponsorships/refund',
      'AdminSponsorshipListQuery',
      'URLSearchParams',
      'expectedVersion',
      'errorMessageFromResponse',
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
      'paymentFilter',
      'pagination().totalItems',
      'response.items ?? response.sponsorships',
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
      'sponsorshipProcessingState',
      'sponsorshipRowStateClass',
      'sponsor-row-state-action-required',
      'sponsor-row-state-approved-ready',
      'sponsor-row-state-publication-progress',
      'sponsor-row-state-published',
      'sponsor-row-state-blocked',
      'sponsor-row-state-waiting-payment',
      'scrollSelectedSponsorshipIntoView',
      'scrollIntoView',
      'reviewMessageTimers',
      'setTimeout(() => {',
      '}, 3000)',
      'reviewSuccessMessage',
      'openRejectionPanel',
      'confirmRejection',
      'rejection-workflow',
      'notifySponsor',
      'refundHandling',
      'refund-workflow',
      'openRefundPanel',
      'confirmRefund',
      'refundConfirmationText',
      'refundActionId',
      'canRefundSponsorship',
      'refundWorkflowStatusLabel',
      'refundWorkflowTimelineLabel',
      'refundWorkflowStatusClass',
      'stripeRefundReasonLabel',
      'refundAmountFor',
      'refundDraftAmountLabel',
      'setRefundDraftReason',
      'refundAmount',
      'refundReason',
      'refundHistoryEntriesFor',
      'refundAuditEntriesFor',
      'refundHistoryEntryClass',
      'SponsorRefundHistoryEntry',
      "activeTab() === 'refund'",
      'sponsorship_refund_status',
      'refund-badge',
      'refund-processing',
      'refund-completed',
      'refund-summary-grid',
      'refund-history-list',
      'metadataString',
      'refundHandlingAuditLabel',
      'creditNoteNumber',
      'refundNotificationResultLabel',
      'Envoyer le courriel de remboursement',
      'refundSponsorship',
      'admin_audit_entries',
      'adminAuditLabel',
      'Acteur: ${entry.actor}',
      'paymentEligibilityMessage',
      'canApproveSponsorship',
      'canSavePublication',
      'expectedVersion: sponsorship.version',
      'messageFromError'
    ],
    'admin sponsorship filters'
  );

  assertIncludesAll(
    invoicesPage,
    [
      'getSponsorshipInvoices',
      'resendSponsorshipInvoice',
      'selectedInvoice',
      'selectedInvoiceId',
      'credit_notes',
      'credit-notes-panel',
      'downloadInvoicePdf',
      'downloadCreditNotePdf',
      'backfillInvoices',
      'backfillResultMessage',
      'backfillSponsorshipInvoices',
      'Generer factures manquantes',
      'created_count',
      'remaining_count',
      'Telecharger PDF',
      'saveBlob',
      'last_email_status',
      'last_email_recipient',
      'credit_note_number',
      'invoice_number',
      'line_items',
      'stripe_refund_id',
      'stripe_session_id',
      'Renvoyer avoir',
      'Renvoyer'
    ],
    'admin invoice page'
  );

  assertIncludesAll(
    emailQueuePage,
    [
      'AdminEmailQueueResponse',
      'getEmailQueue',
      'retryEmailQueueMessage',
      'filteredMessages',
      'statusFilter',
      'retryMessage',
      'Relancer',
      'queued_count',
      'failed_count',
      'retryable_count',
      'last_error'
    ],
    'admin email queue page'
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
    setupPage,
    [
      'getSetupStatus',
      'sendEmailTest',
      'tourSteps',
      'data-tour-anchor="stripe"',
      'data-tour-anchor="email"',
      'data-tour-anchor="queue"',
      'data-tour-anchor="database"',
      'RESEND_API_KEY',
      'FUNDING_EMAIL_FROM',
      'FUNDING_ADMIN_NOTIFICATION_EMAIL',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'DATABASE_URL'
    ],
    'admin setup page'
  );

  assertIncludesAll(
    api,
    [
      "'/admin/dashboard'",
      "'/admin/setup-status'",
      "'/admin/email/test'",
      "'/admin/email-queue'",
      "'/admin/email-queue/retry'",
      "'/admin/sponsorship-invoices'",
      "'/admin/sponsorship-invoices/backfill'",
      "'/admin/sponsorship-invoices/pdf'",
      "'/admin/sponsorship-invoices/resend'",
      "'/admin/sponsorship-credit-notes/pdf'",
      "'/admin/sponsorship-credit-notes/resend'",
      'listAdminSponsorshipInvoices',
      'getSponsorshipInvoiceById',
      'getAdminSponsorshipInvoiceById',
      'backfillMissingSponsorshipInvoices',
      'renderSponsorshipInvoicePdf',
      'renderSponsorshipCreditNotePdf',
      "'application/pdf'",
      'queueSponsorshipInvoiceEmail',
      'queueSponsorshipCreditNoteEmail',
      'queueSponsorshipRejectionEmail',
      'queueSponsorshipRefundEmail',
      'sponsorship_invoice.resend',
      'sponsorship_invoice.backfill',
      'sponsorship_credit_note.resend',
      'buildAdminSetupStatus',
      'queueEmailConfigurationTest',
      'getEmailQueueStatus',
      'listAdminEmailQueue',
      'retryAdminEmailQueueMessage',
      'email_queue.retry',
      'AdminEmailQueueRetryResult',
      "'/admin/contributions'",
      "'/admin/contributions.csv'",
      "'/admin/session'",
      "'/admin/sponsorships/logo'",
      "'/admin/sponsorships/logo/delete'",
      "'/admin/sponsorships/review'",
      "'/admin/sponsorships/refund'",
      'parseAdminSponsorshipsQuery',
      'adminSponsorshipPageSizes',
      'SPONSORSHIP_CONCURRENT_UPDATE',
      'SPONSORSHIP_PAYMENT_NOT_ELIGIBLE',
      'SPONSORSHIP_REFUND_NOT_ELIGIBLE',
      'isValidAdminExpectedVersion',
      'stripe.refunds.create',
      'sponsorship_refund.stripe_full',
      'sponsorship_refund.stripe_partial',
      'requestedRefundAmountCents',
      'reason: refundReason',
      'refundWorkflowStatus',
      'fullRefund',
      'refundReason',
      'createSponsorshipCreditNoteForRefund',
      'sponsorship-refund-email:',
      'getSponsorshipRefundTarget',
      'updateSponsorshipRefundWorkflowStatus',
      'updateContributionStatusByPaymentIntent',
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
    webhookService,
    [
      'charge.refunded',
      'updateSponsorshipRefundWorkflowStatusByPaymentIntent',
      'refundWorkflowUpdated',
      'isFullyRefunded',
      'partialRefund',
      'latestRefund'
    ],
    'Stripe refund webhook'
  );

  assertIncludesAll(
    emailService,
    [
      "'sponsorship_rejection'",
      "'sponsorship_refund'",
      "'sponsorship_credit_note'",
      'queueSponsorshipRejectionEmail',
      'queueSponsorshipRefundEmail',
      'queueSponsorshipCreditNoteEmail',
      'renderSponsorshipRejectionEmail',
      'renderSponsorshipRefundEmail',
      'renderSponsorshipCreditNoteEmail',
      'refundHandling',
      'listAdminEmailQueue',
      'getAdminEmailQueueMessageById',
      'retryAdminEmailQueueMessage',
      "to_regclass('public.email_messages')",
      'AdminEmailQueueResponse'
    ],
    'admin rejection email service'
  );

  assertIncludesAll(
    pdfService,
    [
      "import PDFDocument from 'pdfkit';",
      'renderSponsorshipInvoicePdf',
      'renderSponsorshipCreditNotePdf',
      'sponsorshipInvoicePdfFilename',
      'sponsorshipCreditNotePdfFilename'
    ],
    'admin sponsorship PDF service'
  );

  assertIncludesAll(apiPackage, ['"pdfkit"', '"@types/pdfkit"'], 'API package');

  assertIncludesAll(
    repository,
    [
      'getAdminDashboard',
      'listAdminContributions',
      'getAdminContributionsSummary',
      'getAdminStripeEventSummary',
      'listRecentAdminContributions',
      'AdminSponsorshipListInput',
      'AdminSponsorshipListResult',
      'mapAdminSponsorshipRow',
      'listAdminSponsorshipAuditEntries',
      "to_regclass('public.admin_audit_log')",
      'admin_audit_entries: adminAuditEntries',
      'adminSponsorshipListOrderBy',
      'payment_not_eligible',
      'updated_at::text AS version',
      'getSponsorshipRefundTarget',
      'updateSponsorshipRefundWorkflowStatus',
      'updateSponsorshipRefundWorkflowStatusByPaymentIntent',
      'allowedSponsorshipRefundWorkflowStatuses',
      'allowedSponsorshipStripeRefundReasons',
      'sponsorship_refund_status',
      'sponsorship_refund_amount_cents',
      'sponsorship_refund_reason',
      'stripe_payment_intent_id',
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
    invoiceRepository,
    [
      'listAdminSponsorshipInvoices',
      'getSponsorshipInvoiceById',
      'getAdminSponsorshipInvoiceById',
      'getAdminSponsorshipCreditNoteById',
      'createSponsorshipCreditNoteForRefund',
      'backfillMissingSponsorshipInvoices',
      'SponsorshipInvoiceBackfillCandidateRow',
      'invoice.id IS NULL',
      'last_email_status',
      'latestInvoiceEmailJoin',
      "metadata->>'creditNoteId'",
      'credit_notes',
      'AdminSponsorshipInvoicesResponse'
    ],
    'admin invoice repository'
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
    refundStatusMigration,
    [
      'sponsorship_refund_status',
      "'not_requested'",
      "'completed'",
      'sponsorship_refund_requested_at',
      'sponsorship_refund_processed_at',
      'sponsorship_refund_completed_at',
      'sponsorship_refund_id',
      'sponsorship_refund_error',
      'fund_contributions_sponsorship_refund_status_check',
      'idx_fund_contributions_sponsorship_refund_status'
    ],
    'admin sponsorship refund status migration'
  );

  assertIncludesAll(
    refundAmountReasonMigration,
    [
      'sponsorship_refund_amount_cents',
      'sponsorship_refund_reason',
      'fund_contributions_sponsorship_refund_amount_check',
      'fund_contributions_sponsorship_refund_reason_check',
      "'requested_by_customer'",
      "'duplicate'",
      "'fraudulent'"
    ],
    'admin sponsorship refund amount and reason migration'
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
      'AdminSetupStatusResponse',
      'AdminEmailTestRequest',
      'AdminEmailTestResult',
      'AdminEmailQueueResponse',
      'AdminEmailQueueMessageRecord',
      'AdminEmailQueueRetryRequest',
      'AdminEmailQueueRetryResult',
      'AdminSponsorshipInvoiceRecord',
      'AdminSponsorshipCreditNoteRecord',
      'AdminSponsorshipInvoicesResponse',
      'AdminSponsorshipInvoiceBackfillRequest',
      'AdminSponsorshipInvoiceBackfillResult',
      'AdminSponsorshipInvoiceResendRequest',
      'AdminSponsorshipInvoiceResendResult',
      'AdminSponsorshipCreditNoteResendRequest',
      'AdminSponsorshipCreditNoteResendResult',
      'AdminSponsorshipRejectionRefundHandling',
      'AdminSponsorshipRefundRequest',
      'AdminSponsorshipRefundResult',
      'AdminSponsorshipRefundWorkflowStatus',
      'AdminSponsorshipStripeRefundReason',
      'readonly sponsorship_refund_status: AdminSponsorshipRefundWorkflowStatus;',
      'readonly sponsorship_refund_amount: number | null;',
      'readonly sponsorship_refund_reason: AdminSponsorshipStripeRefundReason | null;',
      'readonly refundWorkflowStatus: AdminSponsorshipRefundWorkflowStatus;',
      'readonly fullRefund: boolean;',
      'AdminPagination',
      'readonly admin_audit_entries: readonly AdminAuditLogEntry[];',
      'readonly version: string;',
      'readonly items: readonly AdminSponsorshipRecord[];',
      'readonly expectedVersion: string;',
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
      '/admin/fundraiser/setup',
      '/admin/fundraiser/email-queue',
      '/admin/fundraiser/invoices',
      'POST /api/admin/session',
      'GET /api/admin/dashboard',
      'GET /api/admin/setup-status',
      'POST /api/admin/email/test',
      'GET /api/admin/email-queue',
      'POST /api/admin/email-queue/retry',
      'GET /api/admin/sponsorship-invoices',
      'POST /api/admin/sponsorship-invoices/backfill',
      'GET /api/admin/sponsorship-invoices/pdf?invoiceId=<uuid>',
      'POST /api/admin/sponsorship-invoices/resend',
      'GET /api/admin/sponsorship-credit-notes/pdf?creditNoteId=<uuid>',
      'POST /api/admin/sponsorship-credit-notes/resend',
      'POST /api/admin/sponsorships/logo',
      'GET /api/admin/sponsorships/logo',
      'POST /api/admin/sponsorships/logo/delete',
      'POST /api/admin/sponsorships/refund',
      'GET /api/public/sponsor-logos/<file>',
      'GET /api/admin/contributions',
      'GET /api/admin/contributions.csv',
      'GET /api/admin/expenses',
      'GET /api/admin/transparency',
      'GET /api/admin/publication-drafts',
      'GET /api/admin/audit-log',
      '007_add_admin_audit_and_publication_drafts.sql',
      '010_create_email_messages.sql',
      '011_create_sponsorship_invoices.sql',
      '012_create_sponsorship_credit_notes.sql',
      '013_add_sponsorship_refund_status.sql',
      '014_add_sponsorship_refund_amount_reason.sql'
    ],
    'admin docs'
  );
});
