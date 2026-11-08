import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  mediaPreparationIssues,
  readMediaPreparation
} from '../dist/apps/funding-api/src/sponsor-media-workspace/preparation.js';
import { validatePlan } from '../dist/apps/funding-api/src/sponsor-media-workspace/policy.js';
import { createSponsorMediaWorkspaceHttpHandler } from '../dist/apps/funding-api/src/sponsor-media-workspace/http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity/policy.js';
import { recordModerationDecision } from '../dist/apps/funding-api/src/moderation/decision-commands.js';
import {
  validateMediaExport,
  createSponsorMediaExportHttpHandler
} from '../dist/apps/funding-api/src/sponsor-media-workspace/export.js';

const target = {
  id: randomUUID(),
  version: 1,
  channel: 'facebook',
  target: 'openg7',
  ordinal: 1,
  format: 'individual_portrait',
  state: 'pending',
  acceptsMedia: true,
  eligible: true,
  fingerprint: 'a'.repeat(64)
};
const asset = {
  kind: 'supporting_image',
  reviewStatus: 'pending_review',
  usageRestrictionsReviewed: false,
  moderation: { state: 'unreviewed' },
  readiness: {
    state: 'needs_review',
    reasons: ['MEDIA_HUMAN_REVIEW_REQUIRED']
  },
  usage: {
    state: 'confirmed',
    channels: ['facebook', 'website'],
    targets: ['openg7'],
    transformations: ['technical', 'portrait'],
    credit: null,
    restrictions: null
  }
};

test('private preparation permits pending human review without granting approval or publication', () => {
  assert.deepEqual(mediaPreparationIssues(asset, target), []);
  assert.equal(asset.reviewStatus, 'pending_review');
  const cases = [
    [{ ...asset, kind: 'logo' }, target, 'MEDIA_PREPARATION_KIND_UNSUPPORTED'],
    [
      asset,
      { ...target, eligible: false },
      'MEDIA_PREPARATION_DOSSIER_INELIGIBLE'
    ],
    [
      asset,
      { ...target, acceptsMedia: false },
      'MEDIA_PREPARATION_FORMAT_UNSUPPORTED'
    ],
    [
      { ...asset, reviewStatus: 'rejected' },
      target,
      'MEDIA_PREPARATION_REVIEW_RESTRICTED'
    ],
    [
      { ...asset, moderation: { state: 'correction_requested' } },
      target,
      'MEDIA_PREPARATION_REVIEW_RESTRICTED'
    ],
    [
      { ...asset, usage: undefined },
      target,
      'MEDIA_USAGE_CONFIRMATION_REQUIRED'
    ],
    [
      { ...asset, usage: { ...asset.usage, state: 'withdrawn' } },
      target,
      'MEDIA_USAGE_WITHDRAWN'
    ],
    [asset, { ...target, channel: 'linkedin' }, 'MEDIA_CHANNEL_NOT_AUTHORIZED'],
    [asset, { ...target, target: 'openg20' }, 'MEDIA_TARGET_NOT_AUTHORIZED'],
    [
      { ...asset, usage: { ...asset.usage, transformations: ['technical'] } },
      target,
      'MEDIA_TRANSFORMATION_NOT_AUTHORIZED'
    ],
    [
      {
        ...asset,
        usage: { ...asset.usage, restrictions: 'Private test restriction' }
      },
      target,
      'MEDIA_RESTRICTIONS_REVIEW_REQUIRED'
    ]
  ];
  for (const [candidate, obligation, expected] of cases)
    assert.ok(
      mediaPreparationIssues(candidate, obligation).includes(expected),
      expected
    );
});

test('preparation commands require an exact obligation version and reject target fields on unrelated actions', () => {
  const request = {
    requestId: randomUUID(),
    contributionId: randomUUID(),
    expectedRevision: '1',
    action: 'preparation_assign',
    assets: [{ id: randomUUID(), version: 'v1' }],
    targetObligationId: target.id,
    targetObligationVersion: 1
  };
  validatePlan(request);
  validatePlan({ ...request, action: 'preparation_unassign' });
  for (const change of [
    { targetObligationId: undefined },
    { targetObligationVersion: undefined },
    { targetObligationVersion: 0 },
    { targetObligationVersion: 1.2 },
    { targetObligationId: 'another-dossier' },
    { action: 'website_select' }
  ])
    assert.throws(() => validatePlan({ ...request, ...change }), {
      code: 'INVALID_MEDIA_PREPARATION_TARGET'
    });
});

test('missing preparation schema or grants cannot be represented as no assignments', async () => {
  for (const code of ['42P01', '42703', '42501'])
    await assert.rejects(
      readMediaPreparation(
        {
          query: async () => {
            throw Object.assign(new Error('synthetic unavailable schema'), {
              code
            });
          }
        },
        randomUUID()
      ),
      { code: 'MEDIA_PREPARATION_SCHEMA_REQUIRED', status: 503 }
    );
});

