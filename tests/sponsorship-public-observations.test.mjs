import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { loadSponsorshipVisibilityConfig } from '../dist/apps/funding-api/src/sponsorship-timing/visibility-config.js';
import {
  createPublicObservationGet,
  PublicObservationHttpError,
  isPublicObservationAddress
} from '../dist/apps/funding-api/src/sponsorship-timing/visibility-http.js';
import { observePublicPresence } from '../dist/apps/funding-api/src/sponsorship-timing/visibility-reader.js';
import { SponsorshipPublicVisibilityWorker } from '../dist/apps/funding-api/src/sponsorship-timing/visibility-worker.js';

const contributionId = '10000000-0000-4000-8000-000000000001';
const mediaId = '20000000-0000-4000-8000-000000000001';
const bytes = Buffer.from('synthetic controlled image bytes');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const expected = {
  contributionId,
  sourceSnapshot: [
    {
      id: contributionId,
      company: 'Synthetic sponsor',
      summary: 'Public summary'
    }
  ],
  mediaSnapshot: [
    {
      id: mediaId,
      contributionId,
      kind: 'supporting_image',
      derivedHash: hash(bytes),
      usage: { credit: 'Synthetic credit' }
    }
  ],
  nextDirectoryPage: 1
};
const profile = {
  public_id: hash(`public-sponsor:${contributionId}`),
  company_name: 'Synthetic sponsor',
  public_summary: 'Public summary',
  website_url: 'http://169.254.169.254/private-never-followed',
  media: [
    {
      id: mediaId,
      kind: 'supporting_image',
      url: `/api/public/sponsor-media/${mediaId}`,
      credit: 'Synthetic credit'
    }
  ]
};
const directory = (page, profiles = [profile], total = profiles.length) => ({
  status: 200,
  contentType: 'application/json; charset=utf-8',
  body: Buffer.from(
    JSON.stringify({
      data_source: 'database',
      sponsorships: profiles,
      pagination: { page, page_size: 50, total_count: total }
    })
  )
});
const budget = (extra = {}) => ({
  deadline: Date.now() + 45000,
  remainingRequests: 48,
  remainingBytes: 16 * 1024 * 1024,
  ...extra
});
const readFixture = (
  media = { status: 200, contentType: 'image/webp', body: bytes }
) => {
  const calls = [];
  return {
    calls,
    get: async (path) => {
      calls.push(path);
      if (path.startsWith('/api/public/sponsorships?'))
        return directory(
          Number(
            new URL(path, 'https://owned.example.invalid').searchParams.get(
              'page'
            )
          )
        );
      assert.equal(path, `/api/public/sponsor-media/${mediaId}`);
      return media;
    }
  };
};

test('periodic observation is opt-in and disabled startup performs no database or HTTP effect', async () => {
  const config = loadSponsorshipVisibilityConfig({});
  assert.deepEqual(config, {
    enabled: false,
    origin: null,
    intervalMs: 900000,
    batchSize: 5
  });
  const worker = new SponsorshipPublicVisibilityWorker(
    {
      connect() {
        throw new Error('No DB effect');
      }
    },
    config,
    () => {
      throw new Error('No HTTP effect');
    }
  );
  assert.deepEqual(await worker.tick(), { checked: 0, incidents: 0 });
  for (const env of [
    { FUNDING_SPONSORSHIP_VISIBILITY_ENABLED: 'TRUE' },
    { FUNDING_SPONSORSHIP_VISIBILITY_ENABLED: 'true' },
    { FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN: 'http://owned.example.invalid' },
    {
      FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN:
        'https://name:secret@owned.example.invalid'
    },
    {
      FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN:
        'https://owned.example.invalid/api/'
    },
    {
      FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN:
        'https://owned.example.invalid/?private=value'
    },
    {
      FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN:
        'https://owned.example.invalid:8443'
    },
    { FUNDING_SPONSORSHIP_VISIBILITY_INTERVAL_SECONDS: '59' },
    { FUNDING_SPONSORSHIP_VISIBILITY_BATCH_SIZE: '21' }
  ])
    assert.throws(() => loadSponsorshipVisibilityConfig(env));
  assert.equal(
    loadSponsorshipVisibilityConfig({
      FUNDING_SPONSORSHIP_VISIBILITY_ENABLED: 'true',
      FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN: 'https://owned.example.invalid'
    }).enabled,
    true
  );
});

