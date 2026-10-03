import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminSponsorshipMediaHttpHandler } from '../dist/apps/funding-api/src/admin-sponsorship-media.http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
import {
  readBody,
  readBodyBuffer
} from '../dist/apps/funding-api/src/http-transport.js';
import { SPONSOR_LOGO_FILENAME_PATTERN } from '../dist/apps/funding-api/src/sponsor-logo-upload.js';

const origin = 'https://funding.example.test';
const contributionId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const version = '2026-09-24 12:00:00.123456+00';
const actor = 'synthetic-admin';
const logoFilename = `sponsor-logo-${contributionId}-1727188800000-0123456789abcdef.png`;
const logoUrl = `/api/public/sponsor-logos/${logoFilename}`;
const publicKey = `public/sponsors/${contributionId}/${assetId}-0123456789abcdef.webp`;
const publicUrl = `/api/public/sponsor-media/${assetId}`;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const image = Buffer.from('synthetic-private-image');
const maxLogoBytes = 64;
const isValidUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const reviewInput = {
  assetId,
  expectedVersion: version,
  reviewStatus: 'approved',
  altText: ' Synthetic photo '
};
const deleteInput = {
  assetId,
  expectedVersion: version,
  confirmation: assetId
};
const logoDeleteInput = { contributionId, expectedVersion: version };

