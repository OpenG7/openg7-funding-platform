import assert from 'node:assert/strict';
import test from 'node:test';

import { detectSponsorshipMediaReviewItems } from '../dist/apps/funding-api/src/admin-assistant/attention.service.js';
import { createAttentionDatasetLoader } from '../dist/apps/funding-api/src/admin-assistant/attention/dataset.js';
import { listSponsorshipMediaForAttention } from '../dist/apps/funding-api/src/admin-assistant/attention/media.repository.js';
import {
  buildWorkQueueItems,
  paginateWorkQueue,
  parseWorkQueueQuery
} from '../dist/apps/funding-api/src/admin-work-queue.service.js';
import { countPendingWorkQueueDossiers } from '../dist/apps/funding-api/src/admin-work-queue/projection.js';

const now = new Date('2026-11-17T15:00:00Z');
const dossier = (overrides = {}) => ({
  contributionId: 'synthetic-dossier',
  publicReference: 'SYNTHETIC-1',
  paymentStatus: 'paid',
  refundStatus: 'not_requested',
  reviewStatus: 'approved',
  ...overrides
});
const media = (overrides = {}) => ({
  contributionId: 'synthetic-dossier',
  authorization: 'confirmed',
  missingAlt: true,
  changedAt: '2026-11-16T15:00:00.000Z',
  ...overrides
});
const dataset = (overrides = {}) => ({
  now,
  sponsorships: [dossier()],
  sponsorshipsTruncated: false,
  media: [],
  drafts: [],
  batches: [],
  slots: [],
  emailMessages: [],
  financialTotals: null,
  ...overrides
});
const rights = {
  state: 'confirmed',
  channels: ['website'],
  targets: ['openg7'],
  transformations: ['technical'],
  credit: null,
  restrictions: null
};

test('one stable dossier item prioritizes review, including missing descriptions, over waiting rights', () => {
  const source = dataset({
    media: [
      media(),
      media({ missingAlt: false, changedAt: '2026-11-15T15:00:00.000Z' }),
      media({
        authorization: 'required',
        changedAt: '2026-10-01T15:00:00.000Z'
      }),
      media({ contributionId: 'another-dossier' })
    ]
  });
  const items = detectSponsorshipMediaReviewItems(source);
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.id, 'sponsorship_media_review:synthetic-dossier');
  assert.equal(item.type, 'sponsorship_media_review');
  assert.equal(item.severity, 'today');
  assert.equal(item.detectedAt, '2026-11-15T15:00:00.000Z');
  assert.equal(item.dueAt, undefined);
  assert.equal(
    item.adminUrl,
    '/admin/fundraiser/sponsors?sponsorshipId=synthetic-dossier&tab=media'
  );
  assert.deepEqual(item.facts, {
    reference: 'SYNTHETIC-1',
    phase: 'review',
    reviewCount: 2,
    authorizationRequiredCount: 1,
    missingAltCount: 1,
    changedAt: '2026-11-15T15:00:00.000Z',
    daysWaiting: 2,
    tab: 'media'
  });
  assert.ok(
    item.suggestedActions.every((action) => action.executionMode === 'navigate')
  );
  const later = detectSponsorshipMediaReviewItems({
    ...source,
    now: new Date('2026-11-23T15:00:00Z')
  })[0];
  assert.equal(later.id, item.id);
  assert.equal(later.detectedAt, item.detectedAt);
  assert.equal(later.facts.changedAt, item.facts.changedAt);
  assert.equal(later.severity, 'urgent');
});

test('waiting rights stay informational and become actionable under the same dossier identity after confirmation', () => {
  const waiting = detectSponsorshipMediaReviewItems(
    dataset({
      media: [media({ authorization: 'required' })]
    })
  )[0];
  assert.equal(waiting.facts.phase, 'waiting');
  assert.equal(waiting.facts.reviewCount, 0);
  assert.equal(waiting.facts.authorizationRequiredCount, 1);
  assert.equal(waiting.facts.missingAltCount, 0);
  assert.equal(waiting.severity, 'informational');
  assert.match(waiting.explanation, /ne confirme pas/);
  const result = paginateWorkQueue([waiting], now, { overview: true });
  assert.equal(result.typeCounts.sponsorship_media_review, 1);
  assert.equal(result.actionCounts.sponsorship_media_review, 0);
  assert.equal(result.todayTotal, 0);
  assert.equal(result.firstSponsorshipId, null);
  assert.deepEqual(result.overview.recommendations, []);
  assert.equal(countPendingWorkQueueDossiers([waiting], dataset()), 0);
  const reviewed = detectSponsorshipMediaReviewItems(
    dataset({ media: [media()] })
  )[0];
  assert.equal(reviewed.id, waiting.id);
  const query = parseWorkQueueQuery(
    new URLSearchParams('type=sponsorship_media_review&due=today&overview=true')
  );
  const action = paginateWorkQueue([reviewed], now, query);
  assert.equal(action.filteredTotal, 1);
  assert.equal(action.todayTotal, 1);
  assert.equal(action.actionCounts.sponsorship_media_review, 1);
  assert.equal(action.overview.recommendations[0].id, reviewed.id);
  assert.equal(
    countPendingWorkQueueDossiers(
      [reviewed, { ...reviewed, id: 'another-action' }],
      dataset()
    ),
    1
  );
});

