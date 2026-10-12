import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminModerationHttpHandler } from '../dist/apps/funding-api/src/moderation/admin-http.js';
import { createPublicModerationHttpHandler } from '../dist/apps/funding-api/src/moderation/public-http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity/policy.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';
import { validateCharterAcceptance } from '../dist/apps/funding-api/src/moderation/charter.js';
import { resolveModerationReconsideration } from '../dist/apps/funding-api/src/moderation/reconsiderations.js';

const origin = 'https://funding.example.test';
const id = '11111111-1111-4111-8111-111111111111';
const request = (
  url,
  method = 'GET',
  body = {},
  contentType = 'application/json'
) =>
  Object.assign(Readable.from([JSON.stringify(body)]), {
    url,
    method,
    headers: { 'content-type': contentType }
  });
const response = () => ({
  headers: {},
  setHeader(key, value) {
    this.headers[key] = value;
  }
});
const writeJson = (_request, result, status, payload) =>
  Object.assign(result, { status, payload });

test('reconsideration N0 requires an external explanation before any storage access and no refusal reason code', async () => {
  const db = {
    query() {
      assert.fail('Empty resolution must not read or write storage.');
    }
  };
  for (const sponsorExplanation of [undefined, null, '', '   '])
    await assert.rejects(
      resolveModerationReconsideration(db, {
        appealId: id,
        subject: { type: 'sponsorship', id },
        actor: `admin:${id}`,
        decision: {
          requestId: id,
          policyVersion: '1.0',
          contentVersion: 1,
          contentFingerprint: 'a'.repeat(64),
          level: 'N0',
          sponsorExplanation,
          confirmation: id
        }
      }),
      { code: 'MODERATION_EXPLANATION_REQUIRED', status: 400 }
    );
});

test('reader cannot inspect any moderation proof, decisions or reconsideration even through GET aliases', async () => {
  for (const path of [
    'content',
    'assistance',
    'cases',
    'decisions',
    'reconsiderations',
    'metrics',
    'adoption-preview',
    'retention-preview',
    'remote-removals'
  ]) {
    for (const prefix of ['/admin/', '/api/admin/']) {
      assert.equal(
        adminRoleAllows('reader', 'GET', `${prefix}moderation/${path}`),
        false
      );
      let bodyReads = 0;
      const handler = createAdminModerationHttpHandler({
        publicBaseOrigin: origin,
        pool: {
          connect() {
            assert.fail('Reader must not reach storage.');
          }
        },
        ensureAdminAccess: () => true,
        canReview: () => false,
        getAdminAuditActor: () => 'reader',
        readBody: async () => {
          bodyReads++;
          return '{}';
        },
        writeJson
      });
      const result = response();
      assert.equal(
        await handler(request(`${prefix}moderation/${path}`), result),
        true
      );
      assert.equal(result.status, 403);
      assert.equal(result.payload.code, 'MODERATION_REVIEWER_REQUIRED');
      assert.equal(bodyReads, 0);
    }
  }
});

test('operator permissions allow named moderation actions and refuse unknown mutations', () => {
  for (const path of [
    'decisions',
    'independent-review',
    'reconsiderations/resolve'
  ])
    assert.equal(
      adminRoleAllows('operator', 'POST', `/api/admin/moderation/${path}`),
      true
    );
  assert.equal(
    adminRoleAllows(
      'operator',
      'POST',
      '/api/admin/moderation/policy/activate'
    ),
    false
  );
  assert.equal(
    adminRoleAllows('reader', 'POST', '/api/admin/moderation/decisions'),
    false
  );
  for (const path of [
    'adoption-preview',
    'retention-preview',
    'assignment',
    'charter-preview'
  ]) {
    const method = path === 'assignment' ? 'POST' : 'GET';
    assert.equal(
      adminRoleAllows('operator', method, `/api/admin/moderation/${path}`),
      false
    );
    assert.equal(
      adminRoleAllows('owner', method, `/api/admin/moderation/${path}`),
      true
    );
  }
});

test('owner-only moderation previews reject operators before any storage access', async () => {
  const handler = createAdminModerationHttpHandler({
    publicBaseOrigin: origin,
    pool: {
      connect() {
        assert.fail('Operator must not reach the private preview.');
      }
    },
    ensureAdminAccess: () => true,
    canReview: () => true,
    canOwn: () => false,
    getAdminAuditActor: () => `admin:${id}`,
    readBody,
    writeJson
  });
  for (const path of ['adoption-preview', 'retention-preview', 'assignment']) {
    const result = response();
    await handler(
      request(
        `/api/admin/moderation/${path}`,
        path === 'assignment' ? 'POST' : 'GET'
      ),
      result
    );
    assert.equal(result.status, 403);
    assert.equal(result.payload.code, 'MODERATION_OWNER_REQUIRED');
    assert.equal(result.headers['Cache-Control'], 'no-store');
  }
});

