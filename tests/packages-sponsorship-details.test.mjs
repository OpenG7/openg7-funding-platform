import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAdminSponsorshipDetails,
  isSponsorshipEmail,
  isSponsorshipHttpsUrl
} from '../dist/packages/funding-core/src/index.js';

const details = {
  companyName: "Équipe O'Brian — 建設",
  publicName: '',
  contactName: '',
  contactEmail: '',
  websiteUrl: ''
};

test('admin corrections preserve international identity and optional blank fields', () => {
  assert.deepEqual(validateAdminSponsorshipDetails(details), {});
  assert.deepEqual(
    validateAdminSponsorshipDetails({ ...details, companyName: '  ' }),
    { companyName: 'required' }
  );
  assert.deepEqual(
    validateAdminSponsorshipDetails({ ...details, contactName: null }),
    { contactName: 'invalid' }
  );
});

test('all editable admin identity fields reject control characters before email and URL parsing', () => {
  for (const field of Object.keys(details)) {
    for (const control of ['\0', '\t', '\n', '\r', '\x1f', '\x7f']) {
      assert.deepEqual(
        validateAdminSponsorshipDetails({
          ...details,
          [field]: `company${control}@example.test`
        }),
        { [field]: 'invalid' },
        `${field}: control ${control.charCodeAt(0)}`
      );
    }
  }
});

test('admin identity length limits remain field specific', () => {
  const websitePrefix = 'https://example.test/';
  for (const [field, value] of [
    ['companyName', 'x'.repeat(200)],
    ['publicName', 'x'.repeat(100)],
    ['contactName', 'x'.repeat(200)],
    ['contactEmail', `${'x'.repeat(187)}@example.test`],
    ['websiteUrl', websitePrefix + 'x'.repeat(2048 - websitePrefix.length)]
  ]) {
    assert.deepEqual(
      validateAdminSponsorshipDetails({ ...details, [field]: value }),
      {}
    );
    assert.deepEqual(
      validateAdminSponsorshipDetails({
        ...details,
        [field]: `${value}x`
      }),
      { [field]: 'invalid' }
    );
  }
});

test('admin contact corrections keep their existing email and HTTP policies distinct from public follow-up', () => {
  const contactEmail = 'a..b@example.test';
  const websiteUrl = 'http://example.test/company';
  assert.equal(isSponsorshipEmail(contactEmail), false);
  assert.equal(isSponsorshipHttpsUrl(websiteUrl), false);
  assert.deepEqual(
    validateAdminSponsorshipDetails({ ...details, contactEmail, websiteUrl }),
    {}
  );
  assert.deepEqual(
    validateAdminSponsorshipDetails({
      ...details,
      websiteUrl: 'https://user:password@example.test/'
    }),
    { websiteUrl: 'invalid' }
  );
});
