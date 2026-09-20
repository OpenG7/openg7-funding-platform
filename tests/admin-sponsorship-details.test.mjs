import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAdminSponsorshipDetails } from '../dist/apps/funding-api/src/admin-sponsorship-details.service.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';

const request = {
  contributionId: '10000000-0000-4000-8000-000000000401',
  requestId: '10000000-0000-4000-8000-000000000402',
  expectedVersion: '2026-09-20 12:00:00+00',
  reason: 'correction',
  confirmed: true,
  companyName: ' Atelier démo ',
  publicName: '',
  contactName: '',
  contactEmail: ' demo@example.invalid ',
  websiteUrl: ' https://example.invalid/company '
};

test('dossier correction validates and normalizes only editable identity fields', () => {
  const parsed = parseAdminSponsorshipDetails(request);
  assert.equal(parsed.companyName, 'Atelier démo');
  assert.equal(parsed.contactEmail, 'demo@example.invalid');
  assert.equal(parsed.websiteUrl, 'https://example.invalid/company');
  assert.equal(parsed.publicName, '');
  assert.equal(parsed.contactName, '');
  assert.equal(
    parseAdminSponsorshipDetails({
      ...request,
      contactEmail: '',
      websiteUrl: ''
    }).contactEmail,
    ''
  );
  for (const invalid of [
    null,
    [],
    'invalid',
    {},
    { ...request, confirmed: false },
    { ...request, companyName: ' ' },
    { ...request, companyName: null },
    { ...request, contactName: 'a\nb' },
    { ...request, publicName: 'x'.repeat(101) },
    { ...request, companyName: 'x'.repeat(201) },
    { ...request, contactEmail: 'invalid' },
    { ...request, contactEmail: 'a@b.invalid\r\nBcc:x@y.invalid' },
    { ...request, websiteUrl: 'javascript:alert(1)' },
    { ...request, websiteUrl: 'https://user:password@example.invalid/' },
    { ...request, requestId: 'invalid' },
    { ...request, contributionId: 'invalid' },
    { ...request, expectedVersion: '' },
    { ...request, reason: 'unrecognized' },
    { ...request, amount: 1 },
    { ...request, public_display_consent: true },
    { ...request, sponsor_review_status: 'approved' },
    { ...request, stripe_payment_intent_id: 'pi_fake' }
  ])
    assert.throws(() => parseAdminSponsorshipDetails(invalid), { status: 400 });
});

test('identity correction is authorized for operators and owners, never readers', () => {
  for (const path of [
    '/admin/sponsorships/details',
    '/api/admin/sponsorships/details'
  ]) {
    assert.equal(adminRoleAllows('reader', 'POST', path), false);
    assert.equal(adminRoleAllows('operator', 'POST', path), true);
    assert.equal(adminRoleAllows('owner', 'POST', path), true);
    assert.equal(adminRoleAllows('operator', 'DELETE', path), false);
  }
});
