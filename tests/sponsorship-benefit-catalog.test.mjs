import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferFormats,
  publicationFormatCapability,
  publicSponsorshipObligations,
  resolveSponsorshipBenefits,
  resolveSponsorshipTierFromOffer
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

test('v4 cumulative benefits preserve separate collective and individual rights', () => {
  for (const [amountMinor, count, tier] of [
    [500, 3, 'collective'],
    [999, 3, 'collective'],
    [1000, 4, 'facebook_individual'],
    [1499, 4, 'facebook_individual'],
    [1500, 5, 'facebook_linkedin_individual']
  ]) {
    const offer = createSponsorshipOfferSnapshot(amountMinor, 'CAD');
    assert.equal(offer.version, 'sponsorship-v4');
    assert.equal(offer.benefits.length, count);
    assert.equal(resolveSponsorshipTierFromOffer(offer), tier);
    assert.equal(resolveSponsorshipBenefits(amountMinor / 100).tier, tier);
    assert.deepEqual(
      offer.benefits.map((benefit) => benefit.id),
      resolveSponsorshipBenefits(amountMinor / 100).achievedBenefits
    );
    for (const benefit of offer.benefits) {
      assert.equal(benefit.quantity, 1);
      assert.deepEqual(benefit.requiredElements, ['company_name']);
      if (benefit.id.endsWith('_batch')) {
        assert.equal(benefit.format, 'collective_text');
        assert.equal(benefit.minimumParticipants, 2);
      } else if (benefit.id.endsWith('_individual')) {
        assert.equal(benefit.format, 'individual_text');
        assert.equal(benefit.minimumParticipants, 1);
      } else {
        assert.equal(Object.hasOwn(benefit, 'minimumParticipants'), false);
      }
    }
    assert.deepEqual(normalizeSponsorshipOfferSnapshot(offer), offer);
  }
});

test('format options apply to only one eligible service without replacing its sibling', () => {
  const portrait = createSponsorshipOfferSnapshot(1500, 'CAD', undefined, {
    facebook: 'individual_portrait'
  });
  assert.equal(
    portrait.benefits.find((b) => b.id === 'facebook_batch').format,
    'collective_text'
  );
  assert.equal(
    portrait.benefits.find((b) => b.id === 'facebook_individual').format,
    'individual_portrait'
  );
  assert.deepEqual(
    portrait.benefits.find((b) => b.id === 'facebook_individual')
      .requiredElements,
    ['company_name', 'approved_presentation']
  );
  const composite = createSponsorshipOfferSnapshot(1500, 'CAD', undefined, {
    facebook: 'collective_composite',
    linkedin: 'image_collection'
  });
  assert.equal(
    composite.benefits.find((b) => b.id === 'facebook_batch').format,
    'collective_composite'
  );
  assert.equal(
    composite.benefits.find((b) => b.id === 'facebook_individual').format,
    'individual_text'
  );
  assert.equal(
    composite.benefits.find((b) => b.id === 'linkedin_batch').format,
    'image_collection'
  );
  assert.equal(
    composite.benefits.find((b) => b.id === 'linkedin_individual').format,
    'individual_text'
  );
  for (const [amountMinor, formats] of [
    [500, { facebook: 'individual_text' }],
    [999, { facebook: 'individual_portrait' }],
    [1000, { linkedin: 'individual_text' }],
    [1500, { facebook: 'image_collection' }]
  ])
    assert.throws(() =>
      createSponsorshipOfferSnapshot(amountMinor, 'CAD', undefined, formats)
    );
  assert.deepEqual(
    normalizeSponsorshipOfferFormats({ facebook: 'individual_text' }),
    { facebook: 'individual_text' }
  );
  assert.deepEqual(publicationFormatCapability('facebook', 'individual_text'), {
    available: true,
    requiresImage: false,
    requiresSingleSponsor: true,
    multiImage: false
  });
});

