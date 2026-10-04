import assert from 'node:assert/strict';
import test from 'node:test';

import { detectFailedEmailItems } from '../dist/apps/funding-api/src/admin-assistant/attention/email.detectors.js';
import { detectFinancialWarningItems } from '../dist/apps/funding-api/src/admin-assistant/attention/financial.detectors.js';

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

const message = (overrides = {}) => ({
  id: 'email-synthetic',
  template_key: 'sponsorship_invoice',
  recipient_email: 'synthetic.person@example.test',
  status: 'failed',
  attempts: 2,
  max_attempts: 3,
  last_error: null,
  ...overrides
});

test('email alerts expose safe error categories while retaining the retry threshold', () => {
  const cases = [
    [null, 'inconnue'],
    [
      '535 AUTH failed; recipient rejected; network timeout',
      'authentification'
    ],
    ['550 mailbox rejected; network timeout', 'destinataire_rejeté'],
    ['ETIMEDOUT while connecting', 'connexion'],
    ['Provider diagnostic synthetic-only', 'autre']
  ];
  const input = dataset({
    emailMessages: cases.map(([last_error], index) =>
      Object.freeze(
        message({ id: `email-${index}`, last_error, attempts: index })
      )
    )
  });
  const before = JSON.stringify(input);
  const items = detectFailedEmailItems(input);

  assert.equal(items.length, cases.length);
  for (const [index, item] of items.entries()) {
    assert.equal(item.facts.errorCategory, cases[index][1]);
    assert.equal(item.facts.recipientDomain, 'example.test');
    assert.equal(item.facts.attemptsExhausted, index >= 3);
    assert.equal(item.severity, index >= 3 ? 'urgent' : 'today');
    assert.equal(item.detectedAt, '2026-11-01T05:15:00.000Z');
    assert.equal(item.adminUrl, '/admin/fundraiser/email-queue');
    assert.equal(item.suggestedActions[0].executionMode, 'navigate');
  }
  const serialized = JSON.stringify(items);
  assert.ok(!serialized.includes('synthetic.person'));
  for (const [raw] of cases) {
    if (raw) assert.ok(!serialized.includes(raw));
  }
  assert.equal(JSON.stringify(input), before);
});

test('emails in progress or already sent do not create failures or expose recipient data', () => {
  const items = detectFailedEmailItems(
    dataset({
      emailMessages: [
        ...['queued', 'sending', 'sent'].map((status) =>
          message({ status, attempts: 9 })
        ),
        message({
          id: 'missing-domain',
          recipient_email: 'synthetic-recipient'
        }),
        message({
          id: 'last-domain',
          recipient_email: 'synthetic@local@example.test'
        })
      ]
    })
  );
  assert.deepEqual(
    items.map((item) => item.emailQueueId),
    ['missing-domain', 'last-domain']
  );
  assert.deepEqual(
    items.map((item) => item.facts.recipientDomain),
    [null, 'example.test']
  );
  assert.ok(!JSON.stringify(items).includes('synthetic-recipient'));
  assert.ok(!JSON.stringify(items).includes('synthetic@local'));
});

test('disputed totals and source truncation create independent read-only warnings', () => {
  assert.deepEqual(detectFinancialWarningItems(dataset()), []);

  const disputed = detectFinancialWarningItems(
    dataset({
      financialTotals: {
        grossPaid: 900,
        refunded: 120,
        disputed: 40,
        currency: 'USD'
      }
    })
  );
  assert.equal(disputed.length, 1);
  assert.equal(disputed[0].id, 'financial_data_warning:disputed');
  assert.equal(disputed[0].severity, 'today');
  assert.deepEqual(disputed[0].facts, { disputedAmount: 40, currency: 'USD' });
  assert.equal(disputed[0].detectedAt, '2026-11-01T05:15:00.000Z');
  assert.equal(disputed[0].suggestedActions[0].executionMode, 'navigate');

  const truncated = detectFinancialWarningItems(
    dataset({ sponsorshipsTruncated: true })
  );
  assert.equal(truncated.length, 1);
  assert.equal(truncated[0].id, 'financial_data_warning:truncated');
  assert.equal(truncated[0].severity, 'informational');
  assert.equal(truncated[0].adminUrl, '/admin/fundraiser/sponsors');
  assert.deepEqual(truncated[0].suggestedActions, []);

  const combined = detectFinancialWarningItems(
    dataset({
      sponsorshipsTruncated: true,
      financialTotals: {
        grossPaid: 900,
        refunded: 120,
        disputed: 40,
        currency: 'USD'
      }
    })
  );
  assert.deepEqual(combined, [...disputed, ...truncated]);
});