test('preparation plans retain native server role, session and strict body checks', async () => {
  const payload = {
    requestId: randomUUID(),
    contributionId: randomUUID(),
    expectedRevision: '1',
    action: 'preparation_assign',
    assets: [{ id: randomUUID(), version: 'v1' }],
    targetObligationId: target.id,
    targetObligationVersion: 1
  };
  for (const role of ['missing', 'reader', 'operator']) {
    let result;
    const calls = [];
    const handler = createSponsorMediaWorkspaceHttpHandler({
      publicBaseOrigin: 'https://example.test',
      pool: {},
      service: {
        async plan(input, actor) {
          validatePlan(input);
          calls.push({ input, actor });
          return { id: 'synthetic-plan', blocked: [] };
        }
      },
      ensureAdminAccess: () => {
        if (role !== 'missing') return true;
        result = { status: 401 };
        return false;
      },
      canReview: () => role === 'operator',
      getAdminAuditActor: () => 'synthetic-operator',
      readBody: async (request) => request.body,
      writeJson: (_request, _response, status, body) => {
        result = { status, body };
      }
    });
    const invoke = async (body) =>
      handler(
        {
          url: '/api/admin/sponsorships/media/batch/plan',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        },
        { setHeader() {} }
      );
    await invoke(payload);
    assert.equal(
      result.status,
      role === 'missing' ? 401 : role === 'reader' ? 403 : 200
    );
    assert.equal(calls.length, role === 'operator' ? 1 : 0);
    if (role === 'operator') {
      assert.deepEqual(calls[0], {
        input: payload,
        actor: 'synthetic-operator'
      });
      await invoke({ ...payload, actor: 'spoofed' });
      assert.equal(result.status, 400);
      assert.equal(calls.length, 1);
    }
  }
  assert.equal(
    adminRoleAllows(
      'reader',
      'POST',
      '/api/admin/sponsorships/media/batch/plan'
    ),
    false
  );
  assert.equal(
    adminRoleAllows(
      'operator',
      'POST',
      '/api/admin/sponsorships/media/batch/execute'
    ),
    true
  );
});

test('deferred notifications are internal to media N1 and cannot weaken other moderation decisions', async () => {
  const subject = { type: 'media', id: randomUUID() };
  const decision = {
    requestId: randomUUID(),
    policyVersion: '1.0',
    contentVersion: 1,
    contentFingerprint: 'a'.repeat(64),
    confirmation: subject.id,
    level: 'N1',
    primaryReason: 'EDITORIAL_INCOMPATIBILITY',
    editorialProvision: 'recognition-scope',
    internalReason: 'Synthetic correction rationale',
    sponsorExplanation: 'A synthetic replacement image is needed.'
  };
  let calls = 0;
  const db = {
    query: async () => {
      calls++;
      throw new Error('Unexpected database access');
    }
  };
  for (const change of [
    { subject: { ...subject, type: 'sponsorship' } },
    { decision: { ...decision, level: 'N2' } },
    { notification: 'skip' },
    { resolvingAppealId: randomUUID() }
  ])
    await assert.rejects(
      recordModerationDecision(db, {
        subject,
        decision,
        actor: 'synthetic-reviewer',
        notification: 'deferred',
        ...change
      }),
      { code: 'MODERATION_NOTIFICATION_SCOPE_INVALID' }
    );
  assert.equal(calls, 0);
});

test('private export is a confirmed POST with session and role protection, never a permanent private URL', async () => {
  const assetId = randomUUID();
  const input = {
    requestId: randomUUID(),
    contributionId: randomUUID(),
    assetId,
    expectedVersion: 'synthetic-version',
    confirmation: assetId
  };
  validateMediaExport(input);
  for (const change of [
    { confirmation: false },
    { expectedVersion: '' },
    { token: 'unexpected' }
  ])
    assert.throws(() => validateMediaExport({ ...input, ...change }), {
      code: 'INVALID_MEDIA_EXPORT'
    });
  for (const role of ['missing', 'reader', 'operator']) {
    let result;
    let calls = 0;
    const handler = createSponsorMediaExportHttpHandler({
      publicBaseOrigin: 'https://example.test',
      service: {
        async export(payload, actor) {
          calls++;
          assert.deepEqual(payload, input);
          assert.equal(actor, 'synthetic-reviewer');
          return {
            bytes: Buffer.from('synthetic-webp'),
            mimeType: 'image/webp',
            filename: `media-${assetId}.webp`,
            checksum: 'a'.repeat(64)
          };
        }
      },
      ensureAdminAccess: () => {
        if (role !== 'missing') return true;
        result = { status: 401 };
        return false;
      },
      canReview: () => role === 'operator',
      getAdminAuditActor: () => 'synthetic-reviewer',
      readBody: async (request) => request.body,
      writeJson: (_request, _response, status, body) => {
        result = { status, body };
      },
      writeBinary: (_request, _response, status, bytes, mimeType, headers) => {
        result = { status, bytes, mimeType, headers };
      }
    });
    const invoke = async (method = 'POST', body = input) =>
      handler(
        {
          url: '/api/admin/sponsorships/media/export',
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        },
        { setHeader() {} }
      );
    await invoke();
    assert.equal(
      result.status,
      role === 'missing' ? 401 : role === 'reader' ? 403 : 200
    );
    assert.equal(calls, role === 'operator' ? 1 : 0);
    if (role === 'operator') {
      assert.equal(result.mimeType, 'image/webp');
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      assert.ok(
        result.headers['Content-Disposition'].startsWith('attachment;')
      );
      await invoke('GET');
      assert.equal(result.status, 405);
      await invoke('POST', { ...input, confirmation: '' });
      assert.equal(result.status, 400);
      assert.equal(calls, 1);
    }
  }
  assert.equal(
    adminRoleAllows('reader', 'POST', '/api/admin/sponsorships/media/export'),
    false
  );
  assert.equal(
    adminRoleAllows('operator', 'POST', '/api/admin/sponsorships/media/export'),
    true
  );
});
