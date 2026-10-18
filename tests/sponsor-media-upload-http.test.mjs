import assert from 'node:assert/strict';
import test from 'node:test';
import { createSponsorMediaUploadHttpHandler } from '../dist/apps/funding-api/src/sponsor-media-upload.http.js';
import { SponsorMediaUploadError } from '../dist/apps/funding-api/src/sponsor-media-upload.service.js';
const contributionId = '10000000-0000-4000-8000-000000000901',
  requestId = '20000000-0000-4000-8000-000000000901';
const base = '/api/admin/sponsorships/media/upload',
  boundary = 'synthetic-media-upload';
function multipart(extra = []) {
  return Buffer.from(
    [
      ...Object.entries({
        requestId,
        contributionId,
        kind: 'supporting_image'
      }).map(
        ([name, value]) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      ),
      `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\nsynthetic binary data\r\n`,
      ...extra.map(
        (name) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\ninvalid\r\n`
      ),
      `--${boundary}--\r\n`
    ].join('')
  );
}
function fixture(overrides = {}) {
  const calls = [],
    output = { headers: {} };
  const handler = createSponsorMediaUploadHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAccess: () => true,
    canReview: () => true,
    getAdminAuditActor: () => 'synthetic-operator',
    readBodyBuffer: async (_req, max) => {
      calls.push(['body', max]);
      return multipart();
    },
    writeJson: (_req, _res, status, body) =>
      Object.assign(output, { status, body }),
    sponsorMediaMaxBytes: 1024,
    mediaUpload: {
      upload: async (...args) => {
        calls.push(['upload', ...args]);
        return { uploaded: true, asset: { id: 'synthetic-asset' } };
      }
    },
    ...overrides
  });
  return {
    calls,
    output,
    run: (
      method = 'POST',
      url = base,
      headers = { 'content-type': 'multipart/form-data; boundary=' + boundary }
    ) =>
      handler(
        { method, url, headers },
        { setHeader: (key, value) => (output.headers[key] = value) }
      )
  };
}
test('admin canonical upload protects both aliases before reading image bytes', async () => {
  for (const prefix of ['/admin', '/api/admin']) {
    const f = fixture({ canReview: () => false });
    await f.run('POST', prefix + '/sponsorships/media/upload');
    assert.equal(f.output.status, 403);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture({
    ensureAdminAccess: () => false,
    canReview: () => assert.fail('session bypass')
  });
  await f.run();
  assert.deepEqual(f.calls, []);
});
test('bounded multipart upload passes only the canonical schema and the server actor', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.output.status, 201);
  assert.equal(f.output.headers['Cache-Control'], 'private, no-store');
  assert.equal(f.calls[0][1], 1024 + 128 * 1024);
  const input = f.calls[1][1];
  assert.equal(input.requestId, requestId);
  assert.equal(input.contributionId, contributionId);
  assert.equal(input.kind, 'supporting_image');
  assert.equal(input.filename, 'synthetic.png');
  assert.equal(input.contentType, 'image/png');
  assert.equal(input.bytes.toString(), 'synthetic binary data');
  assert.equal(f.calls[1][2], 'synthetic-operator');
});
test('duplicate, unknown, nonmultipart and overbudget bodies cannot reach upload persistence', async () => {
  for (const extra of ['requestId', 'usage', 'confirmation', 'assetId']) {
    const f = fixture({ readBodyBuffer: async () => multipart([extra]) });
    await f.run();
    assert.equal(f.output.status, 400);
    assert.deepEqual(f.calls, []);
  }
  const oversized = fixture({
    readBodyBuffer: async () => {
      throw new Error('private body');
    }
  });
  await oversized.run();
  assert.equal(oversized.output.status, 413);
  assert.deepEqual(oversized.calls, []);
  const wrong = fixture();
  await wrong.run('POST', base, { 'content-type': 'application/json' });
  assert.equal(wrong.output.status, 415);
  assert.deepEqual(wrong.calls, []);
  for (const [method, url, status] of [
    ['GET', base, 405],
    ['POST', base + '?live=true', 400]
  ]) {
    const f = fixture();
    await f.run(method, url);
    assert.equal(f.output.status, status);
    assert.deepEqual(f.calls, []);
  }
});
test('uncertain outcomes expose only reconciliation ids and never private storage details', async () => {
  const f = fixture({
    mediaUpload: {
      upload: async () => {
        throw new SponsorMediaUploadError(
          'SPONSOR_MEDIA_UPLOAD_UNCONFIRMED',
          503,
          'synthetic-asset'
        );
      }
    }
  });
  await f.run();
  assert.deepEqual(f.output.body, {
    code: 'SPONSOR_MEDIA_UPLOAD_UNCONFIRMED',
    assetId: 'synthetic-asset',
    uploaded: null
  });
  const privateError = fixture({
    mediaUpload: {
      upload: async () => {
        throw new Error('secret storage path');
      }
    }
  });
  await privateError.run();
  assert.deepEqual(privateError.output.body, {
    code: 'SPONSOR_MEDIA_UPLOAD_UNAVAILABLE'
  });
});
