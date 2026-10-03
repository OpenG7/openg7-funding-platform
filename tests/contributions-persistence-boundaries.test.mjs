import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAdminDashboard,
  listAdminContributionSelection,
  listAdminContributions,
  listContributionReferencesByEmail,
  lookupPublicContributionReference,
  normalizeContributionType,
  parseMetadataBoolean
} from '../dist/apps/funding-api/src/fund-contributions.repository.js';

const contribution = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  public_reference: 'OG7-BOUNDARY',
  contribution_type: 'sponsorship_interest',
  amount_cents: '12345',
  currency: 'cad',
  payment_status: 'paid',
  paid_at: '2026-09-01T12:00:00Z',
  public_name: 'Fixture',
  email_private: 'private@example.invalid',
  public_display_consent: false,
  display_amount_consent: false,
  non_charity_acknowledged: true,
  sponsor_company_name: 'Fixture Company',
  sponsor_contact_name: 'Fixture Contact',
  sponsor_contact_email: 'contact@example.invalid',
  sponsor_review_status: 'approved',
  sponsor_feed_status: 'drafted',
  stripe_session_id: 'cs_boundary',
  stripe_payment_intent_id: 'pi_boundary',
  created_at: '2026-09-01T11:00:00Z',
  updated_at: '2026-09-02T12:00:00Z',
  ...overrides
});

test('historical metadata helpers retain exact normalization at the facade', () => {
  assert.equal(
    normalizeContributionType('sponsorship_interest'),
    'sponsorship_interest'
  );
  for (const value of [undefined, '', 'unknown', 'SPONSORSHIP_INTEREST'])
    assert.equal(normalizeContributionType(value), 'personal_support');
  assert.equal(parseMetadataBoolean('true'), true);
  for (const value of [undefined, '', 'false', 'TRUE', '1'])
    assert.equal(parseMetadataBoolean(value), false);
});

test('contribution reads retain their no-database results and availability', async () => {
  const list = await listAdminContributions(null);
  assert.equal(list.data_source, 'database');
  assert.deepEqual(list.contributions, []);
  assert.equal(list.summary.currency, 'CAD');
  assert.equal(list.summary.total_received, 0);
  assert.ok(Number.isFinite(Date.parse(list.last_updated_at)));
  const dashboard = await getAdminDashboard(null);
  assert.equal(dashboard.data_available, false);
  assert.equal(dashboard.totals.current_available_estimate, 0);
  assert.deepEqual(dashboard.recent_contributions, []);
  assert.equal(
    await lookupPublicContributionReference(null, 'OG7-BOUNDARY'),
    null
  );
  assert.deepEqual(
    await listContributionReferencesByEmail(null, 'a@example.invalid'),
    []
  );
});

test('explicit selection uses the supplied transaction client and keeps monetary and consent mappings', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return {
        rows: [
          contribution(),
          contribution({ contribution_type: 'personal_support' })
        ]
      };
    }
  };
  const ids = ['11111111-1111-4111-8111-111111111111'];
  const rows = await listAdminContributionSelection(client, ids);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [250, ids]);
  assert.match(calls[0].sql, /id = ANY\(\$2::uuid\[\]\)/);
  assert.match(calls[0].sql, /FOR SHARE/);
  assert.equal(rows[0].amount, 123.45);
  assert.equal(rows[0].currency, 'CAD');
  assert.equal(rows[0].public_display_consent, false);
  assert.equal(rows[0].email_private, 'private@example.invalid');
  assert.equal(rows[0].sponsor_review_status, 'approved');
  assert.equal(rows[0].sponsor_feed_status, 'drafted');
  assert.equal(rows[1].sponsor_review_status, null);
  assert.equal(rows[1].sponsor_feed_status, null);
});

