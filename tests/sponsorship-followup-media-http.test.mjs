import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createSponsorshipFollowupMediaHttpHandler } from '../dist/apps/funding-api/src/sponsorship-followup-media.http.js';
import { SponsorMediaPersistenceError } from '../dist/apps/funding-api/src/sponsor-media.repository.js';
import {
  readBody,
  readBodyBuffer
} from '../dist/apps/funding-api/src/http-transport.js';
import { SPONSOR_MEDIA_MULTIPART_OVERHEAD_BYTES } from '../dist/apps/funding-api/src/sponsor-media-limits.js';

const origin = 'https://funding.example.test';
const token = 'a'.repeat(43);
const contributionId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const version = '2026-09-24 12:00:00.123456+00';
const originalBytes = Buffer.from('synthetic-png');
const processedBytes = Buffer.from('synthetic-webp');
const maxBytes = 32;
const deleteInput = {
  token,
  assetId,
  expectedVersion: version,
  confirmed: true
};
const isValidUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const uploadBody = ({
  tokenValue = token,
  kind = 'supporting_image',
  altText = ' Synthetic photo ',
  data = originalBytes,
  filename = 'synthetic.png',
  mime = 'image/png',
  extra = [],
  includeFile = true
} = {}) => {
  const boundary = 'synthetic-followup-media-boundary';
  const parts = [];
  for (const [name, value] of [
    ['token', tokenValue],
    ['kind', kind],
    ['altText', altText],
    ...extra
  ])
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  if (includeFile)
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\n${mime ? `Content-Type: ${mime}\r\n` : ''}\r\n`
      ),
      data,
      Buffer.from('\r\n')
    );
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
};

const fixture = ({
  databaseAvailable = true,
  results = {},
  failures = {},
  failAt = {},
  paymentStatus = 'paid',
  assetPatch = {}
} = {}) => {
  const calls = [];
  const asset = {
    id: assetId,
    contributionId,
    kind: 'supporting_image',
    reviewStatus: 'pending_review',
    uploadedBy: 'sponsor',
    originalFilename: 'synthetic.png',
    originalMimeType: 'image/png',
    originalSizeBytes: originalBytes.length,
    processedMimeType: 'image/webp',
    processedSizeBytes: processedBytes.length,
    width: 100,
    height: 75,
    altText: null,
    sortOrder: 0,
    publicUrl: null,
    reviewedAt: null,
    version,
    createdAt: '2026-09-24T12:00:00.000Z'
  };
  const stored = {
    ...asset,
    originalStorageKey: 'synthetic/original.png',
    processedStorageKey: 'synthetic/processed.webp',
    publicStorageKey: null,
    checksumSha256: '0'.repeat(64),
    ...assetPatch
  };
  const call = async (name, value, fallback) => {
    calls.push({ name, value });
    const count = calls.filter((entry) => entry.name === name).length;
    if (failures[name] && (!failAt[name] || count === failAt[name]))
      throw failures[name];
    return Object.hasOwn(results, name) ? results[name] : fallback;
  };
  const writeJson = (_request, response, status, payload) => {
    calls.push({ name: 'json', value: status });
    Object.assign(response, { status, payload });
  };
  const handler = createSponsorshipFollowupMediaHttpHandler({
    publicBaseOrigin: origin,
    databaseAvailable: () => databaseAvailable,
    sponsorMediaMaxBytes: maxBytes,
    sponsorMediaMaxSupportingImages: 4,
    SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH: 300,
    followupEditablePaymentStatuses: new Set(['paid', 'refunded', 'disputed']),
    readBody: async (request, limit) => {
      calls.push({ name: 'body', value: limit });
      return readBody(request, limit);
    },
    readBodyBuffer: async (request, limit) => {
      calls.push({ name: 'buffer', value: limit });
      return readBodyBuffer(request, limit);
    },
    writeJson,
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
    isValidFollowupToken: (value) =>
      typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value),
    isValidUuid,
    isValidAdminExpectedVersion: (value) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.trim().length <= 128,
    hasOnlyKeys: (value, keys) =>
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) => keys.includes(key)),
    routeAssetId: (url, ...prefixes) => {
      try {
        const path = new URL(url, origin).pathname;
        const prefix = prefixes.find((entry) => path.startsWith(entry));
        const id = prefix ? decodeURIComponent(path.slice(prefix.length)) : '';
        return isValidUuid(id) ? id : null;
      } catch {
        return null;
      }
    },
    getFreshSponsorshipFollowupByToken: (value) =>
      call('fresh', value, { contributionId, paymentStatus }),
    listSponsorMediaAssets: (id) => call('list', id, [asset]),
    getSponsorMediaStorageRecord: (id) => call('get', id, stored),
    checkSponsorMediaUpload: (id, kind, maxSupportingImages) =>
      call('eligibility', { id, kind, maxSupportingImages }, 'allowed'),
    processSponsorImage: (input) =>
      call('process', input, {
        originalData: input.data,
        originalFilename: 'synthetic.png',
        originalExtension: 'png',
        originalMimeType: 'image/png',
        originalSizeBytes: input.data.length,
        processedData: processedBytes,
        processedMimeType: 'image/webp',
        processedSizeBytes: processedBytes.length,
        checksumSha256: '0'.repeat(64),
        width: 100,
        height: 75
      }),
    createSponsorMediaAsset: (input) =>
      call('create', input, {
        status: 'created',
        asset: {
          ...asset,
          id: input.id,
          kind: input.kind,
          altText: input.altText
        },
        replaced: null
      }),
    deleteSponsorMediaAsset: (input) =>
      call('delete', input, { status: 'updated', asset: stored }),
    sponsorMediaStorage: {
      driver: 'local',
      readPrivateObject: (key) => call('read', key, processedBytes),
      writePrivateObject: (input) => call('write', input, undefined),
      deletePrivateObject: (key) => call('deletePrivate', key, true)
    },
    deleteSponsorMediaObjects: (current, options) =>
      call('cleanup', { asset: current, options }, undefined),
    writeSponsorMediaMutationFailure: (request, response, status) => {
      calls.push({ name: 'mutationFailure', value: status });
      if (status === 'not_found')
        writeJson(request, response, 404, {
          error: 'Sponsor media was not found.'
        });
      else
        writeJson(request, response, 409, {
          code: {
            conflict: 'SPONSOR_MEDIA_CONCURRENT_UPDATE',
            not_editable: 'SPONSORSHIP_NOT_EDITABLE',
            approved_locked: 'SPONSOR_MEDIA_APPROVED'
          }[status]
        });
    },
    insertAdminAuditLog: (input) => call('audit', input, true),
    reportFailure: (...args) => calls.push({ name: 'report', value: args })
  });
  return {
    asset,
    stored,
    calls,
    names: () => calls.map((entry) => entry.name),
    values: (name) =>
      calls.filter((entry) => entry.name === name).map((entry) => entry.value),
    async run(
      url,
      { method = 'GET', body = '{}', contentType, headerToken } = {}
    ) {
      const request = Object.assign(
        Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]),
        {
          method,
          url,
          headers: {
            ...(contentType ? { 'content-type': contentType } : {}),
            ...(headerToken === undefined
              ? {}
              : { 'x-sponsorship-followup-token': headerToken })
          }
        }
      );
      const response = { headers: {} };
      const handled = await handler(request, response);
      return { handled, ...response };
    }
  };
};

test('follow-up media lists use the query token and retain limits through both aliases', async (t) => {
  for (const prefix of [
    '/sponsorship-followup/',
    '/api/sponsorship-followup/'
  ]) {
    await t.test(prefix, async () => {
      const f = fixture();
      const result = await f.run(`${prefix}media?token=${token}`);
      assert.equal(result.handled, true);
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, {
        assets: [f.asset],
        limits: {
          maxUploadBytes: maxBytes,
          maxSupportingImages: 4,
          acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
        }
      });
      assert.deepEqual(f.values('fresh'), [token]);
      assert.deepEqual(f.values('list'), [contributionId]);
      assert.deepEqual(f.names(), ['fresh', 'list', 'json']);
    });
  }
});

test('database and token preconditions stop list and upload before private lookups', async (t) => {
  for (const [method, input] of [
    ['GET', {}],
    ['POST', uploadBody()]
  ]) {
    const f = fixture({ databaseAvailable: false });
    const result = await f.run('/sponsorship-followup/media?token=invalid', {
      method,
      ...input
    });
    assert.equal(result.status, 503);
    assert.deepEqual(result.payload, {
      error: 'Sponsorship media requires DATABASE_URL.'
    });
    assert.deepEqual(f.names(), ['json']);
  }
  for (const query of ['', '?token=', '?token=invalid']) {
    await t.test(query || 'missing', async () => {
      const f = fixture();
      const result = await f.run('/sponsorship-followup/media' + query, {
        headerToken: token
      });
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, {
        error: 'Invalid sponsorship follow-up token.'
      });
      assert.deepEqual(f.names(), ['json']);
    });
  }
});

test('private content accepts only the first token header and verifies exact dossier ownership before reading bytes', async (t) => {
  for (const prefix of [
    '/sponsorship-followup/',
    '/api/sponsorship-followup/'
  ]) {
    const f = fixture();
    const result = await f.run(
      prefix +
        'media/content/' +
        assetId.replaceAll('-', '%2D') +
        '?token=incorrect',
      { headerToken: [token, 'invalid'] }
    );
    assert.equal(result.handled, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload, processedBytes);
    assert.equal(result.contentType, 'image/webp');
    assert.deepEqual(result.headers, { 'Cache-Control': 'private, no-store' });
    assert.deepEqual(f.values('fresh'), [token]);
    assert.deepEqual(f.values('get'), [assetId]);
    assert.deepEqual(f.values('read'), [f.stored.processedStorageKey]);
    assert.deepEqual(f.names(), ['fresh', 'get', 'read', 'binary']);
  }
  for (const headerToken of [undefined, '', 'invalid', ['invalid', token]]) {
    await t.test(String(headerToken), async () => {
      const f = fixture();
      const result = await f.run(
        `/sponsorship-followup/media/content/${assetId}?token=${token}`,
        { headerToken }
      );
      assert.equal(result.status, 401);
      assert.deepEqual(result.payload, {
        error: 'Sponsorship follow-up token is required.'
      });
      assert.deepEqual(f.names(), ['json']);
    });
  }
  for (const options of [
    { results: { fresh: null } },
    { results: { get: null } },
    { assetPatch: { contributionId: '00000000-0000-4000-8000-000000000003' } }
  ]) {
    const f = fixture(options);
    const result = await f.run(
      '/sponsorship-followup/media/content/' + assetId,
      { headerToken: token }
    );
    assert.equal(result.status, 404);
    assert.deepEqual(f.values('read'), []);
    assert.deepEqual(result.headers, {});
  }
});

test('private previews and list failures retain their distinct safe error responses', async (t) => {
  const error = new Error('Synthetic media lookup failure.');
  for (const [path, options, status, message] of [
    [
      `media?token=${token}`,
      { results: { fresh: null } },
      404,
      'Sponsorship follow-up was not found.'
    ],
    [
      `media?token=${token}`,
      { failures: { fresh: error } },
      502,
      'Sponsorship media could not be loaded. Apply migration 017.'
    ],
    [
      `media?token=${token}`,
      { failures: { list: error } },
      502,
      'Sponsorship media could not be loaded. Apply migration 017.'
    ],
    [
      `media/content/${assetId}`,
      { results: { read: null } },
      404,
      'Sponsor media was not found.'
    ],
    [
      `media/content/${assetId}`,
      { failures: { get: error } },
      404,
      'Sponsor media was not found.'
    ],
    [
      `media/content/${assetId}`,
      { failures: { read: error } },
      404,
      'Sponsor media was not found.'
    ]
  ]) {
    await t.test(path + JSON.stringify(Object.keys(options)), async () => {
      const f = fixture(options);
      const result = await f.run('/sponsorship-followup/' + path, {
        headerToken: token
      });
      assert.equal(result.status, status);
      assert.deepEqual(result.payload, { error: message });
      assert.deepEqual(result.headers, {});
      if (options.failures) assert.equal(f.values('report')[0][1], error);
    });
  }
});

test('media upload checks eligibility then processes and stores private bytes before persistence and audit', async (t) => {
  for (const prefix of [
    '/sponsorship-followup/',
    '/api/sponsorship-followup/'
  ]) {
    await t.test(prefix, async () => {
      const f = fixture();
      const result = await f.run(prefix + 'media', {
        method: 'POST',
        ...uploadBody()
      });
      assert.equal(result.status, 201);
      assert.equal(result.payload.uploaded, true);
      assert.deepEqual(f.values('buffer'), [
        maxBytes + SPONSOR_MEDIA_MULTIPART_OVERHEAD_BYTES
      ]);
      assert.deepEqual(f.values('eligibility'), [
        { id: contributionId, kind: 'supporting_image', maxSupportingImages: 4 }
      ]);
      assert.deepEqual(f.values('process'), [
        {
          data: originalBytes,
          kind: 'supporting_image',
          originalFilename: 'synthetic.png'
        }
      ]);
      const input = f.values('create')[0];
      assert.ok(isValidUuid(input.id));
      const base = `sponsors/${contributionId}/${input.id}`;
      assert.deepEqual(f.values('write'), [
        {
          key: `${base}/original.png`,
          data: originalBytes,
          contentType: 'image/png'
        },
        {
          key: `${base}/processed.webp`,
          data: processedBytes,
          contentType: 'image/webp'
        }
      ]);
      assert.deepEqual(input, {
        id: input.id,
        contributionId,
        kind: 'supporting_image',
        uploadedBy: 'sponsor',
        auditActor: 'sponsor-followup',
        storageDriver: 'local',
        originalFilename: 'synthetic.png',
        originalMimeType: 'image/png',
        originalSizeBytes: originalBytes.length,
        originalStorageKey: `${base}/original.png`,
        processedSizeBytes: processedBytes.length,
        processedStorageKey: `${base}/processed.webp`,
        checksumSha256: '0'.repeat(64),
        width: 100,
        height: 75,
        altText: 'Synthetic photo',
        maxSupportingImages: 4
      });
      assert.deepEqual(f.values('audit'), []);
      assert.deepEqual(f.names(), [
        'buffer',
        'fresh',
        'eligibility',
        'process',
        'write',
        'write',
        'create',
        'json'
      ]);
      assert.deepEqual(f.values('deletePrivate'), []);
    });
  }
});

test('uploads reject unsupported multipart transport, duplicate fields, unsafe text, missing file and size before decoding', async (t) => {
  const cases = [
    [{ body: '{}' }, 400, undefined],
    [
      {
        body: Buffer.alloc(
          maxBytes + SPONSOR_MEDIA_MULTIPART_OVERHEAD_BYTES + 1
        ),
        contentType: 'multipart/form-data; boundary=synthetic'
      },
      413,
      'SPONSOR_MEDIA_TOO_LARGE'
    ],
    [
      uploadBody({ data: Buffer.alloc(maxBytes + 1) }),
      413,
      'SPONSOR_MEDIA_TOO_LARGE'
    ],
    [uploadBody({ tokenValue: 'invalid' }), 400, undefined],
    [uploadBody({ kind: 'unsupported' }), 400, undefined],
    [uploadBody({ includeFile: false }), 400, undefined],
    [uploadBody({ data: Buffer.alloc(0) }), 400, undefined],
    [uploadBody({ filename: '' }), 400, undefined],
    [uploadBody({ extra: [['kind', 'logo']] }), 400, undefined],
    [uploadBody({ extra: [['approved', 'true']] }), 400, undefined],
    [uploadBody({ altText: 'bad\u0000description' }), 400, undefined],
    [uploadBody({ altText: 'x'.repeat(301) }), 400, undefined]
  ];
  for (const [index, [input, status, code]] of cases.entries()) {
    await t.test(`${status} ${index}`, async () => {
      const f = fixture();
      const result = await f.run('/sponsorship-followup/media', {
        method: 'POST',
        ...input
      });
      assert.equal(result.status, status);
      assert.equal(result.payload.code, code);
      assert.deepEqual(f.values('fresh'), []);
      assert.deepEqual(f.values('process'), []);
      assert.deepEqual(f.values('write'), []);
    });
  }
});

test('unconfirmed payments and upload preflight refusals stop before image processing or storage', async (t) => {
  for (const paymentStatus of ['pending', 'failed']) {
    const f = fixture({ paymentStatus });
    const result = await f.run('/sponsorship-followup/media', {
      method: 'POST',
      ...uploadBody()
    });
    assert.equal(result.status, 409);
    assert.deepEqual(result.payload, {
      error: 'Payment for this sponsorship is not confirmed yet.'
    });
    assert.deepEqual(f.names(), ['buffer', 'fresh', 'json']);
  }
  for (const eligibility of [
    'contribution_not_found',
    'not_editable',
    'logo_locked',
    'supporting_image_limit_reached'
  ]) {
    await t.test(eligibility, async () => {
      const f = fixture({ results: { eligibility } });
      const result = await f.run('/sponsorship-followup/media', {
        method: 'POST',
        ...uploadBody()
      });
      assert.equal(
        result.status,
        eligibility === 'contribution_not_found' ? 404 : 409
      );
      assert.equal(result.payload.code, eligibility);
      assert.deepEqual(f.names(), ['buffer', 'fresh', 'eligibility', 'json']);
    });
  }
});

test('missing dossiers and declared image type mismatches do not write any objects', async () => {
  const absent = fixture({ results: { fresh: null } });
  const missing = await absent.run('/sponsorship-followup/media', {
    method: 'POST',
    ...uploadBody()
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(absent.values('process'), []);
  const mismatch = fixture();
  const invalid = await mismatch.run('/sponsorship-followup/media', {
    method: 'POST',
    ...uploadBody({ mime: 'image/jpeg' })
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.payload, {
    error: 'The declared image type does not match its contents.'
  });
  assert.equal(mismatch.values('process').length, 1);
  assert.deepEqual(mismatch.values('write'), []);
});

test('transaction refusal cleans both private objects with allSettled and preserves its domain status', async (t) => {
  for (const status of [
    'contribution_not_found',
    'not_editable',
    'logo_locked',
    'supporting_image_limit_reached'
  ]) {
    for (const cleanupFails of [false, true]) {
      await t.test(`${status} cleanupFails=${cleanupFails}`, async () => {
        const f = fixture({
          results: { create: { status } },
          failures: cleanupFails
            ? { deletePrivate: new Error('Synthetic cleanup failure.') }
            : {}
        });
        const result = await f.run('/sponsorship-followup/media', {
          method: 'POST',
          ...uploadBody()
        });
        assert.equal(
          result.status,
          status === 'contribution_not_found' ? 404 : 409
        );
        assert.equal(result.payload.code, status);
        assert.deepEqual(
          f.values('deletePrivate'),
          f.values('write').map((write) => write.key)
        );
        assert.equal(f.values('create').length, 1);
        assert.deepEqual(f.values('cleanup'), []);
        assert.deepEqual(f.values('audit'), []);
        assert.deepEqual(f.values('report'), []);
      });
    }
  }
});

test('replacement cleanup removes only the previous private objects after audited creation commits', async () => {
  const old = fixture().stored;
  const f = fixture({
    results: {
      create: {
        status: 'created',
        asset: { ...old, kind: 'logo' },
        replaced: old
      }
    }
  });
  const result = await f.run('/sponsorship-followup/media', {
    method: 'POST',
    ...uploadBody({ kind: 'logo' })
  });
  assert.equal(result.status, 201);
  assert.deepEqual(f.values('cleanup'), [
    { asset: old, options: { includePublic: false } }
  ]);
  assert.ok(f.names().indexOf('create') < f.names().indexOf('cleanup'));
  assert.deepEqual(f.values('audit'), []);
  assert.deepEqual(f.values('deletePrivate'), []);
});

test('upload dependency exceptions distinguish image validation from unavailable dependencies and clean only confirmed orphans', async (t) => {
  const error = new Error('Synthetic upload dependency failure.');
  for (const operation of [
    'fresh',
    'eligibility',
    'process',
    'write',
    'create'
  ]) {
    for (const cleanupFails of [false, true]) {
      await t.test(`${operation} cleanupFails=${cleanupFails}`, async () => {
        const f = fixture({
          results: { get: null },
          failures: {
            [operation]:
              operation === 'create'
                ? new SponsorMediaPersistenceError(error, true)
                : error,
            ...(cleanupFails
              ? { deletePrivate: new Error('Synthetic cleanup failure.') }
              : {})
          }
        });
        const result = await f.run('/sponsorship-followup/media', {
          method: 'POST',
          ...uploadBody()
        });
        const invalidImage = operation === 'process';
        const code = invalidImage
          ? 'SPONSOR_MEDIA_INVALID_IMAGE'
          : 'SPONSOR_MEDIA_UPLOAD_UNAVAILABLE';
        assert.equal(result.status, invalidImage ? 400 : 503);
        assert.deepEqual(result.payload, {
          code,
          error: invalidImage
            ? 'Sponsor media must be a valid JPEG, PNG, or WebP image.'
            : 'Sponsor media upload is unavailable. Please try again later.'
        });
        assert.equal(f.values(operation).length, 1);
        if (['write', 'create'].includes(operation)) {
          const id =
            f.values('create')[0]?.id ?? f.values('write')[0].key.split('/')[2];
          assert.deepEqual(f.values('deletePrivate'), [
            `sponsors/${contributionId}/${id}/original.png`,
            `sponsors/${contributionId}/${id}/processed.webp`
          ]);
        } else assert.deepEqual(f.values('deletePrivate'), []);
        assert.deepEqual(f.values('report'), [
          ['Failed to upload sponsorship media.', { code }]
        ]);
        assert.equal(f.values('get').length, operation === 'create' ? 1 : 0);
      });
    }
  }
  const f = fixture({ failures: { write: error }, failAt: { write: 2 } });
  assert.equal(
    (
      await f.run('/sponsorship-followup/media', {
        method: 'POST',
        ...uploadBody()
      })
    ).status,
    503
  );
  assert.equal(f.values('write').length, 2);
  assert.equal(f.values('deletePrivate').length, 2);
});

test('uncertain commit outcomes retain uploaded objects when the row exists or reconciliation fails', async (t) => {
  for (const lookupFails of [false, true]) {
    await t.test(`lookupFails=${lookupFails}`, async () => {
      const f = fixture({
        failures: {
          create: new Error('Synthetic uncertain commit'),
          ...(lookupFails
            ? { get: new Error('Synthetic reconciliation failure') }
            : {})
        }
      });
      const result = await f.run('/sponsorship-followup/media', {
        method: 'POST',
        ...uploadBody()
      });
      assert.equal(result.status, 503);
      assert.equal(result.payload.code, 'SPONSOR_MEDIA_UPLOAD_UNCONFIRMED');
      assert.equal(result.payload.uploaded, lookupFails ? null : true);
      assert.equal(result.payload.assetId, f.values('create')[0].id);
      assert.deepEqual(f.values('get'), [result.payload.assetId]);
      assert.deepEqual(f.values('deletePrivate'), []);
      assert.deepEqual(f.values('audit'), []);
      assert.deepEqual(f.values('cleanup'), []);
      assert.deepEqual(f.values('report'), [
        [
          'Sponsor media upload requires reconciliation.',
          { code: 'SPONSOR_MEDIA_UPLOAD_UNCONFIRMED' }
        ]
      ]);
      assert.equal(
        JSON.stringify(result.payload).includes('StorageKey'),
        false
      );
    });
  }
});

test('a missing row never authorizes cleanup when rollback could not be confirmed', async (t) => {
  for (const typedFailure of [false, true]) {
    await t.test(`typedFailure=${typedFailure}`, async () => {
      const cause = new Error(
        'Synthetic interrupted COMMIT and failed ROLLBACK'
      );
      const f = fixture({
        results: { get: null },
        failures: {
          create: typedFailure
            ? new SponsorMediaPersistenceError(cause, false)
            : cause
        }
      });
      const result = await f.run('/sponsorship-followup/media', {
        method: 'POST',
        ...uploadBody()
      });
      assert.equal(result.status, 503);
      assert.equal(result.payload.code, 'SPONSOR_MEDIA_UPLOAD_UNCONFIRMED');
      assert.equal(result.payload.uploaded, null);
      assert.deepEqual(f.values('get'), [f.values('create')[0].id]);
      assert.deepEqual(f.values('deletePrivate'), []);
    });
  }
});

test('a cleanup exception after successful audited creation never removes the new media objects', async () => {
  const old = fixture().stored;
  const f = fixture({
    results: { create: { status: 'created', asset: old, replaced: old } },
    failures: { cleanup: new Error('Synthetic replacement cleanup failure') }
  });
  const result = await f.run('/sponsorship-followup/media', {
    method: 'POST',
    ...uploadBody({ kind: 'logo' })
  });
  assert.equal(result.status, 503);
  assert.equal(result.payload.uploaded, true);
  assert.equal(result.payload.code, 'SPONSOR_MEDIA_UPLOAD_UNCONFIRMED');
  assert.deepEqual(f.values('deletePrivate'), []);
  assert.deepEqual(f.values('get'), []);
});

test('sponsor deletion keeps confirmation, exact scope and version, blocks approved media and audits cleanup', async (t) => {
  for (const prefix of [
    '/sponsorship-followup/',
    '/api/sponsorship-followup/'
  ]) {
    await t.test(prefix, async () => {
      const f = fixture();
      const result = await f.run(prefix + 'media/delete', {
        method: 'POST',
        body: JSON.stringify(deleteInput)
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, { deleted: true, assetId });
      assert.deepEqual(f.values('body'), [16 * 1024]);
      assert.deepEqual(f.values('delete'), [
        {
          assetId,
          contributionId,
          expectedVersion: version,
          allowApproved: false
        }
      ]);
      assert.deepEqual(f.values('cleanup'), [
        { asset: f.stored, options: { includePublic: false } }
      ]);
      assert.deepEqual(f.values('audit'), [
        {
          actor: 'sponsor-followup',
          action: 'sponsorship.media.delete',
          entityType: 'sponsor_media_asset',
          entityId: assetId,
          summary: 'Pending sponsor media deleted through the follow-up flow.',
          metadata: { contributionId, kind: 'supporting_image' }
        }
      ]);
      assert.deepEqual(f.names(), [
        'body',
        'fresh',
        'delete',
        'cleanup',
        'audit',
        'json'
      ]);
    });
  }
});

test('delete payloads require an object, whitelisted fields, confirmed true, token, UUID and bounded version', async (t) => {
  const invalid = [
    '{invalid',
    'null',
    '[]',
    '1',
    '"text"',
    ' '.repeat(16 * 1024 + 1),
    ...[
      { confirmed: undefined },
      { confirmed: 'true' },
      { approved: true },
      { token: 'invalid' },
      { assetId: 'invalid' },
      { expectedVersion: '' },
      { expectedVersion: 'x'.repeat(129) }
    ].map((patch) => JSON.stringify({ ...deleteInput, ...patch }))
  ];
  for (const [index, body] of invalid.entries()) {
    await t.test(String(index), async () => {
      const f = fixture();
      const result = await f.run('/sponsorship-followup/media/delete', {
        method: 'POST',
        body
      });
      assert.equal(result.status, 400);
      assert.deepEqual(f.names(), ['body', 'json']);
    });
  }
});

test('delete conflicts, refusal and approved locks retain domain errors without cleanup or audit', async (t) => {
  for (const [status, code] of [
    ['conflict', 'SPONSOR_MEDIA_CONCURRENT_UPDATE'],
    ['not_editable', 'SPONSORSHIP_NOT_EDITABLE'],
    ['approved_locked', 'SPONSOR_MEDIA_APPROVED'],
    ['not_found', undefined]
  ]) {
    await t.test(status, async () => {
      const f = fixture({ results: { delete: { status, asset: null } } });
      const result = await f.run('/sponsorship-followup/media/delete', {
        method: 'POST',
        body: JSON.stringify(deleteInput)
      });
      assert.equal(result.status, status === 'not_found' ? 404 : 409);
      assert.equal(result.payload.code, code);
      assert.deepEqual(f.values('mutationFailure'), [status]);
      assert.deepEqual(f.values('cleanup'), []);
      assert.deepEqual(f.values('audit'), []);
      assert.equal(f.values('delete').length, 1);
    });
  }
  const f = fixture({ results: { fresh: null } });
  const result = await f.run('/sponsorship-followup/media/delete', {
    method: 'POST',
    body: JSON.stringify(deleteInput)
  });
  assert.equal(result.status, 404);
  assert.deepEqual(f.values('delete'), []);
});

test('deletion dependency exceptions keep safe 502 without implicit replay', async (t) => {
  const error = new Error('Synthetic deletion dependency failure.');
  for (const operation of ['fresh', 'delete', 'cleanup', 'audit']) {
    await t.test(operation, async () => {
      const f = fixture({ failures: { [operation]: error } });
      const result = await f.run('/sponsorship-followup/media/delete', {
        method: 'POST',
        body: JSON.stringify(deleteInput)
      });
      assert.equal(result.status, 502);
      assert.deepEqual(result.payload, {
        error: 'Sponsor media could not be deleted.'
      });
      assert.equal(f.values(operation).length, 1);
      assert.deepEqual(f.values('report'), [
        ['Failed to delete sponsorship media.', error]
      ]);
    });
  }
});

test('admin, public, unrelated follow-up routes and unsupported methods fall through without reads', async (t) => {
  for (const [url, method] of [
    ['/admin/sponsorships/media', 'GET'],
    ['/api/public/sponsor-media/' + assetId, 'GET'],
    ['/sponsorship-followup/details', 'POST'],
    ['/sponsorship-followup/media', 'PUT'],
    ['/sponsorship-followup/media/delete', 'GET'],
    ['/sponsorship-followup/media/content/' + assetId, 'POST'],
    ['/sponsorship-followup/media/content/invalid', 'GET'],
    ['/sponsorship-followup/media/content/' + assetId + '/extra', 'GET'],
    ['/sponsorship-followup/media/content/%ZZ', 'GET'],
    ['/sponsorship-followup/media/', 'GET'],
    [undefined, 'GET']
  ]) {
    await t.test(`${method} ${url}`, async () => {
      const f = fixture();
      const result = await f.run(url, { method });
      assert.equal(result.handled, false);
      assert.deepEqual(f.names(), []);
    });
  }
});
