import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeDraftChannels,
  resolveSponsorshipPublicationCoverage
} from '../dist/apps/funding-api/src/sponsorship-publication-coverage.js';
import {
  activeDraftChannels as attentionDraftChannels,
  detectPublicationPreparationItems
} from '../dist/apps/funding-api/src/admin-assistant/attention.service.js';
import { prepareDraftFromDataset } from '../dist/apps/funding-api/src/admin-assistant/preparation.service.js';
import { buildSponsorshipAssistantContext } from '../dist/apps/funding-api/src/admin-assistant/context.service.js';
import { createSponsorshipOfferSnapshot } from '../dist/packages/funding-core/src/index.js';

const contributionId = '10000000-0000-4000-8000-000000000001';
const otherContributionId = '10000000-0000-4000-8000-000000000002';
const recorded = (amount) => {
  if (amount < 50) return null;
  const offer = createSponsorshipOfferSnapshot(Math.round(amount * 100), 'CAD');
  return {
    id: 'synthetic-agreement',
    contributionId,
    offerId: 'synthetic-offer',
    provenance: 'qualified_historical',
    state: 'active',
    version: 1,
    qualificationReason: null,
    offer,
    obligations: offer.benefits.map((b) => ({
      id: b.id,
      commitmentId: 'synthetic-agreement',
      contributionId,
      benefitId: b.id,
      channel: b.channel,
      target: b.target,
      ordinal: 1,
      state: 'pending',
      version: 1,
      blockedReason: null,
      fulfilmentEvidenceId: null
    }))
  };
};

const draft = (channel, status, id = contributionId) =>
  Object.freeze({
    contribution_id: id,
    channel,
    feed_target: 'openg7',
    status
  });

test('active channels retain unpublished and published drafts while excluding rejected, cancelled and unrelated drafts', () => {
  for (const status of [
    'draft',
    'pending_review',
    'approved',
    'scheduled',
    'published'
  ]) {
    assert.deepEqual(
      [...activeDraftChannels([draft('facebook', status)], contributionId)],
      ['facebook'],
      status
    );
  }
  assert.deepEqual(
    [
      ...activeDraftChannels(
        [
          draft('facebook', 'rejected'),
          draft('linkedin', 'cancelled'),
          draft('facebook', 'approved', otherContributionId)
        ],
        contributionId
      )
    ],
    []
  );
});

test('coverage deduplicates active channels in insertion order and preserves channels outside the promised benefits', () => {
  const drafts = Object.freeze([
    draft('facebook', 'rejected'),
    draft('linkedin', 'published'),
    draft('facebook', 'approved', otherContributionId),
    draft('facebook', 'draft'),
    draft('linkedin', 'scheduled'),
    draft('facebook', 'approved')
  ]);
  assert.deepEqual(
    [...activeDraftChannels(drafts, contributionId)],
    ['linkedin', 'facebook']
  );
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(
      { contributionId, amount: 500, commitment: recorded(500) },
      drafts
    ),
    {
      promisedChannels: ['facebook', 'linkedin'],
      coveredChannels: ['linkedin', 'facebook'],
      missingChannels: []
    }
  );
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(
      { contributionId, amount: 250, commitment: recorded(250) },
      [draft('linkedin', 'draft')]
    ),
    {
      promisedChannels: ['facebook'],
      coveredChannels: ['linkedin'],
      missingChannels: ['facebook']
    }
  );
});

test('promised and missing channels follow the recorded synthetic agreements, without recomputing the financial amount', () => {
  for (const [amount, expected] of [
    [0, []],
    [249, []],
    [250, ['facebook']],
    [299, ['facebook']],
    [300, ['facebook']],
    [499, ['facebook']],
    [500, ['facebook', 'linkedin']]
  ]) {
    assert.deepEqual(
      resolveSponsorshipPublicationCoverage(
        { contributionId, amount: amount + 9999, commitment: recorded(amount) },
        []
      ),
      {
        promisedChannels: expected,
        coveredChannels: [],
        missingChannels: expected
      },
      `paid amount ${amount}`
    );
  }
});

test('attention preserves the active-channel export as the same function', () => {
  assert.equal(attentionDraftChannels, activeDraftChannels);
});

const sponsorship = (amount) =>
  Object.freeze({
    commitment: recorded(amount),
    contributionId,
    publicReference: 'OG7-CMD-DEMO',
    amount,
    currency: 'CAD',
    paymentStatus: 'paid',
    paidAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    detailsSubmittedAt: '2026-09-02T00:00:00.000Z',
    hasCompanyName: true,
    hasContactEmail: true,
    hasWebsite: false,
    hasLogo: false,
    hasSupportingImage: true,
    reviewStatus: 'approved',
    feedStatus: 'not_planned',
    feedTarget: null,
    feedChannels: [],
    refundStatus: 'not_requested'
  });