test('dashboard retains ledger refund precedence, latest timestamp, and recent-row limit', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('AS total_count'))
        return {
          rows: [
            {
              total_count: '4',
              paid_count: '3',
              pending_count: '1',
              sponsorship_count: '2',
              public_display_count: '1',
              total_received: '12345',
              total_refunded: '1000',
              total_disputed: '345',
              currency: 'cad',
              last_updated_at: '2026-09-02T12:00:00Z'
            }
          ]
        };
      if (sql.includes('FROM effective_transactions'))
        return {
          rows: [
            { total_refunded: '500', last_updated_at: '2026-09-03T12:00:00Z' }
          ]
        };
      if (sql.includes('AS payment_status')) return { rows: [contribution()] };
      if (sql.includes('AS last_failed_at'))
        return {
          rows: [
            {
              failed: '2',
              processing: '1',
              last_failed_at: '2026-09-01T12:00:00Z'
            }
          ]
        };
      if (sql.includes('AS planned'))
        return {
          rows: [{ planned: '2', drafted: '1', published: '0', active: '3' }]
        };
      if (sql.includes('AS approved'))
        return {
          rows: [{ total: '2', pending: '1', approved: '1', rejected: '0' }]
        };
      throw new Error('Unexpected dashboard query');
    }
  };
  const result = await getAdminDashboard(pool);
  assert.equal(result.data_available, true);
  assert.deepEqual(result.totals, {
    total_received: 123.45,
    total_refunded: 5,
    total_disputed: 3.45,
    current_available_estimate: 115,
    currency: 'CAD',
    contributions_count: 4,
    paid_contributions_count: 3
  });
  assert.equal(result.last_updated_at, '2026-09-03T12:00:00Z');
  assert.deepEqual(result.sponsorship_review, {
    total: 2,
    pending: 1,
    approved: 1,
    rejected: 0
  });
  assert.deepEqual(result.feed_publication, {
    planned: 2,
    drafted: 1,
    published: 0,
    active: 3
  });
  assert.equal(result.stripe_events.failed, 2);
  const recent = calls.find(({ sql }) => sql.includes('AS payment_status'));
  assert.deepEqual(recent.params, [8, null]);
  assert.doesNotMatch(recent.sql, /FOR SHARE/);
});

test('public reference lookup withholds amount without consent and keeps payment next steps', async () => {
  for (const [paymentStatus, contributionType, nextStep] of [
    ['pending', 'personal_support', 'wait_for_payment_confirmation'],
    ['expired', 'sponsorship_interest', 'wait_for_payment_confirmation'],
    ['disputed', 'personal_support', 'contact_support_with_reference'],
    ['paid', 'sponsorship_interest', 'recover_private_link_by_email'],
    ['paid', 'personal_support', 'none']
  ]) {
    let params;
    const pool = {
      query: async (_sql, queryParams) => {
        params = queryParams;
        return {
          rows: [
            contribution({
              payment_status: paymentStatus,
              contribution_type: contributionType,
              review_status: 'pending_review',
              details_submitted: false
            })
          ]
        };
      }
    };
    const result = await lookupPublicContributionReference(
      pool,
      'OG7-BOUNDARY'
    );
    assert.deepEqual(params, ['OG7-BOUNDARY']);
    assert.equal(result.amount, null);
    assert.equal(result.displayAmount, false);
    assert.equal(result.nextStep, nextStep);
    assert.ok(!JSON.stringify(result).includes('@example.invalid'));
  }
});

test('reference recovery normalizes email, retains display data, and propagates query failures', async () => {
  let params;
  const pool = {
    query: async (_sql, queryParams) => {
      params = queryParams;
      return { rows: [contribution({ display_name: 'Fixture Company' })] };
    }
  };
  const rows = await listContributionReferencesByEmail(
    pool,
    '  CONTACT@EXAMPLE.INVALID  '
  );
  assert.deepEqual(params, ['contact@example.invalid']);
  assert.equal(rows[0].amount, 123.45);
  assert.equal(rows[0].currency, 'CAD');
  assert.equal(rows[0].displayName, 'Fixture Company');
  const error = new Error('SYNTHETIC_DATABASE_FAILURE');
  const failingPool = {
    query: async () => {
      throw error;
    }
  };
  assert.deepEqual(
    await listContributionReferencesByEmail(failingPool, '  '),
    []
  );
  await assert.rejects(
    getAdminDashboard(failingPool),
    (failure) => failure === error
  );
  await assert.rejects(
    listAdminContributionSelection(failingPool, []),
    (failure) => failure === error
  );
});
