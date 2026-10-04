import assert from 'node:assert/strict';
import test from 'node:test';

import * as facade from '../dist/apps/funding-api/src/fund-contributions.repository.js';
import * as adminReads from '../dist/apps/funding-api/src/sponsorship-admin-read.repository.js';
import * as publicReads from '../dist/apps/funding-api/src/public-sponsorships.repository.js';
import * as decisions from '../dist/apps/funding-api/src/sponsorship-decisions.repository.js';
import * as followup from '../dist/apps/funding-api/src/sponsorship-followup.repository.js';
import * as refunds from '../dist/apps/funding-api/src/sponsorship-refund-workflow.repository.js';
import * as events from '../dist/apps/funding-api/src/stripe-event-records.repository.js';
import * as helpers from '../dist/apps/funding-api/src/sponsorship-persistence-helpers.js';

const id = '11111111-1111-4111-8111-111111111111';
const version = '2026-09-01 12:00:00+00';
const publication = (overrides = {}) => ({
  contributionId: id,
  expectedVersion: version,
  publicSlug: 'boundary-company',
  publicSummary: 'Public summary',
  feedTarget: 'openg7',
  feedChannels: ['facebook'],
  feedStatus: 'drafted',
  feedPublicUrl: null,
  feedNotes: 'Private note',
  ...overrides
});
const review = (overrides = {}) => ({
  contributionId: id,
  expectedVersion: version,
  reviewStatus: 'approved',
  reviewNote: 'Private review',
  ...overrides
});
const database = (...responses) => {
  const calls = [];
  return {
    calls,
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        assert.ok(responses.length > 0, 'Unexpected extra database query');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      }
    }
  };
};

test('historical sponsorship exports point to their owning implementations', () => {
  for (const module of [
    adminReads,
    publicReads,
    decisions,
    followup,
    refunds,
    events
  ]) {
    for (const [name, operation] of Object.entries(module)) {
      assert.equal(facade[name], operation, name);
    }
  }
  for (const name of [
    'allowedSponsorshipRefundWorkflowStatuses',
    'allowedSponsorshipStripeRefundReasons',
    'allowedSponsorFeedTargets',
    'allowedSponsorFeedChannels'
  ])
    assert.equal(facade[name], helpers[name], name);
});

test('sponsorship reads and mutations retain their distinct absent-database results', async () => {
  for (const operation of [
    facade.getAdminSponsorshipById,
    facade.getAdminSponsorshipLogoUrl,
    facade.getSponsorshipRefundTarget,
    facade.getSponsorshipFollowupByTokenHash
  ])
    assert.equal(await operation(null, id, version), null);
  for (const operation of [
    facade.recordSponsorshipDetails,
    facade.recordSponsorshipDetailsForContribution,
    facade.markSponsorshipFollowupEmailResult,
    facade.updateSponsorshipRefundWorkflowStatus,
    facade.updateSponsorshipRefundWorkflowStatusByPaymentIntent
  ])
    assert.equal(await operation(null, {}), false);
  assert.equal(
    await facade.isPublicApprovedSponsorshipLogoUrl(null, '/logo'),
    false
  );
  assert.equal(await facade.insertStripeEventRecord(null, {}), true);
  assert.equal(
    await facade.markStripeEventProcessed(null, 'evt_boundary'),
    undefined
  );
  assert.equal(
    await facade.markStripeEventFailed(null, 'evt_boundary'),
    undefined
  );
  assert.deepEqual(await facade.updateSponsorshipReview(null, review()), {
    status: 'not_found',
    updated: false,
    currentVersion: null,
    paymentStatus: null
  });
  assert.deepEqual(
    await facade.updateSponsorshipPublication(null, publication()),
    {
      status: 'not_found',
      updated: false,
      feedChannels: ['facebook'],
      currentVersion: null,
      paymentStatus: null
    }
  );
  for (const operation of [
    facade.updateSponsorshipLogoUrl,
    facade.clearSponsorshipLogoUrl
  ]) {
    assert.deepEqual(await operation(null, {}), {
      status: 'not_found',
      updated: false,
      previousLogoUrl: null,
      currentVersion: null
    });
  }
  const admin = await facade.listAdminSponsorships(null, {
    page: 0,
    pageSize: 12
  });
  assert.deepEqual(admin.items, []);
  assert.deepEqual(admin.pagination, {
    page: 1,
    pageSize: 12,
    totalItems: 0,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false
  });
  const attention = await facade.listSponsorshipsForAttention(null);
  assert.deepEqual(attention.items, []);
  assert.equal(attention.truncated, false);
  const publicList = await facade.listPublicSponsorships(null);
  assert.equal(publicList.data_source, 'empty');
  assert.deepEqual(publicList.sponsorships, []);
  for (const timestamp of [
    admin.lastUpdatedAt,
    attention.lastUpdatedAt,
    publicList.last_updated_at
  ]) {
    assert.ok(Number.isFinite(Date.parse(timestamp)));
  }
});

