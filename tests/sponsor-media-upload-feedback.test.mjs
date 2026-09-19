import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  getSponsorMediaFileValidationFeedback,
  getSponsorMediaUploadFailureFeedback
} from '../dist/apps/funding-web/src/app/features/funding/services/sponsor-media-upload-feedback.js';

const limits = {
  maxUploadBytes: 8 * 1024 * 1024,
  maxSupportingImages: 3,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
};

test('media validation returns actionable feedback for empty, oversized and unsupported files', () => {
  assert.equal(
    getSponsorMediaFileValidationFeedback(
      { size: 1024, type: 'image/png' },
      limits
    ),
    null
  );
  assert.deepEqual(
    getSponsorMediaFileValidationFeedback(
      { size: 0, type: 'image/png' },
      limits
    ),
    { key: 'emptyFile' }
  );
  assert.deepEqual(
    getSponsorMediaFileValidationFeedback(
      { size: limits.maxUploadBytes + 1, type: 'image/jpeg' },
      limits
    ),
    { key: 'tooLarge', params: { size: 8 } }
  );
  assert.deepEqual(
    getSponsorMediaFileValidationFeedback(
      { size: 1024, type: 'image/gif' },
      limits
    ),
    { key: 'invalidType' }
  );
});

test('media API failures have safe localized feedback without exposing server content', () => {
  const cases = [
    [
      'Payment for this sponsorship is not confirmed yet.',
      'paymentUnconfirmed'
    ],
    ['The supporting image limit has been reached.', 'limit'],
    ['approved logo', 'approvedLogo'],
    ['follow-up was not found', 'expiredLink'],
    ['declared image type', 'invalidType'],
    ['too large', 'tooLarge'],
    ['private server diagnostic', 'uploadError']
  ];
  for (const [message, key] of cases) {
    const feedback = getSponsorMediaUploadFailureFeedback(
      new Error(message),
      limits
    );
    assert.equal(feedback.key, key);
    for (const locale of ['fr-CA', 'en']) {
      const catalog = JSON.parse(
        fs.readFileSync(
          'apps/funding-web/src/assets/i18n/' + locale + '.json',
          'utf8'
        )
      );
      assert.equal(typeof catalog.funding.followup.media[key], 'string');
    }
  }
});

test('reverse proxies allow configured sponsor media uploads and CSP previews', () => {
  const traefik = fs.readFileSync('traefik/dynamic.yml', 'utf8');
  const nginx = fs.readFileSync('apps/funding-web/nginx.conf', 'utf8');

  assert.ok(traefik.includes("img-src 'self' data: blob: https:"));
  assert.match(
    traefik,
    /openg7-sponsor-media-upload:[\s\S]*Path\(`\/api\/sponsorship-followup\/media`\)[\s\S]*sponsor-media-body-limit/
  );
  assert.match(
    traefik,
    /openg7-sponsor-media-upload-local:[\s\S]*Path\(`\/api\/sponsorship-followup\/media`\)[\s\S]*sponsor-media-body-limit/
  );
  assert.match(
    traefik,
    /sponsor-media-body-limit:[\s\S]*maxRequestBodyBytes: 9437184/
  );
  assert.match(
    nginx,
    /location = \/api\/sponsorship-followup\/media \{[\s\S]*client_max_body_size 9m;/
  );
});
