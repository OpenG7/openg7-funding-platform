import { readFileSync } from 'node:fs';

// Preserve historical source-contract checks across HTTP and helper extractions.
// Multipart, logo validation and rate limiting have direct behavior tests.
export const readFundingApiSource = () => {
  const root = 'apps/funding-api/src/';
  return [
    'main.ts',
    'api-runtime-config.ts',
    'admin-authorization.ts',
    'business-helpers/contribution-reference.ts',
    'business-helpers/sponsorship-followup.ts',
    'business-helpers/checkout.ts',
    'business-helpers/media-exposure.ts',
    'business-helpers/request-validation.ts',
    'business-helpers/http-errors.ts',
    'business-helpers/admin-setup.ts',
    'business-helpers/assistant-audit.ts',
    'business-helpers/development-results.ts',
    'api-background-workers.ts',
    'public-payments.http.ts',
    'public-references.http.ts',
    'legacy-sponsorship-details.http.ts',
    'stripe-webhook.http.ts',
    'admin-sponsorship-refund.http.ts',
    'admin-stripe-backfill.http.ts',
    'admin-contribution-activity.http.ts',
    'admin-session.http.ts',
    'admin-backups.http.ts',
    'admin-setup.http.ts',
    'admin-audit.http.ts',
    'admin-sponsorship-access.http.ts',
    'admin-contributions.http.ts',
    'admin-documents.http.ts',
    'admin-accounting.http.ts',
    'admin-assistant.http.ts',
    'admin-sponsorship-records.http.ts',
    'admin-sponsorship-decisions.http.ts',
    'admin-sponsorship-media.http.ts',
    'admin-pilotage.http.ts',
    'admin-publication-automation.http.ts',
    'public-funding.http.ts',
    'public-sponsor-media.http.ts',
    'sponsorship-followup.http.ts',
    'sponsorship-followup-media.http.ts',
    'admin-publication-drafts.http.ts',
    'admin-publication-slots.http.ts',
    'admin-publication-batches.http.ts',
    'admin-publication-http.shared.ts',
    'admin-email.http.ts',
    'admin-insights.http.ts',
    'http-routing.ts',
    'http-rate-limit.ts',
    'http-multipart.ts',
    'sponsor-logo-upload.ts'
  ]
    .map((path) => readFileSync(root + path, 'utf8'))
    .join('\n');
};