test('review preserves version, payment and presentation-photo prerequisites before writing', async () => {
  const target = {
    status: 'paid',
    review_status: 'pending_review',
    version,
    has_approved_presentation_photo: true
  };
  for (const [row, expected] of [
    [null, 'not_found'],
    [{ ...target, version: 'newer' }, 'conflict'],
    [{ ...target, status: 'refunded' }, 'payment_not_eligible'],
    [{ ...target, has_approved_presentation_photo: false }, 'media_required']
  ]) {
    const db = database({ rows: row ? [row] : [] });
    const result = await facade.updateSponsorshipReview(db.pool, review());
    assert.equal(result.status, expected);
    assert.equal(result.updated, false);
    assert.equal(db.calls.length, 1);
  }
  for (const [rows, expected] of [
    [[], 'conflict'],
    [[{ version: 'next' }], 'updated']
  ]) {
    const db = database({ rows: [target] }, { rows });
    const result = await facade.updateSponsorshipReview(db.pool, review());
    assert.equal(result.status, expected);
    assert.equal(
      result.currentVersion,
      expected === 'updated' ? 'next' : version
    );
    assert.equal(result.paymentStatus, 'paid');
    assert.deepEqual(db.calls[1].params, [
      id,
      'approved',
      'Private review',
      version
    ]);
  }
  const previouslyApproved = database(
    { rows: [{ ...target, status: 'disputed', review_status: 'approved' }] },
    { rows: [{ version: 'next' }] }
  );
  assert.equal(
    (await facade.updateSponsorshipReview(previouslyApproved.pool, review()))
      .status,
    'updated'
  );
});

test('publication retains promised channels, nonpaid metadata restrictions and optimistic conflicts', async () => {
  const target = {
    amount_cents: '100000',
    status: 'paid',
    version,
    sponsor_public_slug: 'boundary-company',
    sponsor_public_summary: 'Public summary',
    sponsor_feed_target: 'openg7',
    sponsor_feed_channels: '["facebook","linkedin","invalid"]',
    sponsor_feed_status: 'drafted',
    sponsor_feed_public_url: null
  };
  const paid = database({ rows: [target] }, { rows: [{ version: 'next' }] });
  const updated = await facade.updateSponsorshipPublication(
    paid.pool,
    publication()
  );
  assert.equal(updated.status, 'updated');
  assert.deepEqual(updated.feedChannels, ['facebook', 'linkedin']);
  assert.deepEqual(paid.calls[1].params, [
    id,
    'boundary-company',
    'Public summary',
    'openg7',
    '["facebook","linkedin"]',
    'drafted',
    null,
    'Private note',
    version
  ]);
  const refunded = database({ rows: [{ ...target, status: 'refunded' }] });
  assert.equal(
    (await facade.updateSponsorshipPublication(refunded.pool, publication()))
      .status,
    'payment_not_eligible'
  );
  const notesOnly = database(
    { rows: [{ ...target, status: 'refunded' }] },
    { rows: [{ version: 'next' }] }
  );
  assert.equal(
    (
      await facade.updateSponsorshipPublication(
        notesOnly.pool,
        publication({
          publicSlug: ' boundary-company ',
          feedChannels: ['linkedin', 'facebook', 'facebook'],
          feedNotes: 'Updated private note'
        })
      )
    ).status,
    'updated'
  );
  const raced = database({ rows: [target] }, { rows: [] });
  assert.equal(
    (await facade.updateSponsorshipPublication(raced.pool, publication()))
      .status,
    'conflict'
  );
  const stale = database({ rows: [{ ...target, version: 'newer' }] });
  assert.equal(
    (await facade.updateSponsorshipPublication(stale.pool, publication()))
      .currentVersion,
    'newer'
  );
  const missing = database({ rows: [] });
  assert.equal(
    (await facade.updateSponsorshipPublication(missing.pool, publication()))
      .status,
    'not_found'
  );
});

test('logo decisions return the previous URL and distinguish absent dossiers from stale versions', async () => {
  for (const operation of [
    facade.updateSponsorshipLogoUrl,
    facade.clearSponsorshipLogoUrl
  ]) {
    for (const [row, expected] of [
      [
        {
          updated: true,
          previous_logo_url: '/previous.webp',
          current_version: 'next'
        },
        'updated'
      ],
      [
        {
          updated: false,
          previous_logo_url: '/previous.webp',
          current_version: version
        },
        'conflict'
      ],
      [
        { updated: false, previous_logo_url: null, current_version: null },
        'not_found'
      ]
    ]) {
      const db = database({ rows: [row] });
      const result = await operation(db.pool, {
        contributionId: id,
        logoUrl: '/next.webp',
        expectedVersion: version
      });
      assert.equal(result.status, expected);
      assert.equal(result.previousLogoUrl, row.previous_logo_url);
      assert.equal(result.currentVersion, row.current_version);
    }
  }
});