test('unknown historical amounts never promise channels and an old destination does not cover an adjusted obligation', () => {
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(
      { contributionId, commitment: null },
      []
    ),
    { promisedChannels: [], coveredChannels: [], missingChannels: [] }
  );
  const agreement = recorded(500);
  const adjusted = {
    ...agreement,
    obligations: agreement.obligations.map((o) =>
      o.channel === 'facebook' ? { ...o, target: 'openg20' } : o
    )
  };
  const coverage = resolveSponsorshipPublicationCoverage(
    { contributionId, commitment: adjusted },
    [draft('facebook', 'published'), draft('linkedin', 'approved')]
  );
  assert.deepEqual(coverage, {
    promisedChannels: ['facebook', 'linkedin'],
    coveredChannels: ['linkedin'],
    missingChannels: ['facebook']
  });
  const settled = {
    ...agreement,
    obligations: agreement.obligations.map((o) => ({
      ...o,
      state: 'fulfilled',
      fulfilmentEvidenceId: 'synthetic-proof'
    }))
  };
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(
      { contributionId, commitment: settled },
      []
    ).promisedChannels,
    []
  );
});

test('published drafts retain channel coverage and obligations without qualified evidence still require monitoring', () => {
  const record = sponsorship(300);
  for (const [status, coveredChannels, missingChannels, nextStep] of [
    ['draft', ['facebook'], [], 'monitor_publication'],
    ['pending_review', ['facebook'], [], 'monitor_publication'],
    ['approved', ['facebook'], [], 'monitor_publication'],
    ['scheduled', ['facebook'], [], 'monitor_publication'],
    ['published', ['facebook'], [], 'monitor_publication'],
    ['rejected', [], ['facebook'], 'prepare_publication'],
    ['cancelled', [], ['facebook'], 'prepare_publication']
  ]) {
    const dataset = { drafts: [draft('facebook', status)] };
    const coverage = resolveSponsorshipPublicationCoverage(
      record,
      dataset.drafts
    );
    assert.deepEqual(coverage.coveredChannels, coveredChannels, status);
    assert.deepEqual(coverage.missingChannels, missingChannels, status);
    const context = buildSponsorshipAssistantContext({
      record,
      dataset,
      recipient: null,
      consent: true,
      version: 'synthetic-version',
      media: [{ kind: 'supporting_image', reviewStatus: 'approved' }]
    });
    assert.deepEqual(context.coveredChannels, coveredChannels, status);
    assert.equal(context.nextStep, nextStep, status);
  }
});

test('uncovered promises do not bypass payment, refund or sponsorship review prerequisites', () => {
  for (const patch of [
    { paymentStatus: 'pending' },
    { paymentStatus: 'refunded' },
    { refundStatus: 'requested' },
    { reviewStatus: 'pending_review' },
    { reviewStatus: 'rejected' }
  ]) {
    const record = Object.freeze({ ...sponsorship(500), ...patch });
    const dataset = Object.freeze({
      now: new Date('2026-09-24T00:00:00.000Z'),
      sponsorships: [record],
      drafts: []
    });
    assert.deepEqual(
      resolveSponsorshipPublicationCoverage(record, dataset.drafts)
        .missingChannels,
      ['facebook', 'linkedin']
    );
    assert.deepEqual(detectPublicationPreparationItems(dataset), []);
    const proposal = prepareDraftFromDataset(dataset, {
      type: 'publication_draft',
      reference: record.publicReference
    });
    assert.equal(proposal.status, 'not_applicable');
    assert.equal(proposal.draft, null);
  }
});