const uploadBody = ({
  id = contributionId,
  expectedVersion = version,
  data = png,
  mime = 'image/png',
  filename = 'synthetic.png',
  includeFile = true
} = {}) => {
  const boundary = 'synthetic-logo-boundary';
  const parts = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="contributionId"\r\n\r\n${id}\r\n`
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="expectedVersion"\r\n\r\n${expectedVersion}\r\n`
    )
  ];
  if (includeFile)
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="logo"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
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
  denied,
  role = 'owner',
  results = {},
  failures = {},
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
    originalSizeBytes: 8,
    processedMimeType: 'image/webp',
    processedSizeBytes: image.length,
    width: 100,
    height: 100,
    altText: null,
    sortOrder: 0,
    publicUrl: null,
    reviewedAt: null,
    version,
    createdAt: '2026-09-24T12:00:00.000Z',
    originalStorageKey: 'synthetic/original.png',
    processedStorageKey: 'synthetic/processed.webp',
    publicStorageKey: null,
    checksumSha256: '0123456789abcdef'.repeat(4),
    ...assetPatch
  };
  const call = async (name, value, fallback) => {
    calls.push({ name, value });
    if (failures[name]) throw failures[name];
    return Object.hasOwn(results, name) ? results[name] : fallback;
  };
  const writeJson = (_request, response, status, payload) => {
    calls.push({ name: 'json', value: status });
    Object.assign(response, { status, payload });
  };
  const handler = createAdminSponsorshipMediaHttpHandler({
    publicBaseOrigin: origin,
    sponsorMediaMaxBytes: 1024,
    sponsorMediaMaxSupportingImages: 4,
    sponsorLogoMaxBytes: maxLogoBytes,
    SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH: 300,
    ensureAdminAccess: (request, response) => {
      calls.push({ name: 'access' });
      const rejected =
        denied ??
        (adminRoleAllows(
          role,
          request.method,
          new URL(request.url, origin).pathname
        )
          ? undefined
          : 403);
      if (!rejected) return true;
      writeJson(request, response, rejected, { error: 'Access rejected.' });
      return false;
    },
    getAdminAuditActor: () => {
      calls.push({ name: 'actor' });
      return actor;
    },
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
    isValidUuid,
    isValidAdminExpectedVersion: (value) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.trim().length <= 128,
    routeAssetId: (url, ...prefixes) => {
      try {
        const pathname = new URL(url, origin).pathname;
        const prefix = prefixes.find((candidate) =>
          pathname.startsWith(candidate)
        );
        if (!prefix) return null;
        const id = decodeURIComponent(pathname.slice(prefix.length));
        return isValidUuid(id) ? id : null;
      } catch {
        return null;
      }
    },
    listSponsorMediaAssets: (id) => call('list', id, [asset]),
    getSponsorMediaStorageRecord: (id) => call('get', id, asset),
    reviewSponsorMediaAsset: (input) =>
      call('review', input, {
        status: 'updated',
        asset: {
          ...asset,
          reviewStatus: input.reviewStatus,
          altText: input.altText,
          publicStorageKey: input.publicStorageKey,
          publicUrl: input.publicUrl
        }
      }),
    deleteSponsorMediaAsset: (input) =>
      call('delete', input, { status: 'updated', asset }),
    sponsorMediaStorage: {
      driver: 'local',
      readPrivateObject: (key) => call('mediaRead', key, image),
      publishObject: (input) => call('publish', input, undefined),
      deletePublicObject: (key) => call('unpublish', key, true)
    },
    sponsorMediaPublicKey: (current) => {
      calls.push({ name: 'publicKey', value: current });
      return publicKey;
    },
    sponsorMediaPublicUrl: (id, key) => {
      calls.push({ name: 'publicUrl', value: { id, key } });
      return publicUrl;
    },
    deleteSponsorMediaObjects: (current, options) =>
      call('cleanupMedia', { asset: current, options }, undefined),
    writeSponsorMediaMutationFailure: (request, response, status) => {
      calls.push({ name: 'mediaFailure', value: status });
      if (status === 'conflict')
        writeJson(request, response, 409, {
          code: 'SPONSOR_MEDIA_CONCURRENT_UPDATE'
        });
      else if (status === 'approved_locked')
        writeJson(request, response, 409, { code: 'SPONSOR_MEDIA_APPROVED' });
      else
        writeJson(request, response, 404, {
          error: 'Sponsor media was not found.'
        });
    },
    getAdminSponsorshipLogoUrl: (id) => call('getLogo', id, logoUrl),
    clearSponsorshipLogoUrl: (input) =>
      call('clearLogo', input, {
        updated: true,
        status: 'updated',
        previousLogoUrl: logoUrl,
        currentVersion: version
      }),
    updateSponsorshipLogoUrl: (input) =>
      call('updateLogo', input, {
        updated: true,
        status: 'updated',
        previousLogoUrl: logoUrl,
        currentVersion: version
      }),
    sponsorLogoStorage: {
      driver: 'local',
      readLogo: (filename) => call('logoRead', filename, png),
      writeLogo: (input) => call('logoWrite', input, undefined),
      deleteLogo: (filename) => call('logoDelete', filename, true)
    },
    getSponsorLogoFilenameFromUrl: (url) => {
      if (!url) return null;
      const path = new URL(url, origin).pathname;
      const prefix = [
        '/api/public/sponsor-logos/',
        '/public/sponsor-logos/'
      ].find((entry) => path.startsWith(entry));
      return prefix ? decodeURIComponent(path.slice(prefix.length)) : null;
    },
    sponsorLogoPublicUrlForFilename: (filename) =>
      `/api/public/sponsor-logos/${filename}`,
    deleteControlledSponsorLogoFile: (url) => call('cleanupLogo', url, true),
    writeSponsorshipMutationFailure: (request, response, status, details) => {
      calls.push({ name: 'logoFailure', value: { status, details } });
      writeJson(
        request,
        response,
        status === 'conflict' ? 409 : 404,
        status === 'conflict'
          ? {
              code: 'SPONSORSHIP_CONCURRENT_UPDATE',
              currentVersion: details?.currentVersion ?? null
            }
          : { error: 'Sponsorship contribution was not found.' }
      );
    },
    insertAdminAuditLog: (input) => call('audit', input, true),
    reportFailure: (...args) => calls.push({ name: 'report', value: args })
  });
  return {
    asset,
    calls,
    names: () => calls.map((entry) => entry.name),
    values: (name) =>
      calls.filter((entry) => entry.name === name).map((entry) => entry.value),
    async run(url, { method = 'GET', body = '{}', contentType } = {}) {
      const request = Object.assign(
        Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]),
        {
          method,
          url,
          headers: contentType ? { 'content-type': contentType } : {}
        }
      );
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      const handled = await handler(request, response);
      return { handled, ...response };
    }
  };
};

const owned = [
  ['media', 'GET'],
  [`media/content/${assetId}`, 'GET'],
  ['media/review', 'POST'],
  ['media/delete', 'POST'],
  ['logo', 'GET'],
  ['logo/delete', 'POST'],
  ['logo', 'POST']
];

test('all admin media routes reject access before body, database or storage through both aliases', async (t) => {
  for (const denied of [401, 403, 503]) {
    for (const prefix of ['/admin/sponsorships/', '/api/admin/sponsorships/']) {
      for (const [path, method] of owned) {
        await t.test(`${denied} ${method} ${prefix}${path}`, async () => {
          const f = fixture({ denied });
          const result = await f.run(prefix + path, {
            method,
            body: '{invalid'
          });
          assert.equal(result.handled, true);
          assert.equal(result.status, denied);
          assert.deepEqual(f.names(), ['access', 'json']);
          assert.deepEqual(result.headers, {});
        });
      }
    }
  }
});

