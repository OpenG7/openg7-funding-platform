import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectSponsorshipInfoItems,
  detectSponsorshipReviewItems
} from '../dist/apps/funding-api/src/admin-assistant/attention.service.js';

const NOW = new Date('2026-07-24T00:00:00.000Z');
const sponsorship = (overrides) => ({
  contributionId: 'attention-age-demo',
  publicReference: 'OG7-CMD-AGE',
  amount: 300,
  currency: 'CAD',
  paymentStatus: 'paid',
  paidAt: '2026-07-01T00:00:00.000Z',
  refundStatus: 'not_requested',
  reviewStatus: 'pending_review',
  detailsSubmittedAt: '2026-07-02T00:00:00.000Z',
  hasCompanyName: true,
  hasContactEmail: true,
  hasSupportingImage: true,
  ...overrides
});

test('information priority changes only after two and seven full elapsed payment days', () => {
  for (const [paidAt, severity] of [
    ['2026-07-22T00:00:00.001Z', 'this_week'],
    ['2026-07-22T00:00:00.000Z', 'today'],
    ['2026-07-17T00:00:00.001Z', 'today'],
    ['2026-07-17T00:00:00.000Z', 'urgent'],
    [null, 'this_week'],
    ['invalid-date', 'this_week']
  ]) {
    const [item] = detectSponsorshipInfoItems({
      now: NOW,
      sponsorships: [sponsorship({ paidAt, detailsSubmittedAt: null })]
    });
    assert.ok(item, String(paidAt));
    assert.equal(item.severity, severity, String(paidAt));
  }
});

test('review priority uses submission age and changes after three and seven full days', () => {
  for (const [detailsSubmittedAt, severity] of [
    ['2026-07-21T00:00:00.001Z', 'this_week'],
    ['2026-07-21T00:00:00.000Z', 'today'],
    ['2026-07-17T00:00:00.001Z', 'today'],
    ['2026-07-17T00:00:00.000Z', 'urgent'],
    ['invalid-date', 'this_week']
  ]) {
    const [item] = detectSponsorshipReviewItems({
      now: NOW,
      sponsorships: [sponsorship({ detailsSubmittedAt })]
    });
    assert.ok(item, detailsSubmittedAt);
    assert.equal(item.severity, severity, detailsSubmittedAt);
  }
});
