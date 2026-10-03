import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminRoleAllows,
  safeAdminReturnPath,
  satisfiesMfa
} from '../dist/apps/funding-api/src/admin-identity.js';
import { operationsAlertConfig } from '../dist/apps/funding-api/src/operations-alerts.js';

test('administrative roles default to refusing mutations and reserve money and private exports for owners', () => {
  assert.equal(adminRoleAllows('reader', 'GET', '/api/admin/dashboard'), true);
  assert.equal(
    adminRoleAllows('reader', 'POST', '/api/admin/sponsorships/review'),
    false
  );
  assert.equal(adminRoleAllows('reader', 'POST', '/api/admin/search'), true);
  assert.equal(adminRoleAllows('operator', 'POST', '/api/admin/search'), true);
  assert.equal(
    adminRoleAllows('operator', 'POST', '/api/admin/sponsorships/review'),
    true
  );
  for (const role of ['reader', 'operator']) {
    for (const path of [
      '/admin/access',
      '/admin/contributions.csv',
      '/admin/setup-status',
      '/admin/email/test'
    ])
      assert.equal(adminRoleAllows(role, 'GET', path), false);
    for (const path of [
      '/admin/sponsorships/refund',
      '/admin/sponsorship-invoices/backfill',
      '/admin/publication-automation',
      '/api/admin/publication-automation',
      '/admin/new-action'
    ])
      assert.equal(adminRoleAllows(role, 'POST', path), false);
  }
  assert.equal(
    adminRoleAllows('owner', 'POST', '/api/admin/publication-automation'),
    true
  );
  assert.equal(
    adminRoleAllows('owner', 'POST', '/admin/sponsorships/refund'),
    true
  );
});

test('document and accounting routes preserve read, operator and owner permissions for both API aliases', () => {
  const roles = ['reader', 'operator', 'owner'];
  const routes = [
    ['GET', '/admin/sponsorship-invoices', roles],
    ['POST', '/admin/sponsorship-invoices/backfill', ['owner']],
    ['GET', '/admin/sponsorship-invoices/pdf', roles],
    ['POST', '/admin/sponsorship-invoices/resend', ['operator', 'owner']],
    ['GET', '/admin/sponsorship-credit-notes/pdf', roles],
    ['POST', '/admin/sponsorship-credit-notes/resend', ['operator', 'owner']],
    ['GET', '/admin/expenses', roles],
    ['POST', '/admin/expenses', ['owner']],
    ['POST', '/admin/expenses/update', ['owner']],
    ['GET', '/admin/transparency', roles]
  ];

  for (const prefix of ['', '/api']) {
    for (const [method, route, permittedRoles] of routes) {
      const path = `${prefix}${route}`;
      for (const role of roles) {
        assert.equal(
          adminRoleAllows(role, method, path),
          permittedRoles.includes(role),
          `${role} ${method} ${path}`
        );
      }
    }
  }
});

test('assistant and publication routes preserve consultation and operator permissions for both aliases', () => {
  const roles = ['reader', 'operator', 'owner'];
  const reads = [
    '/admin/assistant/context',
    '/admin/assistant/summary',
    '/admin/publication-drafts',
    '/admin/publication-slots',
    '/admin/publication-batches',
    '/admin/social-publication-jobs'
  ];
  const mutations = [
    '/admin/assistant/prepare',
    '/admin/publication-drafts',
    '/admin/publication-drafts/update',
    '/admin/publication-slots',
    '/admin/publication-slots/update',
    '/admin/publication-slots/assign-batch',
    '/admin/publication-slots/assign-draft',
    '/admin/publication-slots/publish',
    '/admin/publication-slots/cancel',
    '/admin/publication-batches',
    '/admin/publication-batches/assign',
    '/admin/publication-batches/unassign',
    '/admin/publication-batches/schedule',
    '/admin/publication-batches/publish',
    '/admin/publication-batches/cancel',
    '/admin/publication-batches/publish-social'
  ];
  for (const prefix of ['', '/api']) {
    for (const role of roles) {
      for (const route of reads)
        assert.equal(adminRoleAllows(role, 'GET', prefix + route), true);
      assert.equal(
        adminRoleAllows(role, 'POST', prefix + '/admin/assistant/query'),
        true
      );
      for (const route of mutations)
        assert.equal(
          adminRoleAllows(role, 'POST', prefix + route),
          role !== 'reader',
          `${role} ${prefix}${route}`
        );
    }
  }
});

