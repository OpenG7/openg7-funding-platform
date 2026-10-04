import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAccountingSeedFragments } from '../scripts/lib/e2e-seed/accounting.mjs';
import {
  ACCOUNTING_FIXTURES,
  BACKFILL_FIXTURES,
  EMAIL_QUEUE_FIXTURE,
  WEBHOOK_FIXTURES
} from './playwright/fixtures/e2e-fixtures.mjs';

const inputs = {
  webhookFixtures: WEBHOOK_FIXTURES,
  accountingFixtures: ACCOUNTING_FIXTURES,
  backfillFixtures: BACKFILL_FIXTURES,
  emailQueueFixture: EMAIL_QUEUE_FIXTURE
};
const literals = (sql) =>
  [...sql.matchAll(/'((?:[^']|'')*)'/g)].map((match) =>
    match[1].replace(/''/g, "'")
  );
const contributionInserts = (sql) =>
  sql.split(/(?=\nINSERT INTO fund_contributions)/).filter(Boolean);
const insertColumns = (sql) =>
  sql
    .match(/INSERT INTO \w+ \(([\s\S]*?)\)\s*VALUES/)[1]
    .split(',')
    .map((column) => column.trim());

test('webhook and accounting seed only pending rows the webhook must update', () => {
  const fragments = buildAccountingSeedFragments(inputs);
  const webhookRows = contributionInserts(fragments.webhookFixtureInserts);
  assert.deepEqual(
    webhookRows.map((row) => literals(row)),
    [
      WEBHOOK_FIXTURES.idempotence,
      WEBHOOK_FIXTURES.checkoutAuthoritative,
      WEBHOOK_FIXTURES.feeBackfill,
      WEBHOOK_FIXTURES.outOfOrder
    ].map((fixture) => [
      'personal_support',
      'cad',
      'pending',
      fixture.contactEmail,
      fixture.publicReference,
      fixture.stripePaymentIntentId
    ])
  );
  assert.deepEqual(
    webhookRows.map((row) => Number(row.match(/'personal_support', (\d+)/)[1])),
    [5000, 2500, 8000, 6000]
  );

  const accountingRows = contributionInserts(
    fragments.accountingPendingInserts
  );
  assert.deepEqual(
    accountingRows.map((row) => literals(row)),
    [
      ACCOUNTING_FIXTURES.scenario,
      ACCOUNTING_FIXTURES.excludedFailed,
      ACCOUNTING_FIXTURES.fullyRefunded
    ].map((fixture) => [
      'personal_support',
      'cad',
      'pending',
      fixture.contactEmail,
      fixture.publicReference,
      fixture.stripePaymentIntentId
    ])
  );
  assert.deepEqual(
    accountingRows.map((row) =>
      Number(row.match(/'personal_support', (\d+)/)[1])
    ),
    [10000, 4000, 6000]
  );
  for (const insert of [...webhookRows, ...accountingRows]) {
    assert.match(insert, /TRUE, TRUE, TRUE/);
  }
  const inserts = webhookRows.concat(accountingRows).join('\n');
  assert.equal(
    inserts.includes(WEBHOOK_FIXTURES.replaySponsorship.publicReference),
    false
  );
  assert.equal(
    inserts.includes(ACCOUNTING_FIXTURES.excludedExpired.publicReference),
    false
  );
  assert.equal(
    inserts.includes(BACKFILL_FIXTURES.matchedSession.publicReference),
    false
  );
  assert.equal(
    inserts.includes(BACKFILL_FIXTURES.sponsorshipSession.publicReference),
    false
  );
  assert.equal('accountingExpiredInsert' in fragments, false);
});

test('cleanup includes every delivered webhook/accounting event in original order', () => {
  const fragments = buildAccountingSeedFragments(inputs);
  const expectedEventIds = [
    'evt_e2e_playwright_fixture_webhook_idempotence',
    'evt_e2e_playwright_fixture_webhook_checkout_auth',
    'evt_e2e_playwright_fixture_webhook_fee_succeeded',
    'evt_e2e_playwright_fixture_webhook_fee_updated',
    'evt_e2e_playwright_fixture_webhook_order_succeeded',
    'evt_e2e_playwright_fixture_webhook_order_updated',
    'evt_e2e_playwright_fixture_webhook_replay_a',
    'evt_e2e_playwright_fixture_webhook_replay_b',
    'evt_e2e_playwright_fixture_accounting_succeeded',
    'evt_e2e_playwright_fixture_accounting_refunded',
    'evt_e2e_playwright_fixture_accounting_failed',
    'evt_e2e_playwright_fixture_accounting_expired',
    'evt_e2e_playwright_fixture_accounting_full_refund_a',
    'evt_e2e_playwright_fixture_accounting_full_refund_b'
  ];
  assert.deepEqual(literals(fragments.stripeEventsDelete), expectedEventIds);
  assert.deepEqual(
    literals(fragments.fundTransactionsByEventDelete),
    expectedEventIds
  );
});