test('attention, preparatory proposals and context agree on missing channels and distinguish monitoring from completion', () => {
  const cases = [
    {
      label: 'no draft covers either promise',
      drafts: [],
      covered: [],
      missing: ['facebook', 'linkedin'],
      nextStep: 'prepare_publication'
    },
    {
      label: 'a draft covers Facebook only',
      drafts: [draft('facebook', 'draft')],
      covered: ['facebook'],
      missing: ['linkedin'],
      nextStep: 'prepare_publication'
    },
    {
      label: 'scheduled and approved drafts cover both channels',
      drafts: [draft('linkedin', 'scheduled'), draft('facebook', 'approved')],
      covered: ['linkedin', 'facebook'],
      missing: [],
      nextStep: 'monitor_publication'
    },
    {
      label:
        'published drafts cover both channels but do not fulfil recorded obligations',
      drafts: [draft('facebook', 'published'), draft('linkedin', 'published')],
      covered: ['facebook', 'linkedin'],
      missing: [],
      nextStep: 'monitor_publication'
    },
    {
      label: 'rejected and cancelled drafts leave both promises uncovered',
      drafts: [draft('facebook', 'rejected'), draft('linkedin', 'cancelled')],
      covered: [],
      missing: ['facebook', 'linkedin'],
      nextStep: 'prepare_publication'
    },
    {
      label: 'another sponsorship cannot cover a promised channel',
      drafts: [draft('facebook', 'draft', otherContributionId)],
      covered: [],
      missing: ['facebook', 'linkedin'],
      nextStep: 'prepare_publication'
    },
    {
      label: 'repeated Facebook drafts leave only LinkedIn missing',
      drafts: [
        draft('facebook', 'draft'),
        draft('facebook', 'approved'),
        draft('linkedin', 'rejected')
      ],
      covered: ['facebook'],
      missing: ['linkedin'],
      nextStep: 'prepare_publication'
    },
    {
      label: 'an active channel outside the benefits does not cover Facebook',
      amount: 300,
      promised: ['facebook'],
      drafts: [draft('linkedin', 'draft')],
      covered: ['linkedin'],
      missing: ['facebook'],
      nextStep: 'prepare_publication'
    },
    {
      label: 'a payment without social benefits needs no publication proposal',
      amount: 249,
      promised: [],
      drafts: [],
      covered: [],
      missing: [],
      nextStep: 'monitor_publication'
    },
    {
      label:
        'qualified evidence completes each recorded obligation independently of published declarations',
      fulfilled: true,
      promised: [],
      drafts: [draft('facebook', 'published'), draft('linkedin', 'published')],
      covered: ['facebook', 'linkedin'],
      missing: [],
      nextStep: 'complete'
    }
  ];

  for (const scenario of cases) {
    const amount = scenario.amount ?? 500;
    const original = sponsorship(amount);
    const record = scenario.fulfilled
      ? {
          ...original,
          commitment: {
            ...original.commitment,
            obligations: original.commitment.obligations.map((o) => ({
              ...o,
              state: 'fulfilled',
              fulfilmentEvidenceId: `synthetic-qualified-${o.id}`
            }))
          }
        }
      : original;
    const dataset = Object.freeze({
      now: new Date('2026-09-24T00:00:00.000Z'),
      sponsorships: Object.freeze([record]),
      sponsorshipsTruncated: false,
      drafts: Object.freeze(scenario.drafts),
      batches: [],
      slots: [],
      emailMessages: [],
      financialTotals: {
        grossPaid: amount,
        refunded: 0,
        disputed: 0,
        currency: 'CAD'
      }
    });
    const before = JSON.stringify(dataset);
    const promised = scenario.promised ?? ['facebook', 'linkedin'];
    const attention = detectPublicationPreparationItems(dataset);
    assert.equal(
      attention.length,
      Number(scenario.missing.length > 0),
      scenario.label
    );

    const proposed = prepareDraftFromDataset(dataset, {
      type: 'publication_draft',
      reference: record.publicReference
    });
    if (scenario.missing.length) {
      assert.equal(
        attention[0].facts.promisedChannels,
        promised.join(', '),
        scenario.label
      );
      assert.equal(
        attention[0].facts.missingChannels,
        scenario.missing.join(', '),
        scenario.label
      );
      assert.equal(proposed.status, 'ok', scenario.label);
      assert.equal(
        proposed.draft.fields[0].value,
        scenario.missing.join(', '),
        scenario.label
      );
      assert.equal(proposed.draft.sent, false, scenario.label);
      assert.equal(proposed.draft.published, false, scenario.label);
      assert.equal(proposed.draft.persisted, false, scenario.label);
    } else {
      assert.equal(proposed.status, 'not_applicable', scenario.label);
      assert.equal(proposed.draft, null, scenario.label);
    }

    const context = buildSponsorshipAssistantContext({
      record,
      dataset,
      recipient: null,
      consent: true,
      version: 'synthetic-version',
      media: [{ kind: 'supporting_image', reviewStatus: 'approved' }]
    });
    assert.deepEqual(context.promisedChannels, promised, scenario.label);
    assert.deepEqual(context.coveredChannels, scenario.covered, scenario.label);
    assert.equal(context.nextStep, scenario.nextStep, scenario.label);
    assert.equal(JSON.stringify(dataset), before, scenario.label);
  }
});