test('sponsorship decision and media routes preserve admin reads and operator mutations for both aliases', () => {
  const roles = ['reader', 'operator', 'owner'];
  const routes = [
    ['POST', '/admin/sponsorships/review'],
    ['POST', '/admin/sponsorships/website-visibility'],
    ['POST', '/admin/sponsorships/publication'],
    ['GET', '/admin/sponsorships/media'],
    [
      'GET',
      '/admin/sponsorships/media/content/00000000-0000-4000-8000-000000000001'
    ],
    ['POST', '/admin/sponsorships/media/review'],
    ['POST', '/admin/sponsorships/media/delete'],
    ['GET', '/admin/sponsorships/logo'],
    ['POST', '/admin/sponsorships/logo/delete'],
    ['POST', '/admin/sponsorships/logo']
  ];

  for (const prefix of ['', '/api']) {
    for (const [method, route] of routes) {
      const path = prefix + route;
      for (const role of roles) {
        assert.equal(
          adminRoleAllows(role, method, path),
          method === 'GET' || role !== 'reader',
          `${role} ${method} ${path}`
        );
      }
    }
  }
});

test('MFA must be asserted in validated claims, never inferred from a password or arbitrary ACR', () => {
  assert.equal(satisfiesMfa({ amr: ['pwd'] }, []), false);
  assert.equal(satisfiesMfa({ acr: 'anything' }, ['urn:trusted:mfa']), false);
  assert.equal(satisfiesMfa({ amr: ['pwd', 'mfa'] }, []), true);
  assert.equal(
    satisfiesMfa({ acr: 'urn:trusted:mfa' }, ['urn:trusted:mfa']),
    true
  );
});
test('login redirects cannot escape the admin application', () => {
  for (const path of [
    'https://evil.test',
    '//evil.test',
    '/admin/fundraiser/../../../elsewhere',
    '/admin/fundraiser\\evil',
    '/admin/fundraiser-other'
  ])
    assert.equal(safeAdminReturnPath(path), '/admin/fundraiser');
  assert.equal(
    safeAdminReturnPath('/admin/fundraiser/sponsors?page=2'),
    '/admin/fundraiser/sponsors?page=2'
  );
});
test('webhook delivery remains disabled without explicit configuration and enforces secure production URLs', () => {
  assert.equal(operationsAlertConfig({}), null);
  assert.throws(() =>
    operationsAlertConfig({
      NODE_ENV: 'production',
      FUNDING_OPERATIONS_WEBHOOK_URL: 'http://localhost/hook',
      FUNDING_PUBLIC_BASE_URL: 'https://example.org',
      FUNDING_OPERATIONS_WEBHOOK_SECRET: 'x'.repeat(32)
    })
  );
});

test('operations configuration rejects unsafe admin links and hides malformed URL credentials', () => {
  const env = {
    NODE_ENV: 'production',
    FUNDING_OPERATIONS_WEBHOOK_URL: 'https://receiver.example.test/hook',
    FUNDING_PUBLIC_BASE_URL: 'https://funding.example.test/path?ignored=true',
    FUNDING_OPERATIONS_WEBHOOK_SECRET: 'synthetic-operations-secret-only-32'
  };
  assert.equal(
    operationsAlertConfig(env).adminOrigin,
    'https://funding.example.test'
  );
  for (const adminUrl of [
    'javascript:alert(1)',
    'ftp://example.test',
    'http://example.test',
    'https://user:private@example.test',
    'https://[private-token'
  ]) {
    assert.throws(
      () =>
        operationsAlertConfig({ ...env, FUNDING_PUBLIC_BASE_URL: adminUrl }),
      (error) => {
        assert.doesNotMatch(String(error.stack), /private|javascript|ftp:/);
        assert.equal(error.input, undefined);
        return true;
      }
    );
  }
  assert.throws(
    () =>
      operationsAlertConfig({
        ...env,
        FUNDING_OPERATIONS_WEBHOOK_URL: 'https://[private-token'
      }),
    (error) => {
      assert.doesNotMatch(String(error.stack), /private-token/);
      assert.equal(error.input, undefined);
      return true;
    }
  );
  assert.equal(
    operationsAlertConfig({
      ...env,
      NODE_ENV: 'test',
      FUNDING_PUBLIC_BASE_URL: 'http://127.0.0.1:8080',
      FUNDING_OPERATIONS_WEBHOOK_URL: 'http://[::1]:8081/hook'
    }).adminOrigin,
    'http://127.0.0.1:8080'
  );
});
