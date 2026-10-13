import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferSnapshot,
  resolveSponsorshipBenefits
} from '../dist/packages/funding-core/src/index.js';

const pricing = {
  presetAmounts: [10.25, 20.75, 45.5],
  minimumAmount: 10.25,
  benefits: {
    websiteMention: { minimumAmount: 10.25 },
    facebookBatch: { minimumAmount: 20.75 },
    linkedinBatch: { minimumAmount: 45.5 }
  }
};

test('custom pricing preserves exact boundaries and the agreement between displayed benefits and offers', () => {
  const cases = [
    [1025, [['website_mention', 'website']]],
    [2074, [['website_mention', 'website']]],
    [
      2075,
      [
        ['website_mention', 'website'],
        ['facebook_batch', 'facebook']
      ]
    ],
    [
      4550,
      [
        ['website_mention', 'website'],
        ['facebook_batch', 'facebook'],
        ['linkedin_batch', 'linkedin']
      ]
    ]
  ];
  for (const [amountMinor, expected] of cases) {
    const offer = createSponsorshipOfferSnapshot(amountMinor, 'CAD', pricing);
    const displayed = resolveSponsorshipBenefits(amountMinor / 100, pricing);
    assert.deepEqual(
      offer.benefits.map(({ id, channel }) => [id, channel]),
      expected
    );
    assert.deepEqual(
      displayed.achievedBenefits,
      expected.map(([id]) => id)
    );
    assert.deepEqual(normalizeSponsorshipOfferSnapshot(offer), offer);
  }
  assert.deepEqual(
    resolveSponsorshipBenefits(10.25, pricing).upcomingBenefits,
    [
      { id: 'facebook_batch', minimumAmount: 20.75 },
      { id: 'linkedin_batch', minimumAmount: 45.5 }
    ]
  );
  assert.throws(() => createSponsorshipOfferSnapshot(1024, 'CAD', pricing));
});

test('an offer rejects an invalid later threshold even before that benefit is earned', () => {
  for (const minimumAmount of [-1, NaN, Infinity, 45.501]) {
    assert.throws(
      () =>
        createSponsorshipOfferSnapshot(1025, 'CAD', {
          ...pricing,
          benefits: {
            ...pricing.benefits,
            linkedinBatch: { minimumAmount }
          }
        }),
      { message: 'Invalid sponsorship pricing threshold.' }
    );
  }
});

test('recorded benefits reject mismatched channels and inherited object keys', () => {
  const offer = createSponsorshipOfferSnapshot(4550, 'CAD', pricing);
  for (const [index, channel] of [
    [0, 'facebook'],
    [1, 'linkedin'],
    [2, 'website']
  ]) {
    assert.throws(() =>
      normalizeSponsorshipOfferSnapshot({
        ...offer,
        benefits: [{ ...offer.benefits[index], channel }]
      })
    );
  }
  for (const id of ['__proto__', 'constructor', 'toString', 'unknown']) {
    assert.throws(() =>
      normalizeSponsorshipOfferSnapshot({
        ...offer,
        benefits: [{ ...offer.benefits[0], id }]
      })
    );
  }
});
