import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicSponsorMediaHttpHandler } from '../dist/apps/funding-api/src/public-sponsor-media.http.js';

const origin = 'https://funding.example.test';
const contributionId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const filename = `sponsor-logo-${contributionId}-1727188800000-0123456789abcdef.png`;
const logoUrl = `/api/public/sponsor-logos/${filename}`;
const bytes = Buffer.from('synthetic-public-image');

const fixture = ({
  databaseAvailable = true,
  results = {},
  failures = {}
} = {}) => {
  const calls = [];
  const call = async (name, value, fallback) => {
    calls.push({ name, value });
    if (failures[name]) throw failures[name];
    return Object.hasOwn(results, name) ? results[name] : fallback;
  };
  const handler = createPublicSponsorMediaHttpHandler({
    databaseAvailable: () => databaseAvailable,
    writeJson: (_request, response, status, payload) => {
      calls.push({ name: 'json', value: status });
      Object.assign(response, { status, payload });
    },
    writeBinary: (
      _request,
      response,
      status,
      payload,
      contentType,
      headers
    ) => {
      calls.push({ name: 'binary', value: { status, contentType } });
      Object.assign(response, { status, payload, contentType });
      Object.assign(response.headers, headers);
    },
    routeAssetId: (url, ...prefixes) => {
      try {
        const path = new URL(url, origin).pathname;
        const prefix = prefixes.find((entry) => path.startsWith(entry));
        const id = prefix ? decodeURIComponent(path.slice(prefix.length)) : '';
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id
        )
          ? id
          : null;
      } catch {
        return null;
      }
    },
    getApprovedPublicSponsorMedia: (id) =>
      call('approvedMedia', id, {
        id,
        processedStorageKey: 'synthetic/private.webp',
        publicStorageKey: null
      }),
    sponsorMediaStorage: {
      readPrivateObject: (key) => call('privateRead', key, bytes),
      readPublicObject: () => assert.fail('Public bucket reads are forbidden.')
    },
    getSponsorLogoFilenameFromUrl: (url) => {
      try {
        const path = new URL(url, origin).pathname;
        const prefix = [
          '/api/public/sponsor-logos/',
          '/public/sponsor-logos/'
        ].find((entry) => path.startsWith(entry));
        return prefix ? decodeURIComponent(path.slice(prefix.length)) : null;
      } catch {
        return null;
      }
    },
    sponsorLogoPublicUrlForFilename: (file) =>
      `/api/public/sponsor-logos/${file}`,
    isPublicApprovedSponsorshipLogoUrl: (url) =>
      call('approvedLogo', url, true),
    sponsorLogoStorage: { readLogo: (file) => call('logoRead', file, bytes) },
    reportFailure: (...args) => calls.push({ name: 'report', value: args })
  });
  return {
    calls,
    names: () => calls.map((entry) => entry.name),
    values: (name) =>
      calls.filter((entry) => entry.name === name).map((entry) => entry.value),
    async run(url, method = 'GET') {
      const request = { url, method, headers: {} };
      const response = { headers: {} };
      const handled = await handler(request, response);
      return { handled, ...response };
    }
  };
};

test('eligible public media reads private processed bytes without a public copy and retains no-store through both aliases', async (t) => {
  for (const prefix of [
    '/public/sponsor-media/',
    '/api/public/sponsor-media/'
  ]) {
    await t.test(prefix, async () => {
      const f = fixture();
      const result = await f.run(
        prefix + assetId.replaceAll('-', '%2D') + '?image=1'
      );
      assert.equal(result.handled, true);
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, bytes);
      assert.equal(result.contentType, 'image/webp');
      assert.deepEqual(result.headers, { 'Cache-Control': 'no-store' });
      assert.deepEqual(f.values('approvedMedia'), [assetId]);
      assert.deepEqual(f.values('privateRead'), ['synthetic/private.webp']);
      assert.deepEqual(f.names(), ['approvedMedia', 'privateRead', 'binary']);
    });
  }
});

test('missing, unapproved or unreadable public media reveals only safe 404 errors', async (t) => {
  const error = new Error('Synthetic public storage failure.');
  for (const options of [
    { results: { approvedMedia: null } },
    { results: { privateRead: null } },
    { failures: { approvedMedia: error } },
    { failures: { privateRead: error } }
  ]) {
    await t.test(JSON.stringify(Object.keys(options)), async () => {
      const f = fixture(options);
      const result = await f.run('/api/public/sponsor-media/' + assetId);
      assert.equal(result.handled, true);
      assert.equal(result.status, 404);
      assert.deepEqual(result.payload, { error: 'Not found' });
      assert.deepEqual(result.headers, {});
      if (Object.hasOwn(options.results ?? {}, 'approvedMedia'))
        assert.deepEqual(f.values('privateRead'), []);
      if (options.failures)
        assert.deepEqual(f.values('report'), [
          ['Failed to serve public sponsor media.', error]
        ]);
    });
  }
});