test('public, follow-up and unrelated media routes fall through without effects', async (t) => {
  for (const [url, method] of [
    ['/sponsorship-followup/media', 'GET'],
    ['/api/sponsorship-followup/media', 'POST'],
    [`/api/public/sponsor-media/${assetId}`, 'GET'],
    ['/api/public/sponsor-logos/example.png', 'GET'],
    ['/admin/sponsorships/media', 'POST'],
    ['/admin/sponsorships/media/review', 'GET'],
    ['/admin/sponsorships/media/delete', 'GET'],
    ['/admin/sponsorships/logo/delete', 'GET'],
    ['/admin/sponsorships/logo', 'PUT'],
    ['/admin/sponsorships/media/', 'GET'],
    ['/admin/sponsorships/media/content/invalid', 'GET'],
    [`/admin/sponsorships/media/content/${assetId}/extra`, 'GET'],
    ['/admin/sponsorships/media/content/%ZZ', 'GET'],
    [undefined, 'GET']
  ]) {
    await t.test(`${method} ${url}`, async () => {
      const f = fixture();
      const result = await f.run(url, { method });
      assert.equal(result.handled, false);
      assert.deepEqual(f.names(), []);
      assert.deepEqual(result.headers, {});
    });
  }
});

test('media list preserves configured limits, query validation and aliases', async (t) => {
  for (const prefix of ['/admin/sponsorships/', '/api/admin/sponsorships/']) {
    const f = fixture();
    const result = await f.run(
      `${prefix}media?contributionId=${contributionId}`
    );
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload, {
      assets: [f.asset],
      limits: {
        maxUploadBytes: 1024,
        maxSupportingImages: 4,
        acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
      }
    });
    assert.deepEqual(f.values('list'), [contributionId]);
    for (const suffix of ['', '?contributionId=', '?contributionId=invalid']) {
      await t.test(prefix + suffix, async () => {
        const invalid = fixture();
        const rejected = await invalid.run(`${prefix}media${suffix}`);
        assert.equal(rejected.status, 400);
        assert.deepEqual(invalid.names(), ['access', 'json']);
      });
    }
  }
});

test('admin previews serve only private object bytes with private no-store cache headers', async (t) => {
  for (const prefix of ['/admin/sponsorships/', '/api/admin/sponsorships/']) {
    for (const [path, operation, key, bytes, mime] of [
      [
        `media/content/${assetId.replaceAll('-', '%2D')}?preview=1`,
        'mediaRead',
        'synthetic/processed.webp',
        image,
        'image/webp'
      ],
      [
        `logo?contributionId=${contributionId}`,
        'logoRead',
        logoFilename,
        png,
        'image/png'
      ]
    ]) {
      await t.test(prefix + path, async () => {
        const f = fixture();
        const result = await f.run(prefix + path);
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, bytes);
        assert.equal(result.contentType, mime);
        assert.deepEqual(result.headers, {
          'Cache-Control': 'private, no-store'
        });
        assert.deepEqual(f.values(operation), [key]);
        assert.deepEqual(f.values('publish'), []);
        assert.deepEqual(f.values('audit'), []);
      });
    }
  }
});

test('missing or unreadable media previews retain safe 404 errors', async (t) => {
  const failure = new Error('Synthetic storage failure.');
  for (const options of [
    { results: { get: null } },
    { results: { mediaRead: null } },
    { failures: { get: failure } },
    { failures: { mediaRead: failure } }
  ]) {
    await t.test(JSON.stringify(Object.keys(options)), async () => {
      const f = fixture(options);
      const result = await f.run(
        `/admin/sponsorships/media/content/${assetId}`
      );
      assert.equal(result.status, 404);
      assert.deepEqual(result.payload, {
        error: 'Sponsor media was not found.'
      });
      assert.deepEqual(result.headers, {});
      if (options.results?.get === null)
        assert.deepEqual(f.values('mediaRead'), []);
      if (options.failures)
        assert.deepEqual(f.values('report'), [
          ['Failed to load admin sponsor media preview.', failure]
        ]);
    });
  }
});

test('controlled logo previews reject invalid contributions, URLs, filenames and absent objects', async (t) => {
  const failure = new Error('Synthetic logo read failure.');
  for (const options of [
    { results: { getLogo: null } },
    { results: { getLogo: 'https://example.test/uncontrolled.png' } },
    { results: { getLogo: '/api/public/sponsor-logos/unsafe.svg' } },
    { results: { logoRead: null } },
    { failures: { logoRead: failure } },
    { failures: { getLogo: failure } }
  ]) {
    await t.test(JSON.stringify(Object.keys(options)), async () => {
      const f = fixture(options);
      const result = await f.run(
        `/admin/sponsorships/logo?contributionId=${contributionId}`
      );
      assert.equal(result.status, 404);
      assert.deepEqual(result.payload, {
        error: 'Sponsor logo was not found.'
      });
      assert.deepEqual(result.headers, {});
      if (options.results?.getLogo !== undefined)
        assert.deepEqual(f.values('logoRead'), []);
    });
  }
  const f = fixture();
  assert.equal(
    (await f.run('/admin/sponsorships/logo?contributionId=invalid')).status,
    400
  );
  assert.deepEqual(f.names(), ['access', 'json']);
});

