import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { SPONSORSHIP_PUBLIC_CONSENT_SCOPE } from '../dist/packages/funding-core/src/admin-sponsorship-consent.js';
import { parseSponsorshipConsent } from '../dist/apps/funding-api/src/admin-sponsorship-consent-policy.js';
import { AdminSponsorshipConsentService } from '../dist/apps/funding-api/src/admin-sponsorship-consent.service.js';
import { createAdminSponsorshipConsentHttpHandler } from '../dist/apps/funding-api/src/admin-sponsorship-consent.http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity/policy.js';

const request = () => ({
  contributionId: randomUUID(),
  expectedVersion: '2026-11-01 12:00:00.123456+00',
  requestId: randomUUID(),
  agreementReceived: true,
  scope: SPONSORSHIP_PUBLIC_CONSENT_SCOPE,
  agreedOn: '2026-10-31',
  evidenceReference: 'Synthetic agreement reference A-1',
  confirmed: true
});

test('documented consent validates one fixed scope and a real civil date', () => {
  const input = request();
  assert.deepEqual(parseSponsorshipConsent(input), input);
  assert.equal(
    parseSponsorshipConsent({
      ...input,
      evidenceReference: '  Synthetic written reference  '
    }).evidenceReference,
    'Synthetic written reference'
  );
  for (const altered of [
    null,
    [],
    { ...input, actor: 'forged-actor' },
    { ...input, confirmed: false },
    { ...input, agreementReceived: false },
    { ...input, scope: 'all_social_publications' },
    { ...input, contributionId: 'invalid' },
    { ...input, requestId: 'invalid' },
    { ...input, expectedVersion: '' },
    { ...input, agreedOn: '2026-02-30' },
    { ...input, agreedOn: '0000-01-01' },
    { ...input, agreedOn: '2026-11-01T00:00:00Z' },
    { ...input, evidenceReference: '  ' },
    { ...input, evidenceReference: 'x'.repeat(1001) },
    { ...input, evidenceReference: 'reference\nwith hidden control' }
  ]) {
    assert.throws(() => parseSponsorshipConsent(altered), {
      code: 'CONSENT_INVALID_REQUEST',
      status: 400
    });
  }
});

test('reader sees facts without private evidence or actors; operator sees the explicit history', async () => {
  const id = randomUUID();
  const privateReference = 'Synthetic private proof never returned to readers';
  const pool = {
    async query(sql) {
      if (sql.includes('WITH relation'))
        return {
          rows: [{ compatible: true, can_read: true, can_insert: true }]
        };
      if (sql.includes('updated_at::text AS version'))
        return {
          rows: [{ version: 'v1', effective: true, today: '2026-11-07' }]
        };
      if (sql.includes('SELECT id,agreed_on::text'))
        return {
          rows: [
            {
              id: randomUUID(),
              agreed_on: '2026-11-01',
              evidence_reference: privateReference,
              recorded_at: new Date('2026-11-02T12:00:00Z'),
              actor: 'synthetic-original-recorder'
            }
          ]
        };
      if (sql.includes('WITH related'))
        return { rows: [{ processing: false, uncertain: false }] };
      return { rows: [] };
    },
    async connect() {
      return { query: (...args) => pool.query(...args), release() {} };
    }
  };
  const service = new AdminSponsorshipConsentService(pool);
  const reader = await service.read(id, 'synthetic-reader', false);
  assert.equal(reader.effectiveConsent, true);
  assert.equal(reader.source, 'documented_agreement');
  assert.equal(reader.canRecord, false);
  assert.equal('history' in reader, false);
  assert.equal('recordingActor' in reader, false);
  assert.equal(JSON.stringify(reader).includes(privateReference), false);
  const operator = await service.read(id, 'synthetic-current-operator', true);
  assert.equal(operator.recordingActor, 'synthetic-current-operator');
  assert.equal(operator.history[0].evidenceReference, privateReference);
  assert.equal(operator.history[0].actor, 'synthetic-original-recorder');
  assert.deepEqual(operator.recordBlockers, ['already_granted']);
});

test('service rejects a reader before any database command', async () => {
  const service = new AdminSponsorshipConsentService({
    query() {
      throw new Error('Unexpected database access');
    }
  });
  await assert.rejects(service.record(request(), 'synthetic-reader', false), {
    code: 'CONSENT_PERMISSION_REQUIRED',
    status: 403
  });
  await assert.rejects(
    service.receipt(randomUUID(), randomUUID(), 'synthetic-reader', false),
    {
      code: 'CONSENT_PERMISSION_REQUIRED',
      status: 403
    }
  );
});

test('roles expose minimal reads and protect commands and receipt reconciliation', () => {
  for (const role of ['reader', 'operator', 'owner']) {
    assert.equal(
      adminRoleAllows(role, 'GET', '/api/admin/sponsorships/consent'),
      true
    );
    assert.equal(
      adminRoleAllows(role, 'POST', '/api/admin/sponsorships/consent/record'),
      role !== 'reader'
    );
    assert.equal(
      adminRoleAllows(role, 'GET', '/api/admin/sponsorships/consent/receipt'),
      role !== 'reader'
    );
  }
});

test('consent transport validates exact query, authentication, reviewer, method and safe errors', async () => {
  const id = randomUUID();
  let accesses = 0;
  let authenticated = true;
  let reviewer = true;
  let body = '{}';
  let result;
  const handler = createAdminSponsorshipConsentHttpHandler({
    publicBaseOrigin: 'https://synthetic.invalid',
    service: {
      async read() {
        accesses++;
        return { effectiveConsent: false };
      },
      async record() {
        accesses++;
        throw new Error('PRIVATE DATABASE DIAGNOSTIC');
      },
      async receipt() {
        accesses++;
        return { state: 'not_found' };
      }
    },
    ensureAdminAccess: () => authenticated,
    canRecord: () => reviewer,
    getAdminAuditActor: () => 'synthetic-current-actor',
    readBody: async () => body,
    writeJson: (_req, _res, status, payload) => {
      result = { status, payload };
    }
  });
  const call = async (url, method = 'GET', headers = {}) => {
    result = undefined;
    return handler({ url, method, headers }, { setHeader() {} });
  };
  authenticated = false;
  await call('/api/admin/sponsorships/consent?sponsorshipId=' + id);
  assert.equal(accesses, 0);
  authenticated = true;
  await call('/api/admin/sponsorships/consent?sponsorshipId=' + id);
  assert.equal(result.status, 200);
  await call(
    '/api/admin/sponsorships/consent?sponsorshipId=' +
      id +
      '&sponsorshipId=' +
      id
  );
  assert.equal(result.status, 400);
  await call('/api/admin/sponsorships/consent/record', 'GET');
  assert.equal(result.status, 405);
  reviewer = false;
  await call('/api/admin/sponsorships/consent/record', 'POST');
  assert.equal(result.status, 403);
  reviewer = true;
  await call('/api/admin/sponsorships/consent/record', 'POST', {
    'content-type': 'text/plain'
  });
  assert.equal(result.status, 415);
  body = '{';
  await call('/api/admin/sponsorships/consent/record', 'POST', {
    'content-type': 'application/json'
  });
  assert.equal(result.status, 400);
  body = JSON.stringify(request());
  await call('/api/admin/sponsorships/consent/record', 'POST', {
    'content-type': 'application/json'
  });
  assert.deepEqual(result, {
    status: 503,
    payload: { code: 'CONSENT_UNAVAILABLE' }
  });
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
