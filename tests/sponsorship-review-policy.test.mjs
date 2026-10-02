import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSummaryFromDataset,
  detectPublicationPreparationItems
} from '../dist/apps/funding-api/src/admin-assistant/attention.service.js';
import { prepareDraftFromDataset } from '../dist/apps/funding-api/src/admin-assistant/preparation.service.js';

const sponsorship = (overrides = {}) =>
  Object.freeze({
    contributionId: '10000000-0000-4000-8000-000000000001',
    publicReference: 'OG7-CMD-REVIEW-POLICY',
    amount: 500,
    currency: 'CAD',
    paymentStatus: 'paid',
    paidAt: '2026-09-01T00:00:00Z',
    refundStatus: 'not_requested',
    reviewStatus: 'approved',
    detailsSubmittedAt: '2026-09-02T00:00:00Z',
    hasCompanyName: true,
    hasContactEmail: true,
    hasSupportingImage: true,
    feedStatus: 'not_planned',
    ...overrides
  });
const dataset = (record, drafts = []) =>
  Object.freeze({
    now: new Date('2026-09-24T00:00:00Z'),
    sponsorships: Object.freeze([record]),
    sponsorshipsTruncated: false,
    drafts: Object.freeze(drafts),
    batches: [],
    slots: [],
    emailMessages: [],
    financialTotals: {
      grossPaid: 0,
      refunded: 0,
      disputed: 0,
      currency: 'CAD'
    }
  });

test('approved counts, publication attention and private preparation agree across payment, refund and review states', () => {
  const eligibleStates = new Set(['paid/not_requested/approved']);
  for (const paymentStatus of [
    'paid',
    'pending',
    'failed',
    'cancelled',
    'expired',
    'refunded',
    'disputed',
    'unknown'
  ]) {
    for (const refundStatus of [
      'not_requested',
      'requested',
      'processing',
      'completed',
      'failed',
      'unknown'
    ]) {
      for (const reviewStatus of [
        'approved',
        'pending_review',
        'rejected',
        'unknown'
      ]) {
        const label = `${paymentStatus}/${refundStatus}/${reviewStatus}`;
        const eligible = eligibleStates.has(label);
        const record = sponsorship({
          paymentStatus,
          refundStatus,
          reviewStatus
        });
        const ds = dataset(record);
        const before = JSON.stringify(ds);
        const attention = detectPublicationPreparationItems(ds);
        const summary = buildSummaryFromDataset(ds, 0);
        const prepared = prepareDraftFromDataset(ds, {
          type: 'publication_draft',
          reference: record.publicReference
        });
        assert.equal(attention.length, Number(eligible), label);
        assert.equal(summary.sponsorships.approved, Number(eligible), label);
        assert.equal(
          summary.publications.needsPreparation,
          Number(eligible),
          label
        );
        assert.equal(summary.attentionItems.length, 0, label);
        assert.equal(
          prepared.status,
          eligible ? 'ok' : 'not_applicable',
          label
        );
        if (eligible) {
          assert.equal(
            attention[0].facts.missingChannels,
            'facebook, linkedin'
          );
          assert.equal(prepared.draft.fields[0].value, 'facebook, linkedin');
          assert.equal(prepared.draft.sent, false);
          assert.equal(prepared.draft.published, false);
          assert.equal(prepared.draft.persisted, false);
        } else {
          assert.equal(prepared.draft, null, label);
        }
        assert.equal(JSON.stringify(ds), before, label);
      }
    }
  }
});

test('approved counts include sponsors with no missing social promise while preparation remains unnecessary', () => {
  const covered = sponsorship();
  for (const ds of [
    dataset(sponsorship({ amount: 249 })),
    dataset(covered, [
      Object.freeze({
        contribution_id: covered.contributionId,
        channel: 'facebook',
        status: 'approved'
      }),
      Object.freeze({
        contribution_id: covered.contributionId,
        channel: 'linkedin',
        status: 'published'
      })
    ])
  ]) {
    const before = JSON.stringify(ds);
    const summary = buildSummaryFromDataset(ds);
    const prepared = prepareDraftFromDataset(ds, {
      type: 'publication_draft',
      reference: ds.sponsorships[0].publicReference
    });
    assert.equal(summary.sponsorships.approved, 1);
    assert.equal(summary.publications.needsPreparation, 0);
    assert.equal(detectPublicationPreparationItems(ds).length, 0);
    assert.equal(prepared.status, 'not_applicable');
    assert.equal(prepared.draft, null);
    assert.equal(JSON.stringify(ds), before);
  }
});

test('private preparation preserves approval eligibility independently of incomplete information and hidden visibility', () => {
  const record = sponsorship({
    detailsSubmittedAt: null,
    hasCompanyName: false,
    hasContactEmail: false,
    hasSupportingImage: false,
    feedStatus: 'hidden'
  });
  const ds = dataset(record);
  const before = JSON.stringify(ds);
  const summary = buildSummaryFromDataset(ds);
  const prepared = prepareDraftFromDataset(ds, {
    type: 'publication_draft',
    reference: record.publicReference
  });
  assert.equal(summary.sponsorships.approved, 1);
  assert.equal(summary.sponsorships.needsInfo, 1);
  assert.equal(summary.publications.needsPreparation, 1);
  assert.equal(prepared.status, 'ok');
  assert.equal(prepared.draft.sent, false);
  assert.equal(prepared.draft.published, false);
  assert.equal(prepared.draft.persisted, false);
  assert.equal(JSON.stringify(ds), before);
});