test('media review publishes the processed object before versioned persistence and audit', async (t) => {
  for (const prefix of ['/admin/sponsorships/', '/api/admin/sponsorships/']) {
    await t.test(prefix, async () => {
      const f = fixture();
      const result = await f.run(prefix + 'media/review', {
        method: 'POST',
        body: JSON.stringify(reviewInput)
      });
      assert.equal(result.status, 200);
      assert.equal(result.payload.updated, true);
      assert.equal(result.payload.asset.reviewStatus, 'approved');
      assert.deepEqual(f.values('body'), [32 * 1024]);
      assert.deepEqual(f.values('publish'), [
        {
          privateKey: f.asset.processedStorageKey,
          publicKey,
          contentType: 'image/webp'
        }
      ]);
      assert.deepEqual(f.values('review'), [
        {
          assetId,
          expectedVersion: version,
          reviewStatus: 'approved',
          altText: 'Synthetic photo',
          publicStorageKey: publicKey,
          publicUrl,
          reviewedBy: actor
        }
      ]);
      assert.deepEqual(f.values('audit'), [
        {
          actor,
          action: 'sponsorship.media.approved',
          entityType: 'sponsor_media_asset',
          entityId: assetId,
          summary: 'Sponsor media marked approved.',
          metadata: {
            contributionId,
            kind: 'supporting_image',
            storageDriver: 'local'
          }
        }
      ]);
      assert.deepEqual(f.names(), [
        'access',
        'body',
        'get',
        'publicKey',
        'publicUrl',
        'publish',
        'actor',
        'review',
        'actor',
        'audit',
        'json'
      ]);
    });
  }
});

test('approval reuses an existing public object and rejection removes it before persistence', async () => {
  const assetPatch = {
    publicStorageKey: 'existing/public.webp',
    publicUrl: 'https://cdn.example.test/existing.webp',
    reviewStatus: 'approved'
  };
  const approved = fixture({ assetPatch });
  assert.equal(
    (
      await approved.run('/admin/sponsorships/media/review', {
        method: 'POST',
        body: JSON.stringify(reviewInput)
      })
    ).status,
    200
  );
  assert.deepEqual(approved.values('publish'), []);
  assert.deepEqual(approved.values('publicKey'), []);
  assert.equal(
    approved.values('review')[0].publicStorageKey,
    assetPatch.publicStorageKey
  );
  assert.equal(approved.values('review')[0].publicUrl, assetPatch.publicUrl);
  const rejected = fixture({ assetPatch });
  assert.equal(
    (
      await rejected.run('/admin/sponsorships/media/review', {
        method: 'POST',
        body: JSON.stringify({
          ...reviewInput,
          reviewStatus: 'rejected',
          altText: ' '
        })
      })
    ).status,
    200
  );
  assert.deepEqual(rejected.values('unpublish'), [assetPatch.publicStorageKey]);
  assert.deepEqual(rejected.values('review'), [
    {
      assetId,
      expectedVersion: version,
      reviewStatus: 'rejected',
      altText: null,
      publicStorageKey: null,
      publicUrl: null,
      reviewedBy: actor
    }
  ]);
  assert.equal(
    rejected.values('audit')[0].action,
    'sponsorship.media.rejected'
  );
  assert.ok(
    rejected.names().indexOf('unpublish') < rejected.names().indexOf('review')
  );
});

test('media review and delete reject invalid JSON, versions and decisions before storage', async (t) => {
  for (const [path, input, patches, limit] of [
    [
      'media/review',
      reviewInput,
      [
        { assetId: 'invalid' },
        { expectedVersion: '' },
        { expectedVersion: 'x'.repeat(129) },
        { reviewStatus: 'pending_review' },
        { altText: 'x'.repeat(301) }
      ],
      32 * 1024
    ],
    [
      'media/delete',
      deleteInput,
      [
        { assetId: 'invalid', confirmation: 'invalid' },
        { expectedVersion: '' },
        { expectedVersion: 'x'.repeat(129) }
      ],
      16 * 1024
    ]
  ]) {
    for (const body of [
      '{invalid',
      ' '.repeat(limit + 1),
      ...patches.map((patch) => JSON.stringify({ ...input, ...patch }))
    ]) {
      await t.test(
        `${path} ${body.length > 100 ? 'oversize or invalid bounded field' : body}`,
        async () => {
          const f = fixture();
          const result = await f.run('/admin/sponsorships/' + path, {
            method: 'POST',
            body
          });
          assert.equal(result.status, 400);
          assert.deepEqual(f.names(), ['access', 'body', 'json']);
          assert.deepEqual(f.values('body'), [limit]);
        }
      );
    }
  }
});

