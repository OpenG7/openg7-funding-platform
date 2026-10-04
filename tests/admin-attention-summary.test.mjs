import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFinancialSummary,
  buildSummaryFromDataset
} from '../dist/apps/funding-api/src/admin-assistant/attention/summary.js';

const NOW = new Date('2026-11-01T01:15:00-04:00');
const dataset = (overrides = {}) => ({
  now: NOW,
  sponsorships: [],
  sponsorshipsTruncated: false,
  drafts: [],
  batches: [],
  slots: [],
  emailMessages: [],
  financialTotals: { grossPaid: 0, refunded: 0, disputed: 0, currency: 'CAD' },
  ...overrides
});

test('summary counts every detected failure before the default and explicit item caps', () => {
  const input = Object.freeze(
    dataset({
      sponsorshipsTruncated: true,
      emailMessages: Object.freeze(
        Array.from({ length: 150 }, (_unused, index) =>
          Object.freeze({
            id: `email-${index}`,
            template_key: 'sponsorship_invoice',
            recipient_email: 'synthetic.person@example.test',
            status: 'failed',
            attempts: 1,
            max_attempts: 3,
            last_error: null
          })
        )
      ),
      financialTotals: {
        grossPaid: 900,
        refunded: 120,
        disputed: 40,
        currency: 'USD'
      }
    })
  );
  const before = JSON.stringify(input);
  const summary = buildSummaryFromDataset(input);
  assert.equal(summary.generatedAt, '2026-11-01T05:15:00.000Z');
  assert.deepEqual(summary.counts, {
    urgent: 0,
    today: 151,
    thisWeek: 0,
    informational: 1
  });
  assert.equal(summary.emails.failed, 150);
  assert.equal(summary.attentionItems.length, 100);

  for (const cap of [-1, 0, 1, 500]) {
    const capped = buildSummaryFromDataset(input, cap);
    assert.deepEqual(capped.counts, summary.counts);
    assert.deepEqual(capped.emails, summary.emails);
    assert.deepEqual(capped.financialSummary, summary.financialSummary);
    assert.equal(
      capped.attentionItems.length,
      cap <= 0 ? 0 : cap === 1 ? 1 : 152
    );
    assert.ok(
      capped.attentionItems.every(
        (item) => item.detectedAt === summary.generatedAt
      )
    );
  }
  assert.equal(JSON.stringify(input), before);
  assert.ok(!JSON.stringify(summary).includes('synthetic.person'));
});

test('scheduled and approved counters retain their own domain criteria without attention items', () => {
  const sponsorship = (overrides = {}) => ({
    contributionId: 'synthetic-approved',
    publicReference: 'OG7-CMD-SYNTHETIC',
    amount: 25,
    currency: 'CAD',
    paymentStatus: 'paid',
    paidAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    reviewStatus: 'approved',
    refundStatus: 'not_requested',
    detailsSubmittedAt: '2026-10-29T00:00:00.000Z',
    hasCompanyName: true,
    hasContactEmail: true,
    hasWebsite: true,
    hasLogo: true,
    hasSupportingImage: true,
    feedStatus: 'not_planned',
    feedTarget: null,
    feedChannels: [],
    ...overrides
  });
  const summary = buildSummaryFromDataset(
    dataset({
      sponsorships: [
        sponsorship(),
        sponsorship({
          contributionId: 'synthetic-refunding',
          refundStatus: 'requested'
        }),
        sponsorship({
          contributionId: 'synthetic-refunded',
          paymentStatus: 'refunded'
        })
      ],
      slots: [
        {
          id: 'future-slot',
          status: 'scheduled',
          startsAt: '2026-11-02T05:00:00.000Z'
        },
        {
          id: 'cancelled-slot',
          status: 'cancelled',
          startsAt: '2026-10-30T05:00:00.000Z'
        }
      ],
      batches: [
        {
          id: 'future-batch',
          status: 'scheduled',
          scheduledAt: '2026-11-02T05:00:00.000Z'
        },
        {
          id: 'published-batch',
          status: 'published',
          scheduledAt: '2026-10-30T05:00:00.000Z'
        }
      ]
    }),
    0
  );
  assert.equal(summary.sponsorships.approved, 1);
  assert.deepEqual(summary.publications, {
    needsPreparation: 0,
    scheduled: 2,
    late: 0
  });
  assert.equal(summary.attentionItems.length, 0);
});

test('financial summary retains confirmed totals and reports unknown fees and net as null', () => {
  const input = dataset({
    financialTotals: {
      grossPaid: 900,
      refunded: 120,
      disputed: 40,
      currency: 'USD'
    },
    sponsorshipsTruncated: true
  });
  const financial = buildFinancialSummary(input);
  assert.equal(financial.grossPaid, 900);
  assert.equal(financial.refunded, 120);
  assert.equal(financial.currency, 'USD');
  assert.equal(financial.processingFees, null);
  assert.equal(financial.netReceived, null);
  assert.ok(
    financial.limitations.some((limitation) => limitation.includes('frais'))
  );
  assert.ok(
    financial.limitations.some((limitation) => limitation.includes('litige'))
  );
  assert.ok(
    financial.limitations.some((limitation) => limitation.includes('omises'))
  );

  const empty = buildFinancialSummary(dataset());
  assert.equal(empty.grossPaid, 0);
  assert.equal(empty.refunded, 0);
  assert.equal(empty.processingFees, null);
  assert.equal(empty.netReceived, null);
  assert.equal(empty.limitations.length, 2);
});
