import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSponsorshipAssistantContext } from '../dist/apps/funding-api/src/admin-assistant/context.service.js';
import { buildSponsorshipProgress } from '../dist/apps/funding-api/src/sponsorship-progress.service.js';

const record = Object.freeze({
  contributionId: '10000000-0000-4000-8000-000000000001',
  publicReference: 'OG7-CMD-MEDIA-DEMO',
  amount: 500,
  currency: 'CAD',
  paymentStatus: 'paid',
  refundStatus: 'not_requested',
  reviewStatus: 'approved',
  feedStatus: 'not_planned',
  detailsSubmittedAt: '2026-09-01',
  hasCompanyName: true,
  hasContactEmail: true,
  hasSupportingImage: true
});

const facts = {
  websiteVisible: false,
  websiteHeld: true,
  websiteVersion: 'synthetic-version',
  companyName: 'Fixture company',
  amountMinor: 50000,
  refundId: null,
  refundAmountMinor: null,
  refundError: false,
  requiresInvoice: false,
  documents: [],
  publications: [],
  refunds: [],
  charges: [],
  failedEmails: [],
  failedStripeEvents: []
};

const scenarios = [
  {
    label: 'empty media collection',
    assets: [],
    counts: [0, 0, 0, 0],
    state: 'blocked',
    imageApproved: false
  },
  {
    label: 'approved logo alone cannot replace a presentation photo',
    assets: [['logo', 'approved']],
    counts: [1, 1, 0, 0],
    state: 'blocked',
    imageApproved: false
  },
  {
    label: 'pending presentation photo needs review',
    assets: [['supporting_image', 'pending_review']],
    counts: [1, 0, 1, 0],
    state: 'pending',
    imageApproved: false
  },
  {
    label: 'rejected presentation photo stays blocked',
    assets: [['supporting_image', 'rejected']],
    counts: [1, 0, 0, 1],
    state: 'blocked',
    imageApproved: false
  },
  {
    label: 'approved presentation photo completes media review',
    assets: [['supporting_image', 'approved']],
    counts: [1, 1, 0, 0],
    state: 'complete',
    imageApproved: true
  },
  {
    label:
      'pending logo delays media completion while an approved photo satisfies publication media prerequisites',
    assets: [
      ['supporting_image', 'approved'],
      ['logo', 'pending_review']
    ],
    counts: [2, 1, 1, 0],
    state: 'pending',
    imageApproved: true
  },
  {
    label: 'rejected logo does not invalidate an approved presentation photo',
    assets: [
      ['supporting_image', 'approved'],
      ['logo', 'rejected']
    ],
    counts: [2, 1, 0, 1],
    state: 'complete',
    imageApproved: true
  },
  {
    label: 'an additional pending photo keeps the review open',
    assets: [
      ['supporting_image', 'approved'],
      ['supporting_image', 'pending_review']
    ],
    counts: [2, 1, 1, 0],
    state: 'pending',
    imageApproved: true
  }
];

test('assistant context and dossier progress share media facts while keeping review completion separate from publication eligibility', () => {
  for (const scenario of scenarios) {
    const source = Object.freeze({
      record,
      dataset: { drafts: [] },
      media: Object.freeze(
        scenario.assets.map(([kind, reviewStatus]) =>
          Object.freeze({
            kind,
            reviewStatus,
            originalFilename: 'private-fixture-filename.png'
          })
        )
      ),
      consent: true,
      recipient: null,
      version: 'synthetic-version'
    });
    const before = JSON.stringify(source);
    const context = buildSponsorshipAssistantContext(source);
    const [total, approved, pending, rejected] = scenario.counts;
    assert.deepEqual(
      context.media,
      { total, approved, pending, rejected },
      scenario.label
    );
    assert.equal(
      context.nextStep,
      scenario.state === 'complete' ? 'prepare_publication' : 'review_media',
      scenario.label
    );
    assert.doesNotMatch(JSON.stringify(context), /private-fixture-filename/);

    const progress = buildSponsorshipProgress(source, facts);
    assert.equal(
      progress.milestones.find((milestone) => milestone.id === 'media').state,
      scenario.state,
      scenario.label
    );
    assert.equal(
      progress.publicEligible,
      scenario.imageApproved,
      scenario.label
    );
    assert.equal(
      progress.publicationBlockers.includes('media'),
      !scenario.imageApproved,
      scenario.label
    );
    assert.equal(
      progress.website.blockers.includes('media'),
      !scenario.imageApproved,
      scenario.label
    );
    assert.equal(
      progress.website.canPublish,
      scenario.imageApproved,
      scenario.label
    );
    assert.equal(JSON.stringify(source), before, scenario.label);
  }
});