test('media delete requires exact confirmation before checking identifier and version', async (t) => {
  for (const input of [
    { ...deleteInput, confirmation: undefined },
    { ...deleteInput, confirmation: 'incorrect' },
    { assetId: 'invalid', expectedVersion: '', confirmation: 'different' }
  ]) {
    await t.test(JSON.stringify(input), async () => {
      const f = fixture();
      const result = await f.run('/admin/sponsorships/media/delete', {
        method: 'POST',
        body: JSON.stringify(input)
      });
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, {
        code: 'CONFIRMATION_REQUIRED',
        error: 'Confirm the selected media before deleting it.'
      });
      assert.deepEqual(f.names(), ['access', 'body', 'json']);
    });
  }
});

test('review conflicts remove only a newly published copy and preserve the mutation error', async (t) => {
  for (const [status, httpStatus, failureStatus] of [
    ['conflict', 409, 'conflict'],
    ['approved_locked', 409, 'approved_locked'],
    ['not_found', 404, 'not_found'],
    ['not_editable', 404, 'not_found']
  ]) {
    for (const cleanupFails of [false, true]) {
      await t.test(`${status} cleanupFails=${cleanupFails}`, async () => {
        const f = fixture({
          results: { review: { status, asset: null } },
          failures: cleanupFails
            ? { unpublish: new Error('Synthetic cleanup failure.') }
            : {}
        });
        const result = await f.run('/admin/sponsorships/media/review', {
          method: 'POST',
          body: JSON.stringify(reviewInput)
        });
        assert.equal(result.status, httpStatus);
        assert.deepEqual(f.values('unpublish'), [publicKey]);
        assert.deepEqual(f.values('mediaFailure'), [failureStatus]);
        assert.deepEqual(f.values('audit'), []);
        assert.deepEqual(f.values('report'), []);
        assert.equal(f.values('review').length, 1);
      });
    }
  }
});

test('rejected review conflicts restore an existing object only when it was removed', async (t) => {
  const assetPatch = {
    publicStorageKey: 'existing/public.webp',
    publicUrl,
    reviewStatus: 'approved'
  };
  for (const removed of [true, false]) {
    for (const restoreFails of [false, true]) {
      await t.test(
        `removed=${removed} restoreFails=${restoreFails}`,
        async () => {
          const f = fixture({
            assetPatch,
            results: {
              unpublish: removed,
              review: { status: 'conflict', asset: null }
            },
            failures: restoreFails
              ? { publish: new Error('Synthetic restore failure.') }
              : {}
          });
          const result = await f.run('/admin/sponsorships/media/review', {
            method: 'POST',
            body: JSON.stringify({ ...reviewInput, reviewStatus: 'rejected' })
          });
          assert.equal(result.status, 409);
          assert.deepEqual(
            f.values('publish'),
            removed
              ? [
                  {
                    privateKey: f.asset.processedStorageKey,
                    publicKey: assetPatch.publicStorageKey,
                    contentType: 'image/webp'
                  }
                ]
              : []
          );
          assert.deepEqual(f.values('audit'), []);
          assert.deepEqual(f.values('report'), []);
        }
      );
    }
  }
});

