import assert from 'node:assert/strict';
import test from 'node:test';

import { adminFinancialCapabilities } from '../dist/apps/funding-web/src/app/features/funding/services/admin-financial-capabilities.js';

const now = Date.parse('2026-10-18T12:00:00Z');
const cookie = 'openg7-admin-session.cookie';
const profile = (role) => ({
  role,
  expiresAt: '2026-10-18T12:30:00Z'
});
const denied = {
  canBackfillInvoices: false,
  canManageExpenses: false,
  canResendDocuments: false
};

test('financial presentation follows the exact owner and operator policies with a restored identity', () => {
  assert.deepEqual(
    adminFinancialCapabilities(profile('reader'), cookie, now),
    denied
  );
  assert.deepEqual(
    adminFinancialCapabilities(profile('operator'), cookie, now),
    {
      ...denied,
      canResendDocuments: true
    }
  );
  assert.deepEqual(adminFinancialCapabilities(profile('owner'), cookie, now), {
    canBackfillInvoices: true,
    canManageExpenses: true,
    canResendDocuments: true
  });
});

test('missing identity, absent session and expired OIDC identity grant no financial mutation', () => {
  for (const session of [
    '',
    cookie,
    'untrusted-root-token',
    'openg7-admin-session.'
  ]) {
    assert.deepEqual(adminFinancialCapabilities(null, session, now), denied);
  }
  assert.deepEqual(
    adminFinancialCapabilities(profile('owner'), '', now),
    denied
  );
  assert.deepEqual(
    adminFinancialCapabilities(
      {
        ...profile('owner'),
        expiresAt: '2026-10-18T11:59:59Z'
      },
      cookie,
      now
    ),
    denied
  );
  assert.deepEqual(
    adminFinancialCapabilities(
      {
        ...profile('owner'),
        expiresAt: 'invalid'
      },
      cookie,
      now
    ),
    denied
  );
});

test('an identity-less local session uses the validated transport session, never the cookie marker', () => {
  // A synthetic saved session stands in for the bounded exchange. Signature
  // verification belongs to the API; getSavedAdminToken checks stored expiry.
  const session = 'openg7-admin-session.synthetic-session';
  assert.deepEqual(adminFinancialCapabilities(null, session, now), {
    canBackfillInvoices: true,
    canManageExpenses: true,
    canResendDocuments: true
  });
  assert.deepEqual(
    adminFinancialCapabilities(profile('reader'), session, now),
    denied
  );
});