test('backfill cleanup lists objects, sessions and contribution references separately', () => {
  const fragments = buildAccountingSeedFragments(inputs);
  assert.deepEqual(literals(fragments.fundTransactionsByObjectDelete), [
    'pi_e2e_playwright_fixture_backfill_matched',
    'pi_e2e_playwright_fixture_backfill_unmatched',
    'pi_e2e_playwright_fixture_backfill_sponsor'
  ]);
  assert.deepEqual(literals(fragments.stripeCheckoutSessionsDelete), [
    'cs_e2e_playwright_fixture_backfill_matched',
    'cs_e2e_playwright_fixture_backfill_unmatched',
    'cs_e2e_playwright_fixture_backfill_sponsor',
    'cs_e2e_playwright_fixture_webhook_replay',
    'cs_e2e_playwright_fixture_accounting_expired'
  ]);
  assert.deepEqual(literals(fragments.backfillContributionsDelete), [
    'OG7-2026-BKFILL1',
    'OG7-2026-BKFILL2'
  ]);
});

test('publication ownership covers cleanup-only rows without inventing a backfill contact', () => {
  const { publicationFixtures } = buildAccountingSeedFragments(inputs);
  assert.deepEqual(publicationFixtures, [
    WEBHOOK_FIXTURES.idempotence,
    WEBHOOK_FIXTURES.checkoutAuthoritative,
    WEBHOOK_FIXTURES.feeBackfill,
    WEBHOOK_FIXTURES.outOfOrder,
    WEBHOOK_FIXTURES.replaySponsorship,
    ACCOUNTING_FIXTURES.scenario,
    ACCOUNTING_FIXTURES.excludedFailed,
    ACCOUNTING_FIXTURES.fullyRefunded,
    ACCOUNTING_FIXTURES.excludedExpired,
    { publicReference: 'OG7-2026-BKFILL1' },
    { publicReference: 'OG7-2026-BKFILL2' }
  ]);
});

test('queue remains deferred, expense values and the permanent sentinel stay unchanged', () => {
  const fragments = buildAccountingSeedFragments(inputs);
  assert.deepEqual(literals(fragments.emailQueueInsert), [
    EMAIL_QUEUE_FIXTURE.idempotencyKey,
    EMAIL_QUEUE_FIXTURE.templateKey,
    EMAIL_QUEUE_FIXTURE.recipientEmail,
    EMAIL_QUEUE_FIXTURE.fromEmail,
    EMAIL_QUEUE_FIXTURE.subject,
    EMAIL_QUEUE_FIXTURE.textBody,
    EMAIL_QUEUE_FIXTURE.htmlBody,
    'queued',
    '1 day'
  ]);
  assert.match(fragments.emailQueueInsert, /NOW\(\) \+ INTERVAL '1 day'/);
  assert.deepEqual(insertColumns(fragments.accountingExpenseInsert), [
    'project_name',
    'public_description',
    'amount_allocated',
    'currency',
    'status',
    'published_at'
  ]);
  assert.deepEqual(literals(fragments.accountingExpenseInsert), [
    'E2E Playwright Fixture Accounting Expense',
    'E2E Playwright: depense de test pour le scenario comptable.',
    'cad',
    'published'
  ]);
  assert.equal(
    Number(
      fragments.accountingExpenseInsert.match(
        /,\n  (\d+), 'cad', 'published', NOW\(\)/
      )[1]
    ),
    1500
  );
  assert.deepEqual(insertColumns(fragments.ledgerSentinelInsert), [
    'stripe_event_id',
    'stripe_object_id',
    'stripe_balance_transaction_id',
    'type',
    'amount',
    'fee',
    'net',
    'currency',
    'status',
    'created_at',
    'public_category',
    'metadata_json'
  ]);
  const sentinelValues = literals(fragments.ledgerSentinelInsert);
  assert.deepEqual(sentinelValues.slice(0, 6), [
    'e2e-playwright-ledger-sentinel',
    'e2e-playwright-ledger-sentinel-charge',
    'charge.refunded',
    'cad',
    'succeeded',
    'refund'
  ]);
  assert.deepEqual(JSON.parse(sentinelValues[6]), {
    source: 'e2e-playwright-ledger-sentinel'
  });
  assert.deepEqual(
    fragments.ledgerSentinelInsert
      .match(
        /'charge.refunded', (\d+), (\d+), (\d+), 'cad', 'succeeded', NOW\(\)/
      )
      .slice(1)
      .map(Number),
    [1, 0, 1]
  );
  assert.match(
    fragments.ledgerSentinelInsert,
    /'e2e-playwright-ledger-sentinel-charge', NULL/
  );
  assert.match(
    fragments.ledgerSentinelInsert,
    /ON CONFLICT \(stripe_event_id\) DO NOTHING;$/
  );
});

