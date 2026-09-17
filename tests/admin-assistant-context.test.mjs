import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSponsorshipAssistantContext,
  canRequestSponsorshipInformation,
  getAdminAssistantContext
} from '../dist/apps/funding-api/src/admin-assistant/context.service.js';
import { validateInformationRequest } from '../dist/apps/funding-api/src/sponsorship-information.service.js';

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