test('omitted individual thresholds disable those services in custom pricing', () => {
  const offer = createSponsorshipOfferSnapshot(50000, 'CAD', pricing);
  assert.deepEqual(
    offer.benefits.map((b) => b.id),
    ['website_mention', 'facebook_batch', 'linkedin_batch']
  );
  assert.throws(() =>
    createSponsorshipOfferSnapshot(50000, 'CAD', pricing, {
      facebook: 'individual_text'
    })
  );
  const extended = {
    ...pricing,
    benefits: {
      ...pricing.benefits,
      facebookIndividual: { minimumAmount: 75.25 },
      linkedinIndividual: { minimumAmount: 90.5 }
    }
  };
  for (const [amountMinor, count] of [
    [7524, 3],
    [7525, 4],
    [9049, 4],
    [9050, 5]
  ]) {
    assert.equal(
      createSponsorshipOfferSnapshot(amountMinor, 'CAD', extended).benefits
        .length,
      count
    );
  }
  for (const minimumAmount of [-1, NaN, Infinity, 75.251]) {
    assert.throws(() =>
      createSponsorshipOfferSnapshot(1025, 'CAD', {
        ...extended,
        benefits: {
          ...extended.benefits,
          facebookIndividual: { minimumAmount }
        }
      })
    );
  }
});

test('participant minimums reject impossible individual and collection obligations', () => {
  const offer = createSponsorshipOfferSnapshot(1500, 'CAD');
  const collective = offer.benefits.find((b) => b.id === 'facebook_batch');
  const individual = offer.benefits.find((b) => b.id === 'facebook_individual');
  for (const minimumParticipants of [0, -1, 1.5, 51, NaN, null]) {
    assert.throws(() =>
      normalizeSponsorshipOfferSnapshot({
        ...offer,
        benefits: [{ ...collective, minimumParticipants }]
      })
    );
  }
  for (const benefit of [
    { ...individual, minimumParticipants: 2 },
    { ...individual, format: 'collective_text' },
    { ...individual, format: undefined },
    { ...collective, format: 'individual_portrait', minimumParticipants: 2 },
    {
      ...collective,
      id: 'linkedin_batch',
      channel: 'linkedin',
      format: 'image_collection',
      minimumParticipants: 11
    }
  ])
    assert.throws(() =>
      normalizeSponsorshipOfferSnapshot({ ...offer, benefits: [benefit] })
    );
  const legacyPortrait = {
    ...collective,
    format: 'individual_portrait',
    minimumParticipants: 1
  };
  assert.deepEqual(
    normalizeSponsorshipOfferSnapshot({
      ...offer,
      version: 'sponsorship-v3',
      benefits: [legacyPortrait]
    }).benefits,
    [legacyPortrait]
  );
});

test('historical snapshots keep their tier and omit new participant metadata', () => {
  for (const version of [
    'sponsorship-v1',
    'sponsorship-v2',
    'sponsorship-v3',
    'historical-qualification-v1'
  ]) {
    const snapshot = {
      version,
      amountMinor: 50000,
      currency: 'CAD',
      benefits: createSponsorshipOfferSnapshot(
        50000,
        'CAD',
        pricing
      ).benefits.map(({ minimumParticipants: _minimum, ...benefit }) => benefit)
    };
    assert.equal(
      resolveSponsorshipTierFromOffer(snapshot),
      'website_facebook_linkedin'
    );
    const original = JSON.stringify(snapshot);
    assert.equal(
      JSON.stringify(normalizeSponsorshipOfferSnapshot(snapshot)),
      original
    );
    assert.equal(
      Object.hasOwn(
        normalizeSponsorshipOfferSnapshot(snapshot).benefits[1],
        'minimumParticipants'
      ),
      false
    );
  }
  assert.equal(resolveSponsorshipTierFromOffer(null), null);
  const obligations = [
    {
      id: 'old',
      channel: 'facebook',
      target: 'openg7',
      ordinal: 1,
      state: 'pending',
      format: 'collective_text',
      version: 1,
      fulfilmentEvidenceId: null,
      blockedReason: null
    },
    {
      id: 'single',
      channel: 'facebook',
      target: 'openg7',
      ordinal: 1,
      state: 'pending',
      format: 'individual_text',
      minimumParticipants: 1,
      version: 1,
      fulfilmentEvidenceId: null,
      blockedReason: null
    },
    {
      id: 'group',
      channel: 'facebook',
      target: 'openg7',
      ordinal: 1,
      state: 'pending',
      format: 'collective_text',
      minimumParticipants: 2,
      version: 1,
      fulfilmentEvidenceId: null,
      blockedReason: null
    }
  ];
  const projected = publicSponsorshipObligations(obligations);
  assert.equal(Object.hasOwn(projected[0], 'minimumParticipants'), false);
  assert.equal(Object.hasOwn(projected[1], 'minimumParticipants'), false);
  assert.equal(projected[2].minimumParticipants, 2);
});