test('the owner can review exact charter candidates without activating or accepting them', async () => {
  const queries = [];
  const handler = createAdminModerationHttpHandler({
    publicBaseOrigin: origin,
    pool: {
      connect: async () => ({
        query: async (sql) => {
          queries.push(sql);
          if (sql.startsWith('SELECT public_active'))
            return {
              rows: [
                {
                  public_active: false,
                  public_validated_at: null,
                  effective_at: null
                }
              ]
            };
          assert.ok(sql.startsWith('BEGIN') || sql === 'COMMIT');
          return { rows: [] };
        },
        release() {}
      })
    },
    ensureAdminAccess: () => true,
    canReview: () => true,
    canOwn: () => true,
    getAdminAuditActor: () => `admin:${id}`,
    readBody: async () => assert.fail('The preview is a read.'),
    writeJson
  });
  const result = response();
  await handler(request('/api/admin/moderation/charter-preview'), result);
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.payload.active, false);
  assert.equal(result.payload.recognitionTerms.status, 'proposed');
  assert.match(result.payload.charter.fingerprint, /^[a-f0-9]{64}$/);
  assert.match(result.payload.recognitionTerms.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(result.payload.charter.text.fr.includes('déshumanisation'));
  assert.ok(
    result.payload.recognitionTerms.text.en.includes('No delivery deadline')
  );
  assert.equal(queries[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(
    adminRoleAllows('operator', 'GET', '/api/admin/moderation/charter-preview'),
    false
  );
  assert.equal(
    adminRoleAllows('reader', 'GET', '/api/admin/moderation/charter-preview'),
    false
  );
});

test('admin moderation rejects non-JSON and malformed subject before any domain mutation', async () => {
  const writes = [];
  const handler = createAdminModerationHttpHandler({
    publicBaseOrigin: origin,
    pool: {
      async connect() {
        return {
          async query(sql) {
            writes.push(sql);
            return { rows: [] };
          },
          release() {}
        };
      }
    },
    ensureAdminAccess: () => true,
    canReview: () => true,
    getAdminAuditActor: () => `admin:${id}`,
    readBody,
    writeJson
  });
  const json = response();
  await handler(
    request('/api/admin/moderation/decisions', 'POST', {}, 'text/plain'),
    json
  );
  assert.equal(json.status, 415);
  assert.deepEqual(writes, []);
  const invalid = response();
  await handler(
    request(
      '/api/admin/moderation/content?subjectType=media&subjectId=foreign'
    ),
    invalid
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, 'INVALID_MODERATION_SUBJECT');
  assert.deepEqual(writes, []);
});

test('private moderation routes enforce JSON, avoid accepting injected actor or state, and use no-store', async () => {
  const handler = createPublicModerationHttpHandler({
    publicBaseOrigin: origin,
    pool: {
      connect() {
        assert.fail('Invalid input must not reach storage.');
      }
    },
    ttlDays: 30,
    readBody,
    writeJson
  });
  for (const path of ['correction', 'reconsideration']) {
    const unsupported = response();
    await handler(
      request(`/api/sponsorship-followup/${path}`, 'POST', {}, 'text/plain'),
      unsupported
    );
    assert.equal(unsupported.status, 415);
    assert.equal(unsupported.headers['Cache-Control'], 'no-store');
    const invalid = response();
    await handler(
      request(`/api/sponsorship-followup/${path}`, 'POST', {
        token: 'a'.repeat(43),
        actor: `admin:${id}`,
        state: 'approved'
      }),
      invalid
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.payload.code, 'INVALID_MODERATION_REQUEST');
  }
});

test('inactive public charter returns no proposed terms or artificial acceptance fingerprint', async () => {
  const handler = createPublicModerationHttpHandler({
    publicBaseOrigin: origin,
    pool: {
      async query() {
        return {
          rows: [
            { public_active: false, eligible: false, public_charter_hash: null }
          ]
        };
      }
    },
    ttlDays: 30,
    readBody,
    writeJson
  });
  const result = response();
  await handler(request('/api/sponsorship-charter'), result);
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, {
    active: false,
    policyVersion: '1.0',
    fingerprint: null,
    text: null
  });
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('charter acceptance has a stable hash input regardless of JSON property order and rejects injected evidence', () => {
  const acceptance = {
    accepted: true,
    policyVersion: '1.0',
    fingerprint: 'a'.repeat(64),
    locale: 'en'
  };
  const reordered = {
    locale: 'en',
    fingerprint: acceptance.fingerprint,
    policyVersion: '1.0',
    accepted: true
  };
  assert.equal(
    JSON.stringify(validateCharterAcceptance(acceptance)),
    JSON.stringify(validateCharterAcceptance(reordered))
  );
  for (const input of [
    { ...acceptance, acceptedAt: 'synthetic' },
    { ...acceptance, policyVersion: '' },
    { ...acceptance, locale: ['en'] },
    { ...acceptance, accepted: false }
  ]) {
    assert.throws(() => validateCharterAcceptance(input), {
      code: 'CHARTER_ACCEPTANCE_INVALID',
      status: 400
    });
  }
});
