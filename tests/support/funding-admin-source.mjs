import { readFileSync } from 'node:fs';

// Keep source contracts attached to the facade and its browser session owner.
// Transport and session behavior are exercised by funding-admin-transport.test.mjs.
export const readFundingAdminSource = () => {
  const root = 'apps/funding-web/src/app/features/funding/services/';
  return ['funding-admin.service.ts', 'funding-admin-session.ts']
    .map((path) => readFileSync(root + path, 'utf8'))
    .join('\n');
};