test('private, mapped, expanded and transition DNS addresses are rejected independently of spelling', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.0.1',
    '192.0.2.1',
    '203.0.113.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '2002:0808:0808::1',
    '2001:db8::1',
    '2001:0db8:0000:0000:0000:0000:0000:0001',
    '2001:0010::1',
    '2001:0020::1',
    '2001:0000:1::1',
    '3fff::1'
  ])
    assert.equal(isPublicObservationAddress(address), false, address);
  for (const address of [
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700::1111',
    '2001:4860:4860::8888'
  ])
    assert.equal(isPublicObservationAddress(address), true, address);
});

test('mixed public/private DNS and arbitrary paths launch no request; public DNS is pinned with the TLS hostname intact', async () => {
  let requests = 0;
  const blocked = createPublicObservationGet('https://owned.example.invalid', {
    resolve: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ],
    request() {
      requests++;
      throw new Error('Unsafe request');
    }
  });
  await assert.rejects(
    blocked('/api/public/sponsorships?page=1&pageSize=50', 1000, 1000),
    { reason: 'DNS_UNSAFE' }
  );
  await assert.rejects(
    blocked('https://attacker.example.invalid/', 1000, 1000),
    { reason: 'DNS_UNSAFE' }
  );
  assert.equal(requests, 0);
  const allowed = createPublicObservationGet('https://owned.example.invalid', {
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    request(url, options, receive) {
      assert.equal(url.hostname, 'owned.example.invalid');
      assert.equal(options.rejectUnauthorized, undefined); // Native TLS verification remains enabled.
      assert.equal(options.agent, false);
      options.lookup('owned.example.invalid', {}, (error, address, family) => {
        assert.equal(error, null);
        assert.equal(address, '8.8.8.8');
        assert.equal(family, 4);
      });
      const req = new EventEmitter();
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        res.headers = { 'content-type': 'application/json' };
        res.destroy = () => {};
        receive(res);
        res.emit('data', Buffer.from('{}'));
        res.emit('end');
      };
      return req;
    }
  });
  assert.equal(
    (
      await allowed('/api/public/sponsorships?page=1&pageSize=50', 1000, 1000)
    ).body.toString(),
    '{}'
  );
});

test('native HTTP refuses redirects, compression and oversized bodies while closing the response', async () => {
  for (const scenario of [
    {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' },
      reason: 'HTTP_REDIRECT'
    },
    {
      status: 200,
      headers: { 'content-encoding': 'gzip' },
      reason: 'HTTP_INVALID'
    },
    {
      status: 200,
      headers: { 'content-length': '10000' },
      reason: 'HTTP_TOO_LARGE'
    },
    {
      status: 200,
      headers: {},
      body: Buffer.alloc(1001),
      reason: 'HTTP_TOO_LARGE'
    }
  ]) {
    let destroyed = false;
    const get = createPublicObservationGet('https://owned.example.invalid', {
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request(_url, _options, receive) {
        const req = new EventEmitter();
        req.end = () => {
          const res = new EventEmitter();
          res.statusCode = scenario.status;
          res.headers = scenario.headers;
          res.destroy = () => {
            destroyed = true;
          };
          receive(res);
          if (scenario.body) res.emit('data', scenario.body);
        };
        return req;
      }
    });
    await assert.rejects(
      get('/api/public/sponsorships?page=1&pageSize=50', 1000, 1000),
      { reason: scenario.reason }
    );
    assert.equal(destroyed, true);
  }
});

test('exact public identity, credits and media bytes qualify only an instantaneous sample without visiting sponsor URLs', async () => {
  const fixture = readFixture();
  const observed = await observePublicPresence(expected, fixture.get, budget());
  assert.equal(observed.status, 'visible');
  assert.equal(observed.reason, 'MATCH');
  assert.equal(observed.requestCount, 2);
  assert.deepEqual(fixture.calls, [
    '/api/public/sponsorships?page=1&pageSize=50',
    `/api/public/sponsor-media/${mediaId}`
  ]);
  assert.ok(!('fulfilled' in observed));
  const changed = await observePublicPresence(
    expected,
    async () => directory(1, [{ ...profile, company_name: 'Another sponsor' }]),
    budget()
  );
  assert.equal(changed.status, 'changed');
  assert.equal(changed.reason, 'PUBLIC_CONTENT_CHANGED');
  const redirectUrl = await observePublicPresence(
    expected,
    async () =>
      directory(1, [
        {
          ...profile,
          media: [{ ...profile.media[0], url: 'http://127.0.0.1/private' }]
        }
      ]),
    budget()
  );
  assert.equal(redirectUrl.status, 'changed');
  assert.equal(redirectUrl.requestCount, 1);
});