test('all cleanup statements select only exact fixture identities, preserving unrelated records', () => {
  const fragments = buildAccountingSeedFragments(inputs);
  for (const [name, table, column] of [
    ['emailQueueDelete', 'email_messages', 'idempotency_key'],
    ['accountingExpenseDelete', 'fund_allocations', 'project_name'],
    ['fundTransactionsByEventDelete', 'fund_transactions', 'stripe_event_id'],
    ['fundTransactionsByObjectDelete', 'fund_transactions', 'stripe_object_id'],
    ['stripeEventsDelete', 'stripe_events', 'stripe_event_id'],
    [
      'stripeCheckoutSessionsDelete',
      'stripe_checkout_sessions',
      'stripe_session_id'
    ],
    ['backfillContributionsDelete', 'fund_contributions', 'public_reference']
  ]) {
    assert.match(
      fragments[name],
      new RegExp(
        `^\\nDELETE FROM ${table}\\nWHERE ${column} (?:= '(?:[^']|'')*'|IN \\('(?:[^']|'')*'(?:, '(?:[^']|'')*')*\\));$`
      )
    );
  }
  for (const [name, fixtures] of [
    ['webhookFixtureDeletes', Object.values(WEBHOOK_FIXTURES)],
    [
      'accountingPendingDeletes',
      [
        ACCOUNTING_FIXTURES.scenario,
        ACCOUNTING_FIXTURES.excludedFailed,
        ACCOUNTING_FIXTURES.fullyRefunded
      ]
    ],
    ['accountingExpiredDelete', [ACCOUNTING_FIXTURES.excludedExpired]]
  ]) {
    const statements = fragments[name].trim().split(';').filter(Boolean);
    assert.equal(statements.length, fixtures.length);
    for (const [index, sql] of statements.entries()) {
      assert.match(
        sql.trim(),
        /^DELETE FROM fund_contributions\nWHERE sponsor_contact_email = '(?:[^']|'')*'\n   OR public_reference = '(?:[^']|'')*'$/
      );
      assert.deepEqual(literals(sql), [
        fixtures[index].contactEmail,
        fixtures[index].publicReference
      ]);
    }
  }
  const deletes = Object.entries(fragments)
    .filter(([name]) => /Delete(s)?$/.test(name))
    .map(([, sql]) => sql);
  for (const sql of deletes) {
    for (const foreignIdentity of [
      'e2e-playwright-ledger-sentinel',
      'e2e-playwright-ledger-sentinel-charge',
      'OG7-E2E-FOREIGN-CONTRIBUTION',
      'evt_e2e_foreign',
      'pi_e2e_foreign',
      'cs_e2e_foreign',
      'foreign@example.invalid'
    ]) {
      assert.equal(literals(sql).includes(foreignIdentity), false);
    }
  }
});

