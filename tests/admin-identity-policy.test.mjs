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
      '/admin/setup-status'
    ])
      assert.equal(adminRoleAllows(role, 'GET', path), false);
    for (const path of [
      '/admin/sponsorships/refund',
      '/admin/sponsorship-invoices/backfill',
      '/admin/new-action'
    ])
      assert.equal(adminRoleAllows(role, 'POST', path), false);
  }
  assert.equal(
    adminRoleAllows('owner', 'POST', '/admin/sponsorships/refund'),
    true
  );
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