test('attention projection truncates globally and never returns the private source fields', async () => {
  const row = {
    contribution_id: id,
    public_reference: 'OG7-BOUNDARY',
    amount_cents: '12345',
    currency: 'cad',
    payment_status: 'refunded',
    paid_at: null,
    updated_at: version,
    sponsor_details_submitted_at: null,
    has_company_name: true,
    has_contact_email: true,
    has_website: false,
    has_logo: false,
    has_supporting_image: true,
    sponsor_review_status: 'unknown',
    sponsor_feed_status: 'unknown',
    sponsor_feed_target: 'invalid',
    sponsor_feed_channels: '["facebook","invalid"]',
    sponsorship_refund_status: 'invalid',
    sponsor_contact_email: 'private@example.invalid'
  };
  const db = database({ rows: [{ exists: true }] }, { rows: [row, row] });
  const result = await facade.listSponsorshipsForAttention(
    db.pool,
    1,
    'OG7-BOUNDARY'
  );
  assert.equal(result.truncated, true);
  assert.equal(result.items.length, 1);
  assert.deepEqual(db.calls[1].params, [2, 'OG7-BOUNDARY']);
  const projected = result.items[0];
  assert.equal(projected.amount, 123.45);
  assert.equal(projected.currency, 'CAD');
  assert.equal(projected.reviewStatus, 'pending_review');
  assert.equal(projected.feedStatus, 'not_planned');
  assert.equal(projected.feedTarget, null);
  assert.equal(projected.refundStatus, 'completed');
  assert.deepEqual(projected.feedChannels, ['facebook']);
  assert.equal(
    JSON.stringify(result).includes('private@example.invalid'),
    false
  );
});

test('public projection preserves schema absence and rejects invalid pagination before accessing the database', async () => {
  for (const input of [
    { page: 0 },
    { pageSize: 51 },
    { page: 1.2 },
    { page: 100001 }
  ]) {
    await assert.rejects(
      facade.listPublicSponsorships(null, input),
      RangeError
    );
  }
  const db = database({ rows: [] });
  const result = await facade.listPublicSponsorships(db.pool);
  assert.equal(result.data_source, 'empty');
  assert.deepEqual(result.sponsorships, []);
  assert.equal(db.calls.length, 1);
});

test('Stripe event recording preserves duplicate/failed retry results and safe state updates', async () => {
  for (const rowCount of [1, 0, null]) {
    const db = database({ rows: [], rowCount });
    assert.equal(
      await facade.insertStripeEventRecord(db.pool, {
        stripeEventId: 'evt_boundary',
        eventType: 'checkout.session.completed',
        payload: { fixture: true }
      }),
      rowCount === 1
    );
    assert.deepEqual(db.calls[0].params, [
      'evt_boundary',
      'checkout.session.completed',
      '{"fixture":true}'
    ]);
  }
  const db = database({ rows: [], rowCount: 1 }, { rows: [], rowCount: 1 });
  await facade.markStripeEventFailed(db.pool, 'evt_boundary');
  await facade.markStripeEventProcessed(db.pool, 'evt_boundary');
  assert.deepEqual(
    db.calls.map(({ params }) => params),
    [['evt_boundary'], ['evt_boundary']]
  );
});

test('database failures propagate across each extracted responsibility instead of reporting success or zero', async () => {
  const failure = new Error('Synthetic repository failure');
  for (const [operation, input, extra] of [
    [facade.listAdminSponsorships, { page: 1, pageSize: 12 }],
    [facade.listSponsorshipsForAttention, 12],
    [facade.listPublicSponsorships, {}],
    [facade.updateSponsorshipReview, review()],
    [facade.updateSponsorshipPublication, publication()],
    [facade.updateSponsorshipLogoUrl, { contributionId: id }],
    [facade.clearSponsorshipLogoUrl, { contributionId: id }],
    [facade.getSponsorshipFollowupByTokenHash, 'synthetic-hash', version],
    [facade.recordSponsorshipDetails, { currency: 'CAD' }],
    [facade.recordSponsorshipDetailsForContribution, { contributionId: id }],
    [
      facade.markSponsorshipFollowupEmailResult,
      { stripeSessionId: 'cs_boundary' }
    ],
    [facade.getSponsorshipRefundTarget, id],
    [facade.updateSponsorshipRefundWorkflowStatus, { contributionId: id }],
    [
      facade.updateSponsorshipRefundWorkflowStatusByPaymentIntent,
      { stripePaymentIntentId: 'pi_boundary' }
    ],
    [facade.insertStripeEventRecord, { payload: {} }],
    [facade.markStripeEventProcessed, 'evt_boundary'],
    [facade.markStripeEventFailed, 'evt_boundary'],
    [facade.lockSponsorshipContribution, id]
  ]) {
    const db = database(failure);
    await assert.rejects(
      operation(db.pool, input, extra),
      (error) => error === failure
    );
    assert.equal(db.calls.length, 1);
  }
  const writeFailure = database(
    {
      rows: [
        {
          status: 'paid',
          review_status: 'pending_review',
          version,
          has_approved_presentation_photo: true
        }
      ]
    },
    failure
  );
  await assert.rejects(
    facade.updateSponsorshipReview(writeFailure.pool, review()),
    (error) => error === failure
  );
});
