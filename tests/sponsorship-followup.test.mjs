import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  sameSponsorshipDetails,
  followupAccessExpired,
  SponsorshipFollowupError
} from '../dist/apps/funding-web/src/app/features/funding/models/sponsorship-followup-ui.js';

test('unchanged follow-up details ignore whitespace and empty optional fields without ignoring meaningful changes', () => {
  const saved = {
    companyName: 'Atelier',
    contactName: 'Camille',
    contactEmail: 'camille@example.test'
  };
  assert.equal(
    sameSponsorshipDetails(saved, {
      ...saved,
      companyName: ' Atelier ',
      websiteUrl: '',
      message: ' '
    }),
    true
  );
  assert.equal(
    sameSponsorshipDetails(saved, {
      ...saved,
      contactEmail: 'other@example.test'
    }),
    false
  );
  assert.equal(
    sameSponsorshipDetails(
      { ...saved, websiteUrl: 'https://example.test' },
      saved
    ),
    false
  );
});

test('access expiry is distinct from a transient service or network failure', () => {
  for (const status of [400, 401, 403, 404, 410])
    assert.equal(
      followupAccessExpired(new SponsorshipFollowupError(status)),
      true
    );
  for (const status of [409, 429, 500, 502, 503])
    assert.equal(
      followupAccessExpired(new SponsorshipFollowupError(status)),
      false
    );
  assert.equal(followupAccessExpired(new TypeError('Failed to fetch')), false);
});

test('follow-up French and English catalogs have matching nonempty messages', () => {
  const catalogs = ['fr-CA', 'en'].map(
    (locale) =>
      JSON.parse(
        readFileSync(
          'apps/funding-web/src/assets/i18n/' + locale + '.json',
          'utf8'
        )
      ).funding.followup
  );
  const flatten = (value, prefix = '') =>
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'string'
        ? [[prefix + key, entry]]
        : flatten(entry, prefix + key + '.')
    );
  const entries = catalogs.map((catalog) => flatten(catalog));
  assert.deepEqual(
    entries[0].map(([key]) => key).sort(),
    entries[1].map(([key]) => key).sort()
  );
  for (const messages of entries)
    for (const [key, value] of messages) assert.ok(value.trim(), key);
});
