import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectLatePublicationItems,
  detectSponsorshipInfoItems,
  detectSponsorshipReviewItems
} from '../dist/apps/funding-api/src/admin-assistant/attention.service.js';
import { buildSponsorshipReviewReminderCandidate } from '../dist/apps/funding-api/src/admin-reminder.service.js';
import { sponsorshipFollowupState } from '../dist/apps/funding-api/src/sponsorship-interventions.service.js';

const NOW = new Date('2026-07-24T00:00:00.000Z');
const sponsorship = (overrides = {}) => ({
  contributionId: 'elapsed-days-demo',
  publicReference: 'OG7-CMD-ELAPSED',
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
const dataset = (overrides = {}) => ({
  now: NOW,
  sponsorships: [],
  slots: [],
  batches: [],
  ...overrides
});

test('attention preserves signed whole payment days while followup clamps a future payment to zero', () => {
  for (const [paidAt, signedDays] of [
    ['2026-07-22T20:00:00.000-04:00', 1],
    ['2026-07-23T00:00:00.001Z', 0],
    ['2026-07-24T00:00:00.001Z', -1],
    [null, null],
    ['', null],
    ['invalid-date', null]
  ]) {
    const record = sponsorship({ paidAt, detailsSubmittedAt: null });
    const items = detectSponsorshipInfoItems(
      dataset({ sponsorships: [record] })
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].facts.daysSincePaid, signedDays, String(paidAt));
    const followup = sponsorshipFollowupState(record, null, NOW);
    assert.equal(followup.state, 'waiting');
    assert.equal(
      followup.ageDays,
      signedDays === null ? null : Math.max(0, signedDays),
      String(paidAt)
    );
  }
});

test('review reminders wait for full elapsed days and ignore future or invalid submissions even with a zero threshold', () => {
  for (const [detailsSubmittedAt, daysWaiting] of [
    ['2026-07-22T20:00:00.000-04:00', 1],
    ['2026-07-23T00:00:00.001Z', 0],
    ['2026-07-24T00:00:00.001Z', -1],
    ['', null],
    ['invalid-date', null]
  ]) {
    const record = sponsorship({ detailsSubmittedAt });
    const attention = detectSponsorshipReviewItems(
      dataset({ sponsorships: [record] })
    );
    assert.equal(attention.length, 1);
    assert.equal(attention[0].facts.daysWaiting, daysWaiting);
    for (const minAgeDays of [0, 1]) {
      const candidate = buildSponsorshipReviewReminderCandidate([record], NOW, {
        minAgeDays,
        maxItems: 5
      });
      if (daysWaiting !== null && daysWaiting >= minAgeDays) {
        assert.equal(candidate?.items[0].daysWaiting, daysWaiting);
        assert.equal(candidate?.totalCount, 1);
      } else {
        assert.equal(candidate, null, `${detailsSubmittedAt}, ${minAgeDays}`);
      }
    }
  }
});

test('publication attention skips future and invalid schedules for both slots and batches', () => {
  for (const [scheduledAt, expectedDaysLate] of [
    ['2026-07-24T00:00:00.001Z', null],
    ['2026-07-24T00:00:00.000Z', 0],
    ['2026-07-23T00:00:00.001Z', 0],
    ['2026-07-22T20:00:00.000-04:00', 1],
    [null, null],
    ['invalid-date', null]
  ]) {
    const common = {
      channel: 'facebook',
      status: 'scheduled',
      capacity: 5,
      capacityUsed: 1
    };
    const items = detectLatePublicationItems(
      dataset({
        slots: [
          {
            ...common,
            id: 'slot-demo',
            feedTarget: 'openg7',
            startsAt: scheduledAt
          }
        ],
        batches: [{ ...common, id: 'batch-demo', scheduledAt }]
      })
    );
    assert.equal(items.length, expectedDaysLate === null ? 0 : 2);
    for (const item of items) {
      assert.equal(item.facts.daysLate, expectedDaysLate);
    }
  }
});

test('followup reminder thresholds use elapsed time rather than a calendar-date change', () => {
  for (const [paidAt, ageDays, state] of [
    ['2026-07-17T00:00:00.001Z', 6, 'waiting'],
    ['2026-07-17T00:00:00.000Z', 7, 'first_reminder'],
    ['2026-07-10T00:00:00.001Z', 13, 'first_reminder'],
    ['2026-07-10T00:00:00.000Z', 14, 'second_reminder'],
    ['2026-06-24T00:00:00.001Z', 29, 'second_reminder'],
    ['2026-06-24T00:00:00.000Z', 30, 'decision_required']
  ]) {
    assert.deepEqual(
      sponsorshipFollowupState(
        sponsorship({ paidAt, detailsSubmittedAt: null }),
        null,
        NOW
      ),
      { state, ageDays, nextReviewOn: null }
    );
  }
});
