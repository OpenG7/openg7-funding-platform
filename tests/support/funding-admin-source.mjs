import { readFileSync } from 'node:fs';

// Keep source contracts attached to the facade, domain clients and session owner.
// Transport and session behavior are exercised by funding-admin-transport.test.mjs.
export const readFundingAdminSource = () => {
  const root = 'apps/funding-web/src/app/features/funding/services/';
  return [
    'funding-admin.service.ts',
    'funding-admin-session.ts',
    'funding-admin-sponsorships.client.ts',
    'funding-admin-publications.client.ts',
    'funding-admin-operations.client.ts',
    'funding-admin-diagnostics.client.ts',
    'funding-admin-documents.client.ts',
    'funding-admin-accounting.client.ts',
    'funding-admin-response.ts'
  ]
    .map((path) => readFileSync(root + path, 'utf8'))
    .join('\n');
};