test('missing controlled image and changed bytes are distinct from inaccessible or incomplete responses', async () => {
  for (const [media, state, reason] of [
    [
      { status: 404, contentType: 'text/plain', body: Buffer.alloc(0) },
      'not_visible',
      'PUBLIC_MEDIA_MISSING'
    ],
    [
      { status: 403, contentType: 'text/plain', body: Buffer.alloc(0) },
      'unknown',
      'HTTP_ERROR'
    ],
    [
      {
        status: 200,
        contentType: 'image/webp',
        body: Buffer.from('different bytes')
      },
      'changed',
      'PUBLIC_MEDIA_CHANGED'
    ],
    [
      { status: 302, contentType: 'text/plain', body: Buffer.alloc(0) },
      'unknown',
      'HTTP_REDIRECT'
    ],
    [
      { status: 200, contentType: 'text/html', body: bytes },
      'unknown',
      'HTTP_INVALID'
    ]
  ]) {
    const observed = await observePublicPresence(
      expected,
      readFixture(media).get,
      budget()
    );
    assert.equal(observed.status, state);
    assert.equal(observed.reason, reason);
  }
});

test('large directories advance their page cursor across samples, without inferring removal from mixed-time pages', async () => {
  const calls = [];
  const get = async (path) => {
    if (path.includes('sponsor-media'))
      return { status: 200, contentType: 'image/webp', body: bytes };
    const page = Number(
      new URL(path, 'https://owned.example.invalid').searchParams.get('page')
    );
    calls.push(page);
    return directory(page, page === 5 ? [profile] : [], 250);
  };
  let input = expected;
  for (const nextPage of [3, 5]) {
    const observed = await observePublicPresence(input, get, budget());
    assert.equal(observed.status, 'unknown');
    assert.equal(observed.reason, 'PROFILE_NOT_OBSERVED');
    assert.equal(observed.nextDirectoryPage, nextPage);
    input = { ...expected, nextDirectoryPage: observed.nextDirectoryPage };
  }
  assert.equal(
    (await observePublicPresence(input, get, budget())).status,
    'visible'
  );
  assert.deepEqual(calls, [1, 2, 3, 4, 5]);
});

test('request, total-byte and time budgets cannot yield a visible sample when media verification is incomplete', async () => {
  const fixture = readFixture();
  for (const limits of [
    { remainingRequests: 1 },
    { remainingBytes: 1 },
    { deadline: Date.now() - 1 }
  ]) {
    const observed = await observePublicPresence(
      expected,
      fixture.get,
      budget(limits)
    );
    assert.equal(observed.status, 'unknown');
    assert.ok(
      ['CHECK_BUDGET_EXHAUSTED', 'HTTP_TOO_LARGE'].includes(observed.reason)
    );
  }
});

test('an oversized failed transport spends its allowance and cannot reset the global byte budget for later dossiers', async () => {
  const shared = budget();
  let imageAttempts = 0;
  let imageAllowances = 0;
  let directoryBytes = 0;
  const get = async (path, maxBytes) => {
    if (path.includes('sponsor-media')) {
      imageAttempts++;
      imageAllowances += maxBytes;
      throw new PublicObservationHttpError('HTTP_TOO_LARGE');
    }
    const response = directory(1);
    directoryBytes += response.body.byteLength;
    return response;
  };
  for (let index = 0; index < 20; index++)
    assert.equal(
      (await observePublicPresence(expected, get, shared)).status,
      'unknown'
    );
  assert.equal(imageAttempts, 2);
  assert.ok(imageAllowances + directoryBytes <= 16 * 1024 * 1024);
  assert.equal(shared.remainingBytes, 0);
});

test('DNS has a deadline and an unresolved lookup cannot launch a later request', async () => {
  let called = false;
  const get = createPublicObservationGet('https://owned.example.invalid', {
    resolve: () => new Promise(() => {}),
    request() {
      called = true;
      throw new Error('DNS did not complete');
    }
  });
  await assert.rejects(
    get('/api/public/sponsorships?page=1&pageSize=50', 1000, 20),
    { reason: 'HTTP_TIMEOUT' }
  );
  assert.equal(called, false);
});
