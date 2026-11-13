import assert from 'node:assert/strict';
import test from 'node:test';

import { validateInformationRequest } from '../dist/apps/funding-api/src/sponsorship-information.service.js';
import {
  prepareSponsorshipMediaConsentRequest,
  readSponsorshipMediaConsentAssets,
  validSponsorshipMediaConsentAccessOptions
} from '../dist/apps/funding-api/src/sponsorship-media-consent.js';
import { renderSponsorshipInformationRequestEmail } from '../dist/apps/funding-api/src/services/email/sponsorship.templates.js';

const contributionId = '10000000-0000-4000-8000-000000000401';
const photo = (index, extra = {}) => ({
  id: `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  contributionId,
  version: `version-${index}`,
  originalFilename: `synthetic-photo-${index}.webp`,
  kind: 'supporting_image',
  uploadedBy: 'admin',
  reviewStatus: 'pending_review',
  usage: { state: 'needs_confirmation' },
  ...extra
});
const source = (media = [photo(2), photo(1)]) => ({
  record: {
    contributionId,
    publicReference: 'G7-SYNTHETIC-MEDIA',
    paymentStatus: 'paid',
    refundStatus: 'not_requested',
    reviewStatus: 'pending_review'
  },
  dataset: { now: new Date('2026-11-10T15:00:00.000Z') },
  media,
  version: 'a'.repeat(64),
  recipient: 'different-contact@example.test',
  accessRecipient: 'payment-address@example.test',
  consent: true
});
const validRequest = () => ({
  ...prepareSponsorshipMediaConsentRequest(source(), source().media, 'fr-CA')
    .delivery,
  requestId: '30000000-0000-4000-8000-000000000001',
  confirmed: true
});

test('one private preview covers the sorted photo snapshot and only the authorized payment address', () => {
  for (const language of ['fr-CA', 'en']) {
    const original = source();
    const before = structuredClone(original);
    const preview = prepareSponsorshipMediaConsentRequest(
      original,
      original.media,
      language
    );
    assert.equal(preview.status, 'ok');
    assert.equal(preview.delivery.purpose, 'media_consent');
    assert.equal(preview.delivery.language, language);
    assert.equal(preview.delivery.recipient, original.accessRecipient);
    assert.notEqual(preview.delivery.recipient, original.recipient);
    assert.deepEqual(preview.delivery.mediaSnapshot, [
      { id: photo(1).id, version: 'version-1' },
      { id: photo(2).id, version: 'version-2' }
    ]);
    assert.doesNotMatch(
      preview.delivery.body,
      /\{\{|sponsorship_media_consent_link/
    );
    assert.match(preview.draft.notice, /automatically|automatiquement/);
    assert.doesNotMatch(preview.delivery.body, /https?:\/\/|[?&]token=/);
    assert.equal(preview.draft.type, 'sponsorship_media_consent_request');
    assert.equal(preview.draft.fields[0].value, preview.delivery.subject);
    assert.equal(
      preview.draft.fields[1].value,
      'synthetic-photo-2.webp, synthetic-photo-1.webp'
    );
    assert.equal(preview.draft.sent, false);
    assert.equal(preview.draft.persisted, false);
    assert.equal(preview.draft.published, false);
    assert.match(preview.draft.adminUrl, /tab=media/);
    assert.deepEqual(original, before);
  }
});

test('a media consent preview requires eligible photos and the current actionable payment recipient', () => {
  for (const change of [
    (current) => (current.accessRecipient = null),
    (current) => (current.accessRecipient = 'invalid'),
    (current) => (current.record.paymentStatus = 'refunded'),
    (current) => (current.record.refundStatus = 'requested'),
    (current) => (current.record.reviewStatus = 'rejected')
  ]) {
    const current = source();
    change(current);
    const result = prepareSponsorshipMediaConsentRequest(
      current,
      current.media,
      'fr-CA'
    );
    assert.equal(result.status, 'not_applicable');
    assert.equal(result.draft, null);
    assert.equal(result.delivery, undefined);
  }
  assert.equal(
    prepareSponsorshipMediaConsentRequest(source([]), [], 'en').status,
    'not_applicable'
  );
  const current = source();
  current.consent = false;
  assert.equal(
    prepareSponsorshipMediaConsentRequest(current, current.media, 'en').status,
    'ok',
    'profile consent does not control the photo permission request'
  );
});

test('only current photos with an original fingerprint enter the consent snapshot', async () => {
  const media = [
    photo(2),
    photo(1),
    photo(3, { kind: 'logo' }),
    photo(4, { reviewStatus: 'rejected' }),
    photo(5, { usage: { state: 'withdrawn' } }),
    photo(6, { usage: { state: 'confirmed' } }),
    photo(7)
  ];
  const current = source(media);
  const before = structuredClone(current);
  const calls = [];
  const result = await readSponsorshipMediaConsentAssets(
    {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{ id: photo(1).id }, { id: photo(2).id }] };
      }
    },
    current
  );
  assert.deepEqual(
    result.map((asset) => asset.id),
    [photo(1).id, photo(2).id]
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values[0], contributionId);
  assert.deepEqual(calls[0].values[1], [photo(2).id, photo(1).id, photo(7).id]);
  assert.deepEqual(current, before);
});

test('media consent validates its exact bounded snapshot without imposing a technical link marker', () => {
  const input = validRequest();
  assert.deepEqual(validateInformationRequest(input), input);
  const reversed = {
    ...input,
    mediaSnapshot: [...input.mediaSnapshot].reverse().map((entry) => ({
      ...entry,
      id: entry.id.toUpperCase()
    }))
  };
  assert.deepEqual(validateInformationRequest(reversed), input);
  const edited = {
    ...input,
    subject: 'Personalized review request',
    body: 'Hello, please review your photos.\nThank you.'
  };
  assert.deepEqual(validateInformationRequest(edited), edited);
  for (const patch of [
    { language: undefined },
    { language: 'de' },
    { mediaSnapshot: undefined },
    { mediaSnapshot: [] },
    { mediaSnapshot: Array.from({ length: 101 }, (_, index) => photo(index)) },
    { mediaSnapshot: [input.mediaSnapshot[0], input.mediaSnapshot[0]] },
    { mediaSnapshot: [{ id: 'invalid', version: 'version-1' }] },
    { mediaSnapshot: [{ ...input.mediaSnapshot[0], version: '' }] },
    {
      mediaSnapshot: [{ ...input.mediaSnapshot[0], version: 'x'.repeat(129) }]
    },
    {
      mediaSnapshot: [{ ...input.mediaSnapshot[0], version: 'unsafe\nversion' }]
    },
    { mediaSnapshot: [{ ...input.mediaSnapshot[0], token: 'not-accepted' }] },
    { body: '' },
    { body: 'x'.repeat(6001) },
    { body: 'Unsafe\0message' }
  ])
    assert.throws(
      () => validateInformationRequest({ ...input, ...patch }),
      (error) => error.status === 400
    );
  for (const purpose of [undefined, 'public_consent'])
    assert.throws(
      () => validateInformationRequest({ ...input, purpose }),
      (error) => error.status === 400,
      'media-only fields cannot be attached to another request purpose'
    );
});

test('private media-link rendering escapes the URL and label and omits both from metadata', () => {
  const url =
    'https://example.test/followup?token=synthetic-token&section=media-consent';
  const rendered = renderSponsorshipInformationRequestEmail({
    contributionId,
    recipient: 'payment-address@example.test',
    subject: 'Synthetic review',
    body: `Please review <these photos>:\n${url}`,
    idempotencyKey: 'synthetic-media-request',
    privateLink: { url, label: 'Review <photos>' }
  });
  assert.match(rendered.html, /&lt;these photos&gt;/);
  assert.match(
    rendered.html,
    /href="https:\/\/example.test\/followup\?token=synthetic-token&amp;section=media-consent"/
  );
  assert.match(rendered.html, />Review &lt;photos&gt;<\/a>/);
  assert.equal((rendered.html.match(/<a /g) ?? []).length, 1);
  assert.deepEqual(rendered.metadata, { contributionId });
});

test('private consent-link options require an authorized web base and a positive integral lifetime', () => {
  assert.equal(
    validSponsorshipMediaConsentAccessOptions({
      baseUrl: 'https://example.test',
      ttlDays: 30
    }),
    true
  );
  assert.equal(
    validSponsorshipMediaConsentAccessOptions({
      baseUrl: 'http://localhost:8080',
      ttlDays: 1
    }),
    true
  );
  for (const options of [
    undefined,
    {},
    { baseUrl: 'invalid', ttlDays: 30 },
    { baseUrl: 'javascript:invalid', ttlDays: 30 },
    { baseUrl: 'https://user:private@example.test', ttlDays: 30 },
    { baseUrl: 'https://example.test', ttlDays: 0 },
    { baseUrl: 'https://example.test', ttlDays: 1.5 },
    { baseUrl: 'https://example.test', ttlDays: Number.POSITIVE_INFINITY }
  ])
    assert.equal(validSponsorshipMediaConsentAccessOptions(options), false);
});
