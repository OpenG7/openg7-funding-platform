import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeRecoveryEmail,
  validateSponsorshipDraft
} from '../dist/apps/funding-api/src/sponsorship-access.service.js';

test('drafts accept incomplete text while rejecting malformed or oversized private payloads', () => {
  const value = {
    companyName: '',
    contactName: '',
    contactEmail: 'unfinished@',
    websiteUrl: 'https:/',
    logoUrl: '',
    message: 'Work in progress'
  };
  assert.deepEqual(validateSponsorshipDraft(value), value);
  assert.equal(validateSponsorshipDraft(null), null);
  for (const invalid of [
    [],
    {},
    undefined,
    { ...value, publicDisplayConsent: true },
    { ...value, message: 'a'.repeat(1001) },
    { ...value, companyName: '\0' }
  ])
    assert.throws(
      () => validateSponsorshipDraft(invalid),
      (e) => e.status === 400
    );
  assert.equal(
    normalizeRecoveryEmail(' Payer@Example.Invalid '),
    'payer@example.invalid'
  );
  for (const invalid of ['', null, 'no-address', 'two\n@example.invalid'])
    assert.throws(() => normalizeRecoveryEmail(invalid));
});
