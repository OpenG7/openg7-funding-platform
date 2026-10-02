import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSponsorshipAssistantContext,
  canRequestSponsorshipInformation,
  getAdminAssistantContext
} from '../dist/apps/funding-api/src/admin-assistant/context.service.js';
import { validateInformationRequest } from '../dist/apps/funding-api/src/sponsorship-information.service.js';
import { getSponsorshipProgress } from '../dist/apps/funding-api/src/sponsorship-progress.service.js';

const source = (record = {}, rest = {}) => ({
  record: {
    contributionId: '10000000-0000-4000-8000-000000000001',
    publicReference: 'OG7-CMD-0001',
    amount: 500,
    currency: 'CAD',
    paymentStatus: 'paid',
    refundStatus: 'not_requested',
    reviewStatus: 'pending_review',
    feedStatus: 'not_planned',
    detailsSubmittedAt: '2026-09-01',
    hasCompanyName: true,
    hasContactEmail: true,
    hasSupportingImage: true,
    ...record
  },
  dataset: { drafts: [] },
  recipient: 'demo@example.invalid',
  consent: true,
  version: 'a'.repeat(64),
  media: [{ id: 'image', kind: 'supporting_image', reviewStatus: 'approved' }],
  ...rest
});

test('deterministic next step respects independent payment, refund, media, review and consent states', () => {
  for (const [input, nextStep] of [
    [source({ paymentStatus: 'pending' }), 'check_payment'],
    [source({ refundStatus: 'processing' }), 'check_refund'],
    [source({ reviewStatus: 'rejected' }), 'review_rejection'],
    [
      source({ hasSupportingImage: false }, { media: [] }),
      'complete_information'
    ],
    [
      source(
        {},
        {
          media: [{ kind: 'supporting_image', reviewStatus: 'pending_review' }]
        }
      ),
      'review_media'
    ],
    [source(), 'review_sponsorship'],
    [
      source({ reviewStatus: 'approved' }, { consent: false }),
      'confirm_consent'
    ],
    [source({ reviewStatus: 'approved' }), 'prepare_publication'],
    [
      source(
        { reviewStatus: 'approved' },
        {
          dataset: {
            drafts: ['facebook', 'linkedin'].map((channel) => ({
              contribution_id: '10000000-0000-4000-8000-000000000001',
              channel,
              status: 'scheduled'
            }))
          }
        }
      ),
      'monitor_publication'
    ],
    [source({ reviewStatus: 'approved', amount: 10 }), 'complete']
  ])
    assert.equal(buildSponsorshipAssistantContext(input).nextStep, nextStep);
});

test('public context omits recipients and request eligibility requires a usable recipient', async () => {
  assert.doesNotMatch(
    JSON.stringify(buildSponsorshipAssistantContext(source())),
    /demo@example/
  );
  assert.equal(
    canRequestSponsorshipInformation(source({ hasSupportingImage: false })),
    true
  );
  for (const item of [
    source(),
    source({ hasSupportingImage: false, reviewStatus: 'rejected' }),
    source({ hasSupportingImage: false, paymentStatus: 'pending' }),
    source({ hasSupportingImage: false }, { recipient: null })
  ])
    assert.equal(canRequestSponsorshipInformation(item), false);
  assert.equal((await getAdminAssistantContext(null)).status, 'unavailable');
});

test('context and progress report unavailable sources before opening a default dossier', async () => {
  const now = new Date('2026-10-02T12:00:00.000Z');
  for (const reference of [undefined, '', source().record.contributionId]) {
    assert.deepEqual(
      await getAdminAssistantContext(null, reference, 'mock', now),
      {
        generatedAt: now.toISOString(),
        conversationMode: 'mock',
        status: 'unavailable',
        context: null
      }
    );
    assert.deepEqual(await getSponsorshipProgress(null, reference, now), {
      generatedAt: now.toISOString(),
      status: 'unavailable',
      dossier: null
    });
  }
  for (const read of [
    (pool, reference) => getAdminAssistantContext(pool, reference, 'mock', now),
    (pool, reference) => getSponsorshipProgress(pool, reference, now)
  ]) {
    for (const reference of [undefined, '']) {
      let queries = 0;
      const result = await read(
        {
          query: async () => {
            queries++;
            return { rows: [] };
          },
          connect: () => assert.fail('no dossier snapshot without a selection')
        },
        reference
      );
      assert.equal(result.status, 'unavailable');
      assert.equal(queries, 1, 'missing queue sources stop further reads');
    }
  }
});

test('explicit context references bypass the global queue and remain exact when not found', async () => {
  const now = new Date('2026-10-02T12:00:00.000Z');
  for (const [reference, exactReference] of [
    [
      'A0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001'
    ],
    ['OG7-CMD-Synthetic', 'OG7-CMD-Synthetic'],
    ['og7-cmd-synthetic', 'og7-cmd-synthetic'],
    ['#OG7-CMD-Synthetic', '#OG7-CMD-Synthetic'],
    [' ', ' ']
  ]) {
    let exactLookups = 0;
    const result = await getAdminAssistantContext(
      {
        query: async (sql, values) => {
          assert.doesNotMatch(
            sql,
            /unnest/,
            'explicit selection skips the queue'
          );
          if (sql.includes('AS available'))
            return { rows: [{ available: true }] };
          if (sql.includes('AS exists')) return { rows: [{ exists: true }] };
          exactLookups++;
          assert.equal(values[1], exactReference);
          return { rows: [] };
        }
      },
      reference,
      'mock',
      now
    );
    assert.equal(result.status, 'not_found');
    assert.equal(result.context, null);
    assert.equal(exactLookups, 1);
  }
});

test('information request validates explicit confirmation and safe bounded message fields', () => {
  const valid = {
    contributionId: source().record.contributionId,
    contextVersion: 'a'.repeat(64),
    recipient: 'demo@example.invalid',
    subject: 'Please complete your profile',
    body: 'Hello',
    confirmed: true
  };
  assert.deepEqual(validateInformationRequest(valid), valid);
  for (const patch of [
    { confirmed: false },
    { contributionId: 'bad' },
    { contextVersion: '' },
    { recipient: 'bad' },
    { subject: 'Subject\r\nBcc: injected@example.invalid' },
    { subject: 'x'.repeat(201) },
    { body: '' },
    { body: 'x'.repeat(6001) }
  ]) {
    assert.throws(
      () => validateInformationRequest({ ...valid, ...patch }),
      (error) => error.status === 400
    );
  }
  assert.throws(
    () => validateInformationRequest(null),
    (error) => error.status === 400
  );
});
