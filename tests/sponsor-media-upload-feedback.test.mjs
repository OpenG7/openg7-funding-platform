import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  getSponsorMediaFileValidationMessage,
  getSponsorMediaUploadFailureMessage
} from '../dist/apps/funding-web/src/app/features/funding/services/sponsor-media-upload-feedback.js';

const limits = {
  maxUploadBytes: 8 * 1024 * 1024,
  maxSupportingImages: 3,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
};

test('sponsor media file validation explains empty, oversized, and unsupported files', () => {
  assert.equal(
    getSponsorMediaFileValidationMessage(
      { size: 1024, type: 'image/png' },
      limits
    ),
    ''
  );
  assert.match(
    getSponsorMediaFileValidationMessage(
      { size: 0, type: 'image/png' },
      limits
    ),
    /fichier est vide/
  );
  assert.match(
    getSponsorMediaFileValidationMessage(
      { size: limits.maxUploadBytes + 1, type: 'image/jpeg' },
      limits
    ),
    /8\.0 Mo/
  );
  assert.match(
    getSponsorMediaFileValidationMessage(
      { size: 1024, type: 'image/gif' },
      limits
    ),
    /JPEG, PNG ou WebP/
  );
});

test('sponsor media upload failures translate API errors into clear French messages', () => {
  assert.match(
    getSponsorMediaUploadFailureMessage(
      new Error('Payment for this sponsorship is not confirmed yet.'),
      limits
    ),
    /paiement de cette commandite n'est pas encore confirmé/
  );
  assert.match(
    getSponsorMediaUploadFailureMessage(
      new Error('The supporting image limit has been reached.'),
      limits
    ),
    /limite de 3 photos/
  );
  assert.match(
    getSponsorMediaUploadFailureMessage(new Error('fetch failed'), limits),
    /Réessayez ou choisissez un autre fichier/
  );
});

test('sponsor follow-up renders dismissible upload thumbnails with accessible errors', () => {
  const component = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.ts',
    'utf8'
  );

  assert.ok(component.includes('mediaUploadAttempts'));
  assert.ok(component.includes('class="media-upload-attempt"'));
  assert.ok(component.includes('class="media-remove-action"'));
  assert.ok(component.includes('&times;'));
  assert.ok(component.includes("attempt.status === 'failed' ? 'alert'"));
  assert.ok(component.includes('URL.createObjectURL(file)'));
  assert.ok(component.includes('URL.revokeObjectURL(attempt.previewUrl)'));
});

test('sponsor follow-up disables media uploads until payment is confirmed', () => {
  const component = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.ts',
    'utf8'
  );

  assert.ok(component.includes('readonly canUploadMedia = computed'));
  assert.ok(component.includes('mediaUploadDisabledMessage'));
  assert.ok(component.includes('media-payment-note'));
  assert.ok(component.includes('Montant attendu'));
  assert.ok(component.includes('Paiement en confirmation'));
  assert.ok(
    component.includes('!canUploadMedia() || mediaBusy() || hasApprovedLogo()')
  );
  assert.ok(
    component.includes(
      '!canUploadMedia() ||\n                        mediaBusy() ||\n                        !canAddSupportingImage()'
    )
  );
  assert.ok(component.includes('if (!this.canUploadMedia())'));
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