test('injected fixtures escape every string and preserve nullable payment intent values', () => {
  const quoted = {
    ...inputs,
    webhookFixtures: {
      ...WEBHOOK_FIXTURES,
      idempotence: {
        ...WEBHOOK_FIXTURES.idempotence,
        publicReference: "OG7-'quoted'; --",
        contactEmail: "o'connor@example.invalid",
        stripePaymentIntentId: undefined,
        stripeEventId: "evt_'quoted"
      }
    },
    accountingFixtures: {
      ...ACCOUNTING_FIXTURES,
      scenario: {
        ...ACCOUNTING_FIXTURES.scenario,
        expenseName: "Fixture's expense"
      }
    },
    backfillFixtures: {
      ...BACKFILL_FIXTURES,
      matchedSession: {
        ...BACKFILL_FIXTURES.matchedSession,
        stripePaymentIntentId: "pi_'quoted",
        stripeSessionId: "cs_'quoted",
        publicReference: "OG7-'backfill"
      }
    },
    emailQueueFixture: Object.fromEntries(
      Object.entries(EMAIL_QUEUE_FIXTURE).map(([key, value]) => [
        key,
        `${value}'`
      ])
    )
  };
  const fragments = buildAccountingSeedFragments(quoted);
  const firstInsert = contributionInserts(fragments.webhookFixtureInserts)[0];
  assert.deepEqual(literals(firstInsert), [
    'personal_support',
    'cad',
    'pending',
    "o'connor@example.invalid",
    "OG7-'quoted'; --"
  ]);
  assert.match(
    firstInsert,
    /'o''connor@example.invalid', 'OG7-''quoted''; --',\n  NULL/
  );
  assert.equal(literals(fragments.stripeEventsDelete)[0], "evt_'quoted");
  assert.equal(
    literals(fragments.fundTransactionsByObjectDelete)[0],
    "pi_'quoted"
  );
  assert.equal(
    literals(fragments.stripeCheckoutSessionsDelete)[0],
    "cs_'quoted"
  );
  assert.equal(
    literals(fragments.backfillContributionsDelete)[0],
    "OG7-'backfill"
  );
  assert.equal(
    literals(fragments.accountingExpenseDelete)[0],
    "Fixture's expense"
  );
  assert.equal(
    literals(fragments.accountingExpenseInsert)[0],
    "Fixture's expense"
  );
  assert.deepEqual(literals(fragments.emailQueueDelete), [
    quoted.emailQueueFixture.idempotencyKey
  ]);
  assert.deepEqual(
    literals(fragments.emailQueueInsert).slice(0, 7),
    Object.values(quoted.emailQueueFixture)
  );
});

test('event variants retain field order, repeated ids and omit absent optional ids', () => {
  const fragments = buildAccountingSeedFragments({
    ...inputs,
    webhookFixtures: {
      ...WEBHOOK_FIXTURES,
      idempotence: {
        ...WEBHOOK_FIXTURES.idempotence,
        stripeEventId: 'event',
        stripeEventIdSucceeded: 'event',
        stripeEventIdUpdated: 'updated',
        stripeEventIdFirst: 'first',
        stripeEventIdResend: 'resend'
      },
      checkoutAuthoritative: {
        ...WEBHOOK_FIXTURES.checkoutAuthoritative,
        stripeEventId: ''
      }
    },
    accountingFixtures: {
      ...ACCOUNTING_FIXTURES,
      scenario: {
        ...ACCOUNTING_FIXTURES.scenario,
        stripeEventId: 'accounting-event',
        stripeEventIdSucceeded: 'accounting-succeeded',
        stripeEventIdRefunded: 'accounting-refunded'
      }
    }
  });
  const eventIds = literals(fragments.stripeEventsDelete);
  assert.deepEqual(eventIds.slice(0, 5), [
    'event',
    'event',
    'updated',
    'first',
    'resend'
  ]);
  assert.deepEqual(eventIds.slice(11, 14), [
    'accounting-event',
    'accounting-succeeded',
    'accounting-refunded'
  ]);
  assert.equal(eventIds.includes(''), false);
  assert.deepEqual(literals(fragments.fundTransactionsByEventDelete), eventIds);
});

test('repeated pure planning leaves public fixture records unchanged and returns independent lists', () => {
  const before = structuredClone(inputs);
  const first = buildAccountingSeedFragments(inputs);
  const second = buildAccountingSeedFragments(inputs);
  assert.deepEqual(first, second);
  assert.deepEqual(inputs, before);
  assert.notEqual(first.publicationFixtures, second.publicationFixtures);
  first.publicationFixtures.pop();
  assert.equal(
    buildAccountingSeedFragments(inputs).publicationFixtures.length,
    11
  );
});
