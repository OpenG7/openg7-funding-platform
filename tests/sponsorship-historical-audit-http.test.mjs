import assert from 'node:assert/strict';
import test from 'node:test';

import { createSponsorshipCommitmentsHttpHandler } from '../dist/apps/funding-api/src/sponsorship-commitments/admin-http.js';

const handler = (changes = {}) =>
  createSponsorshipCommitmentsHttpHandler({
    publicBaseOrigin: 'https://example.invalid',
    pool: { connect: () => assert.fail('No DB access expected') },
    readBody: () => assert.fail('No private body read expected'),
    ensureAdminAccess: () => true,
    canOwn: () => true,
    getAdminAuditActor: () => assert.fail('No actor read expected'),
    writeJson: (_request, response, status, payload) =>
      Object.assign(response, { status, payload }),
    ...changes
  });
const response = () => ({
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
  }
});
test('historical inventory and review require owner rights before database or body access', async () => {
  for (const method of ['GET', 'POST']) {
    const out = response();
    await handler({ canOwn: () => false })(
      {
        method,
        url: `/api/admin/sponsorship-commitments/historical-audit${method === 'POST' ? '/review' : ''}`,
        headers: { 'content-type': 'application/json' }
      },
      out
    );
    assert.equal(out.status, 403);
    assert.equal(out.payload.code, 'COMMITMENT_OWNER_REQUIRED');
    assert.equal(out.headers['Cache-Control'], 'no-store');
  }
});
test('missing or expired admin sessions stop the historical handler before permissions or persistence', async () => {
  const out = response();
  await handler({
    ensureAdminAccess: (_request, response) => {
      response.status = 401;
      return false;
    },
    canOwn: () => assert.fail('No role lookup without session')
  })(
    {
      method: 'GET',
      url: '/admin/sponsorship-commitments/historical-audit',
      headers: {}
    },
    out
  );
  assert.equal(out.status, 401);
});
test('historical audit validates duplicate and unsupported query options before database access', async () => {
  for (const query of [
    'pageSize=500',
    'pageSize=25&pageSize=50',
    'finding=duration_unverified&finding=snapshot_incomplete',
    'cursor=a&cursor=b',
    'secret=not-a-contract-field'
  ]) {
    const out = response();
    await handler()(
      {
        method: 'GET',
        url: `/admin/sponsorship-commitments/historical-audit?${query}`,
        headers: {}
      },
      out
    );
    assert.equal(out.status, 400);
    assert.equal(out.payload.code, 'HISTORICAL_AUDIT_INVALID');
  }
});
test('historical routes enforce methods and JSON rather than falling through to other commercial mutations', async () => {
  for (const [method, path, contentType, status] of [
    ['POST', 'historical-audit', 'application/json', 405],
    ['GET', 'historical-audit/review', undefined, 405],
    ['POST', 'historical-audit/review', 'text/plain', 415]
  ]) {
    const out = response();
    await handler()(
      {
        method,
        url: `/admin/sponsorship-commitments/${path}`,
        headers: { 'content-type': contentType }
      },
      out
    );
    assert.equal(out.status, status);
  }
  const out = response();
  await handler({ pool: null })(
    {
      method: 'GET',
      url: '/admin/sponsorship-commitments/historical-audit',
      headers: {}
    },
    out
  );
  assert.equal(out.status, 503);
});
