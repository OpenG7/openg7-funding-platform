import { readFileSync } from 'node:fs';

// Preserve historical source-contract checks across HTTP adapter extractions.
// Multipart, logo validation and rate limiting have direct behavior tests.
export const readFundingApiSource = () => {
  const root = 'apps/funding-api/src/';
  return [
    'main.ts',
    'admin-contributions.http.ts',
    'admin-documents.http.ts',
    'admin-accounting.http.ts',
    'admin-assistant.http.ts',
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