test('legacy public keys are ignored and a revoked dossier is checked again before reading private bytes', async () => {
  const results = {
    approvedMedia: {
      id: assetId,
      processedStorageKey: 'synthetic/private.webp',
      publicStorageKey: 'legacy/public.webp',
      publicUrl: 'https://cdn.example.test/legacy.webp'
    }
  };
  const f = fixture({
    results
  });
  assert.equal(
    (await f.run('/api/public/sponsor-media/' + assetId)).status,
    200
  );
  assert.deepEqual(f.values('privateRead'), ['synthetic/private.webp']);
  results.approvedMedia = null;
  assert.equal(
    (await f.run('/api/public/sponsor-media/' + assetId)).status,
    404
  );
  assert.deepEqual(f.values('approvedMedia'), [assetId, assetId]);
  assert.deepEqual(f.values('privateRead'), ['synthetic/private.webp']);
});

test('approved controlled logos preserve canonical approval URL and one-day public caching', async (t) => {
  for (const prefix of [
    '/public/sponsor-logos/',
    '/api/public/sponsor-logos/'
  ]) {
    await t.test(prefix, async () => {
      const f = fixture();
      const result = await f.run(prefix + filename + '?image=1');
      assert.equal(result.handled, true);
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, bytes);
      assert.equal(result.contentType, 'image/png');
      assert.deepEqual(result.headers, {
        'Cache-Control': 'public, max-age=86400'
      });
      assert.deepEqual(f.values('approvedLogo'), [logoUrl]);
      assert.deepEqual(f.values('logoRead'), [filename]);
      assert.deepEqual(f.names(), ['approvedLogo', 'logoRead', 'binary']);
    });
  }
});

test('logo exposure requires database availability, controlled filename and approval before reading bytes', async (t) => {
  for (const [options, path, expectedNames] of [
    [{ databaseAvailable: false }, filename, ['json']],
    [{}, 'uncontrolled.png', ['json']],
    [{}, filename.replace('.png', '.svg'), ['json']],
    [{ results: { approvedLogo: false } }, filename, ['approvedLogo', 'json']],
    [
      { results: { logoRead: null } },
      filename,
      ['approvedLogo', 'logoRead', 'json']
    ]
  ]) {
    await t.test(path + JSON.stringify(options), async () => {
      const f = fixture(options);
      const result = await f.run('/public/sponsor-logos/' + path);
      assert.equal(result.handled, true);
      assert.equal(result.status, 404);
      assert.deepEqual(result.payload, { error: 'Not found' });
      assert.deepEqual(result.headers, {});
      assert.deepEqual(f.names(), expectedNames);
    });
  }
});

test('public logo dependency failures retain 404 and are never retried', async (t) => {
  const error = new Error('Synthetic logo dependency failure.');
  for (const operation of ['approvedLogo', 'logoRead']) {
    await t.test(operation, async () => {
      const f = fixture({ failures: { [operation]: error } });
      const result = await f.run(logoUrl);
      assert.equal(result.status, 404);
      assert.deepEqual(result.payload, { error: 'Not found' });
      assert.deepEqual(f.values('report'), [
        ['Failed to serve sponsor logo.', error]
      ]);
      assert.equal(f.values(operation).length, 1);
    });
  }
});

test('unowned methods, malformed asset paths, private previews and unrelated requests fall through without reads', async (t) => {
  for (const [url, method] of [
    ['/public/sponsor-media/' + assetId, 'POST'],
    [logoUrl, 'POST'],
    ['/public/sponsor-media/invalid', 'GET'],
    ['/public/sponsor-media/' + assetId + '/extra', 'GET'],
    ['/public/sponsor-media/%ZZ', 'GET'],
    ['/public/sponsor-logos/', 'GET'],
    ['/public/sponsor-logos/%ZZ', 'GET'],
    ['/admin/sponsorships/logo', 'GET'],
    ['/sponsorship-followup/media/content/' + assetId, 'GET'],
    ['/api/public/sponsorships', 'GET'],
    [undefined, 'GET']
  ]) {
    await t.test(`${method} ${url}`, async () => {
      const f = fixture();
      const result = await f.run(url, method);
      assert.equal(result.handled, false);
      assert.deepEqual(f.names(), []);
      assert.deepEqual(result.headers, {});
    });
  }
});