test('approved media deletion unpublishes before the versioned mutation then cleans private objects and audits', async (t) => {
  for (const prefix of ['/admin/sponsorships/', '/api/admin/sponsorships/']) {
    await t.test(prefix, async () => {
      const f = fixture({
        assetPatch: {
          publicStorageKey: publicKey,
          publicUrl,
          reviewStatus: 'approved'
        }
      });
      const result = await f.run(prefix + 'media/delete', {
        method: 'POST',
        body: JSON.stringify(deleteInput)
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, { deleted: true, assetId });
      assert.deepEqual(f.values('delete'), [
        { assetId, expectedVersion: version, allowApproved: true }
      ]);
      assert.deepEqual(f.values('cleanupMedia'), [
        { asset: f.asset, options: { includePublic: false } }
      ]);
      assert.equal(f.values('audit')[0].action, 'sponsorship.media.delete');
      assert.equal(f.values('audit')[0].actor, actor);
      assert.deepEqual(f.names(), [
        'access',
        'body',
        'get',
        'unpublish',
        'delete',
        'cleanupMedia',
        'actor',
        'audit',
        'json'
      ]);
    });
  }
});

test('media delete conflicts restore removed public bytes without private cleanup or audit', async (t) => {
  for (const [status, httpStatus, failureStatus] of [
    ['conflict', 409, 'conflict'],
    ['approved_locked', 409, 'approved_locked'],
    ['not_found', 404, 'not_found'],
    ['not_editable', 404, 'not_found']
  ]) {
    await t.test(status, async () => {
      const f = fixture({
        assetPatch: { publicStorageKey: publicKey },
        results: { delete: { status, asset: null } },
        failures: { publish: new Error('Synthetic restore failure.') }
      });
      const result = await f.run('/admin/sponsorships/media/delete', {
        method: 'POST',
        body: JSON.stringify(deleteInput)
      });
      assert.equal(result.status, httpStatus);
      assert.deepEqual(f.values('publish'), [
        {
          privateKey: f.asset.processedStorageKey,
          publicKey,
          contentType: 'image/webp'
        }
      ]);
      assert.deepEqual(f.values('mediaFailure'), [failureStatus]);
      assert.deepEqual(f.values('cleanupMedia'), []);
      assert.deepEqual(f.values('audit'), []);
      assert.deepEqual(f.values('report'), []);
    });
  }
});

test('media mutations return not found before storage when the selected asset is absent', async (t) => {
  for (const [path, input] of [
    ['media/review', reviewInput],
    ['media/delete', deleteInput]
  ]) {
    await t.test(path, async () => {
      const f = fixture({ results: { get: null } });
      const result = await f.run('/admin/sponsorships/' + path, {
        method: 'POST',
        body: JSON.stringify(input)
      });
      assert.equal(result.status, 404);
      assert.deepEqual(result.payload, {
        error: 'Sponsor media was not found.'
      });
      assert.deepEqual(f.names(), ['access', 'body', 'get', 'json']);
    });
  }
});

test('logo removal preserves version validation, cleanup order and audited result through both aliases', async (t) => {
  for (const prefix of ['/admin/sponsorships/', '/api/admin/sponsorships/']) {
    await t.test(prefix, async () => {
      const f = fixture({ results: { cleanupLogo: false } });
      // The existing logo removal contract carries identity/version, without a media confirmation field.
      const result = await f.run(prefix + 'logo/delete', {
        method: 'POST',
        body: JSON.stringify(logoDeleteInput)
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, {
        updated: true,
        contributionId,
        deletedLogoUrl: logoUrl
      });
      assert.deepEqual(f.values('body'), [16 * 1024]);
      assert.deepEqual(f.values('clearLogo'), [logoDeleteInput]);
      assert.deepEqual(f.values('cleanupLogo'), [logoUrl]);
      assert.deepEqual(f.values('audit'), [
        {
          actor,
          action: 'sponsorship.logo.delete',
          entityType: 'sponsorship',
          entityId: contributionId,
          summary: 'Sponsor logo removed from controlled public display.',
          metadata: {
            deletedLogoUrl: logoUrl,
            deletedMediaObject: false,
            storageDriver: 'local'
          }
        }
      ]);
      assert.deepEqual(f.names(), [
        'access',
        'body',
        'clearLogo',
        'cleanupLogo',
        'actor',
        'audit',
        'json'
      ]);
    });
  }
});

test('logo removal rejects malformed bodies and stale versions before object cleanup', async (t) => {
  for (const [body, message] of [
    ['{invalid', 'Invalid sponsor logo delete request body.'],
    [' '.repeat(16 * 1024 + 1), 'Invalid sponsor logo delete request body.'],
    ['null', 'Sponsor contribution id is invalid.'],
    [
      JSON.stringify({ ...logoDeleteInput, contributionId: 'invalid' }),
      'Sponsor contribution id is invalid.'
    ],
    [
      JSON.stringify({ ...logoDeleteInput, expectedVersion: '' }),
      'Sponsor version is required.'
    ]
  ]) {
    await t.test(message, async () => {
      const f = fixture();
      const result = await f.run('/admin/sponsorships/logo/delete', {
        method: 'POST',
        body
      });
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, { error: message });
      assert.deepEqual(f.names(), ['access', 'body', 'json']);
    });
  }
  for (const status of ['conflict', 'not_found']) {
    const f = fixture({
      results: {
        clearLogo: {
          updated: false,
          status,
          currentVersion: 'changed',
          previousLogoUrl: logoUrl
        }
      }
    });
    const result = await f.run('/admin/sponsorships/logo/delete', {
      method: 'POST',
      body: JSON.stringify(logoDeleteInput)
    });
    assert.equal(result.status, status === 'conflict' ? 409 : 404);
    assert.deepEqual(f.values('logoFailure'), [
      { status, details: { currentVersion: 'changed' } }
    ]);
    assert.deepEqual(f.values('cleanupLogo'), []);
    assert.deepEqual(f.values('audit'), []);
  }
});

test('logo uploads validate actual multipart bytes before writing a controlled filename and audited version', async (t) => {
  for (const prefix of ['/admin/sponsorships/', '/api/admin/sponsorships/']) {
    await t.test(prefix, async () => {
      const f = fixture();
      const result = await f.run(prefix + 'logo', {
        method: 'POST',
        ...uploadBody({
          id: ` ${contributionId} `,
          expectedVersion: ` ${version} `
        })
      });
      assert.equal(result.status, 200);
      const uploaded = f.values('logoWrite')[0];
      assert.match(uploaded.filename, SPONSOR_LOGO_FILENAME_PATTERN);
      assert.deepEqual(uploaded.data, png);
      assert.equal(uploaded.contentType, 'image/png');
      const newUrl = `/api/public/sponsor-logos/${uploaded.filename}`;
      assert.deepEqual(f.values('buffer'), [maxLogoBytes + 64 * 1024]);
      assert.deepEqual(f.values('updateLogo'), [
        { contributionId, logoUrl: newUrl, expectedVersion: version }
      ]);
      assert.deepEqual(f.values('cleanupLogo'), [logoUrl]);
      assert.deepEqual(result.payload, {
        updated: true,
        contributionId,
        logoUrl: newUrl,
        mimeType: 'image/png',
        sizeBytes: png.length
      });
      assert.deepEqual(f.values('audit'), [
        {
          actor,
          action: 'sponsorship.logo.upload',
          entityType: 'sponsorship',
          entityId: contributionId,
          summary: 'Sponsor logo uploaded for controlled public display.',
          metadata: {
            logoUrl: newUrl,
            previousLogoUrl: logoUrl,
            replacedMediaObject: true,
            storageDriver: 'local',
            mimeType: 'image/png',
            sizeBytes: png.length
          }
        }
      ]);
      assert.deepEqual(f.names(), [
        'access',
        'buffer',
        'logoWrite',
        'updateLogo',
        'cleanupLogo',
        'actor',
        'audit',
        'json'
      ]);
    });
  }
});

test('logo uploads reject wrong transport, oversized requests, invalid identities and mismatched image content', async (t) => {
  const cases = [
    [{ body: '{}' }, 400, 'Sponsor logo upload must use multipart/form-data.'],
    [
      { body: png, contentType: 'image/png' },
      400,
      'Sponsor logo upload must use multipart/form-data.'
    ],
    [
      {
        body: Buffer.alloc(maxLogoBytes + 64 * 1024 + 1),
        contentType: 'multipart/form-data; boundary=synthetic'
      },
      413,
      'Sponsor logo upload is too large.'
    ],
    [uploadBody({ id: 'invalid' }), 400, 'Sponsor contribution id is invalid.'],
    [uploadBody({ expectedVersion: '' }), 400, 'Sponsor version is required.'],
    [
      uploadBody({ includeFile: false }),
      400,
      'Sponsor logo must be a valid PNG, JPEG, or WebP image.'
    ],
    [
      uploadBody({ data: Buffer.alloc(0) }),
      400,
      'Sponsor logo must be a valid PNG, JPEG, or WebP image.'
    ],
    [
      uploadBody({ data: Buffer.concat([png, Buffer.alloc(maxLogoBytes)]) }),
      400,
      'Sponsor logo must be a valid PNG, JPEG, or WebP image.'
    ],
    [
      uploadBody({ mime: 'image/jpeg' }),
      400,
      'Sponsor logo must be a valid PNG, JPEG, or WebP image.'
    ],
    [
      uploadBody({
        data: Buffer.from('<svg>synthetic</svg>'),
        mime: 'image/svg+xml'
      }),
      400,
      'Sponsor logo must be a valid PNG, JPEG, or WebP image.'
    ]
  ];
  for (const [input, status, error] of cases) {
    await t.test(error, async () => {
      const f = fixture();
      const result = await f.run('/admin/sponsorships/logo', {
        method: 'POST',
        ...input
      });
      assert.equal(result.status, status);
      assert.deepEqual(result.payload, { error });
      assert.deepEqual(f.values('logoWrite'), []);
      assert.deepEqual(f.values('updateLogo'), []);
      assert.deepEqual(f.values('audit'), []);
    });
  }
});

test('logo upload conflicts remove only the new file and preserve conflict even when cleanup fails', async (t) => {
  for (const status of ['conflict', 'not_found']) {
    for (const cleanupFails of [false, true]) {
      await t.test(`${status} cleanupFails=${cleanupFails}`, async () => {
        const f = fixture({
          results: {
            updateLogo: {
              updated: false,
              status,
              currentVersion: 'changed',
              previousLogoUrl: logoUrl
            }
          },
          failures: cleanupFails
            ? { logoDelete: new Error('Synthetic cleanup failure.') }
            : {}
        });
        const result = await f.run('/admin/sponsorships/logo', {
          method: 'POST',
          ...uploadBody()
        });
        assert.equal(result.status, status === 'conflict' ? 409 : 404);
        assert.deepEqual(f.values('logoDelete'), [
          f.values('logoWrite')[0].filename
        ]);
        assert.deepEqual(f.values('logoFailure'), [
          { status, details: { currentVersion: 'changed' } }
        ]);
        assert.deepEqual(f.values('cleanupLogo'), []);
        assert.deepEqual(f.values('audit'), []);
        assert.deepEqual(f.values('report'), []);
        assert.equal(f.values('updateLogo').length, 1);
      });
    }
  }
});

test('admin media failures keep their HTTP errors without retrying mutations or storage effects', async (t) => {
  const error = new Error('Synthetic dependency failure.');
  const cases = [
    [
      'media',
      'GET',
      { body: '{}' },
      'list',
      'Sponsor media could not be loaded. Apply migration 017.'
    ],
    [
      'media/review',
      'POST',
      { body: JSON.stringify(reviewInput) },
      'publish',
      'Sponsor media review could not be completed.'
    ],
    [
      'media/review',
      'POST',
      { body: JSON.stringify(reviewInput) },
      'review',
      'Sponsor media review could not be completed.'
    ],
    [
      'media/review',
      'POST',
      { body: JSON.stringify(reviewInput) },
      'audit',
      'Sponsor media review could not be completed.'
    ],
    [
      'media/delete',
      'POST',
      { body: JSON.stringify(deleteInput) },
      'delete',
      'Sponsor media could not be deleted.'
    ],
    [
      'media/delete',
      'POST',
      { body: JSON.stringify(deleteInput) },
      'cleanupMedia',
      'Sponsor media could not be deleted.'
    ],
    [
      'media/delete',
      'POST',
      { body: JSON.stringify(deleteInput) },
      'audit',
      'Sponsor media could not be deleted.'
    ],
    [
      'logo/delete',
      'POST',
      { body: JSON.stringify(logoDeleteInput) },
      'clearLogo',
      'Sponsor logo could not be deleted.'
    ],
    [
      'logo/delete',
      'POST',
      { body: JSON.stringify(logoDeleteInput) },
      'audit',
      'Sponsor logo could not be deleted.'
    ],
    [
      'logo',
      'POST',
      uploadBody(),
      'logoWrite',
      'Sponsor logo could not be uploaded.'
    ],
    [
      'logo',
      'POST',
      uploadBody(),
      'updateLogo',
      'Sponsor logo could not be uploaded.'
    ],
    [
      'logo',
      'POST',
      uploadBody(),
      'audit',
      'Sponsor logo could not be uploaded.'
    ]
  ];
  for (const [path, method, input, operation, message] of cases) {
    await t.test(`${method} ${path} ${operation}`, async () => {
      const f = fixture({ failures: { [operation]: error } });
      const suffix =
        path === 'media' ? `?contributionId=${contributionId}` : '';
      const result = await f.run('/admin/sponsorships/' + path + suffix, {
        method,
        ...input
      });
      assert.equal(result.status, 502);
      assert.deepEqual(result.payload, { error: message });
      assert.equal(f.values(operation).length, 1);
      assert.equal(f.values('report').length, 1);
      assert.equal(f.values('report')[0][1], error);
      assert.deepEqual(f.values('logoDelete'), []);
      if (operation === 'publish') assert.deepEqual(f.values('review'), []);
    });
  }
});

test('reader mutations remain forbidden while operator media review uses existing API role policy', async () => {
  const reader = fixture({ role: 'reader' });
  const denied = await reader.run('/admin/sponsorships/media/review', {
    method: 'POST',
    body: JSON.stringify(reviewInput)
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(reader.names(), ['access', 'json']);
  const operator = fixture({ role: 'operator' });
  assert.equal(
    (
      await operator.run('/api/admin/sponsorships/media/review', {
        method: 'POST',
        body: JSON.stringify(reviewInput)
      })
    ).status,
    200
  );
});
