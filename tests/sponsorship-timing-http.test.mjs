import assert from 'node:assert/strict';
import test from 'node:test';
import { createSponsorshipTimingHttpHandler } from '../dist/apps/funding-api/src/sponsorship-timing/admin-http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
const response = () => ({
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
  }
});
function handler(options = {}) {
  return createSponsorshipTimingHttpHandler({
    publicBaseOrigin: 'https://example.invalid',
    pool: { query: () => assert.fail('No DB access expected') },
    ensureAdminAccess: () => true,
    canOwn: () => true,
    getAdminAuditActor: () => assert.fail('No actor expected'),
    readBody: async () => assert.fail('No body expected'),
    writeJson: (_req, res, status, payload) =>
      Object.assign(res, { status, payload }),
    ...options
  });
}
test('timing owner gate and identity policy protect both API route prefixes before private reads', async () => {
  for (const prefix of ['/admin', '/api/admin']) {
    for (const role of ['reader', 'operator'])
      assert.equal(
        adminRoleAllows(
          role,
          'POST',
          prefix + '/sponsorship-commitments/timing'
        ),
        false
      );
    const res = response();
    assert.equal(
      await handler({ canOwn: () => false })(
        {
          url: prefix + '/sponsorship-commitments/timing',
          method: 'POST',
          headers: {}
        },
        res
      ),
      true
    );
    assert.equal(res.status, 403);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});
test('timing commands require POST, PostgreSQL and bounded JSON without pretending to change visibility', async () => {
  const request = {
    url: '/api/admin/sponsorship-commitments/timing',
    method: 'POST',
    headers: {}
  };
  const get = response();
  await handler()({ ...request, method: 'GET' }, get);
  assert.equal(get.status, 405);
  const unavailable = response();
  await handler({ pool: null })(request, unavailable);
  assert.equal(unavailable.status, 503);
  const noJson = response();
  await handler()(request, noJson);
  assert.equal(noJson.status, 415);
  const malformed = response();
  await handler({
    readBody: async (_req, limit) => {
      assert.equal(limit, 12 * 1024);
      return '{';
    }
  })(
    { ...request, headers: { 'content-type': 'application/json' } },
    malformed
  );
  assert.equal(malformed.status, 400);
  assert.equal(malformed.payload.code, 'TIMING_INVALID');
});
test('timing handler leaves other routes untouched and respects access denial', async () => {
  assert.equal(
    await handler()(
      { url: '/admin/sponsorship-commitments', method: 'GET', headers: {} },
      response()
    ),
    false
  );
  assert.equal(
    await handler({ ensureAdminAccess: () => false })(
      {
        url: '/admin/sponsorship-commitments/timing',
        method: 'POST',
        headers: {}
      },
      response()
    ),
    true
  );
});
