import assert from 'node:assert/strict';
import test from 'node:test';

import { projectDossierAuthorizationNotice } from '../dist/apps/funding-web/src/app/features/funding/models/admin-dossier-authorization-notice.js';

const contributionId = 'synthetic-dossier';
const media = (overrides = {}) => ({
  id: 'synthetic-photo',
  contributionId,
  reviewStatus: 'pending_review',
  altText: 'A synthetic description',
  usage: { state: 'needs_confirmation' },
  ...overrides
});
const input = (overrides = {}) => ({
  contributionId,
  dossier: {
    contributionId,
    publicConsent: true,
    paymentStatus: 'paid',
    reviewStatus: 'approved'
  },
  media: null,
  canManage: true,
  canReview: false,
  ...overrides
});

test('missing publication consent preserves an independently available profile review', () => {
  assert.deepEqual(
    projectDossierAuthorizationNotice(
      input({
        dossier: { ...input().dossier, publicConsent: false },
        canReview: true
      })
    ),
    {
      publicConsentRequired: true,
      mediaConsentRequiredCount: 0,
      missingAltCount: 0,
      canReview: true
    }
  );
});

test('pending effective media permissions and preparable descriptions remain separate facts', () => {
  assert.deepEqual(
    projectDossierAuthorizationNotice(
      input({
        media: [
          media({ altText: '  ' }),
          media({
            id: 'second-photo',
            usage: { state: 'confirmed' },
            altText: null
          })
        ]
      })
    ),
    {
      publicConsentRequired: false,
      mediaConsentRequiredCount: 1,
      missingAltCount: 2,
      canReview: false
    }
  );
});

test('settled or withdrawn media do not imply consent awaited before approval', () => {
  for (const asset of [
    media({ reviewStatus: 'approved' }),
    media({ reviewStatus: 'rejected' }),
    media({ usage: { state: 'withdrawn' } }),
    media({ usage: { state: 'confirmed' } })
  ])
    assert.equal(
      projectDossierAuthorizationNotice(input({ media: [asset] })),
      null
    );
});

test('unknown, absent and historical optional permission facts do not produce an awaiting notice', () => {
  for (const assets of [null, [], [media({ usage: undefined })]])
    assert.equal(
      projectDossierAuthorizationNotice(input({ media: assets })),
      null
    );
});

test('a reader and an unavailable or foreign dossier never acquire an administrative waiting state', () => {
  for (const overrides of [
    { canManage: false },
    { dossier: null },
    {
      dossier: {
        ...input().dossier,
        contributionId: 'other-dossier',
        publicConsent: false
      }
    }
  ])
    assert.equal(
      projectDossierAuthorizationNotice(
        input({ media: [media()], ...overrides })
      ),
      null
    );
});

test('a mixed-scope media read is unavailable while independently loaded profile consent remains factual', () => {
  const assets = [media(), media({ contributionId: 'other-dossier' })];
  assert.equal(
    projectDossierAuthorizationNotice(input({ media: assets })),
    null
  );
  assert.deepEqual(
    projectDossierAuthorizationNotice(
      input({
        dossier: { ...input().dossier, publicConsent: false },
        media: assets
      })
    ),
    {
      publicConsentRequired: true,
      mediaConsentRequiredCount: 0,
      missingAltCount: 0,
      canReview: false
    }
  );
});

test('inactive payment and refused dossiers do not acquire an active authorization wait', () => {
  for (const status of ['pending', 'unpaid', 'refunded', 'disputed'])
    assert.equal(
      projectDossierAuthorizationNotice(
        input({
          dossier: {
            ...input().dossier,
            paymentStatus: status,
            publicConsent: false
          },
          media: [media()]
        })
      ),
      null
    );
  for (const reviewStatus of ['rejected', 'refused'])
    assert.equal(
      projectDossierAuthorizationNotice(
        input({
          dossier: { ...input().dossier, reviewStatus, publicConsent: false },
          media: [media()]
        })
      ),
      null
    );
});