test('payment, refund or dossier rejection suppress media work without turning a source absence into an actionable item', () => {
  for (const overrides of [
    { paymentStatus: 'refunded' },
    { paymentStatus: 'disputed' },
    { paymentStatus: 'pending' },
    { refundStatus: 'requested' },
    { refundStatus: 'processing' },
    { refundStatus: 'failed' },
    { reviewStatus: 'rejected' }
  ]) {
    assert.deepEqual(
      detectSponsorshipMediaReviewItems(
        dataset({
          sponsorships: [dossier(overrides)],
          media: [media()]
        })
      ),
      [],
      JSON.stringify(overrides)
    );
  }
  assert.equal(
    detectSponsorshipMediaReviewItems(
      dataset({
        sponsorships: [dossier({ reviewStatus: 'pending_review' })],
        media: [media()]
      })
    ).length,
    1
  );
  assert.deepEqual(detectSponsorshipMediaReviewItems(dataset()), []);
});

test('the shared queue detector exposes media work to pagination and complete dossier counts', () => {
  const source = dataset({ media: [media()] });
  const items = buildWorkQueueItems(source).filter(
    (item) => item.type === 'sponsorship_media_review'
  );
  assert.equal(items.length, 1);
  assert.equal(countPendingWorkQueueDossiers(items, source), 1);
});

test('media acquisition validates effective rights without requiring a new platform acceptance receipt', async () => {
  const calls = [];
  const row = (usage_rights, overrides = {}) => ({
    contribution_id: 'synthetic-dossier',
    changed_at: '2026-11-16 10:00:00-05',
    alt_text: '\n\u00a0\t',
    usage_rights,
    ...overrides
  });
  const result = await listSponsorshipMediaForAttention(
    {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [row(rights), row(null), row({ ...rights, state: 'withdrawn' })]
        };
      }
    },
    ['synthetic-dossier']
  );
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((item) => item.authorization),
    ['confirmed', 'required']
  );
  assert.equal(result[0].changedAt, '2026-11-16T15:00:00.000Z');
  assert.equal(result[0].missingAlt, true);
  assert.deepEqual(Object.keys(result[0]).sort(), [
    'authorization',
    'changedAt',
    'contributionId',
    'missingAlt'
  ]);
  assert.deepEqual(calls[0].params, [['synthetic-dossier']]);
  assert.match(calls[0].sql, /sponsor_media_effective_usage/);
  await assert.rejects(
    listSponsorshipMediaForAttention({
      async query() {
        return { rows: [row({ ...rights, channels: [] })] };
      }
    }),
    /Confirmed image usage/
  );
  const unavailable = new Error('Synthetic source unavailable');
  await assert.rejects(
    listSponsorshipMediaForAttention({
      async query() {
        throw unavailable;
      }
    }),
    (error) => error === unavailable
  );
});

test('production dataset wiring propagates media-source failures and never reports an empty success', async () => {
  const readers = {
    listSponsorshipsForAttention: async () => ({ items: [], truncated: false }),
    listAdminPublicationDrafts: async () => ({ drafts: [] }),
    listAdminPublicationBatches: async () => ({ batches: [] }),
    listAdminPublicationSlots: async () => ({ slots: [] }),
    listAdminEmailQueue: async () => ({ messages: [] }),
    getAdminDashboard: async () => ({
      totals: {
        total_received: 0,
        total_refunded: 0,
        total_disputed: 0,
        currency: 'CAD'
      }
    }),
    listSponsorshipMediaForAttention: async () => [media()]
  };
  const read = await createAttentionDatasetLoader(readers)(null, now);
  assert.deepEqual(read.media, [media()]);
  const unavailable = new Error('Synthetic media source unavailable');
  readers.listSponsorshipMediaForAttention = async () => {
    throw unavailable;
  };
  await assert.rejects(
    createAttentionDatasetLoader(readers)(null, now),
    (error) => error === unavailable
  );
});
