import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { getSponsorMediaUsageTerms } from '../dist/packages/funding-core/src/index.js';
const { version, fingerprint, locale } = getSponsorMediaUsageTerms('fr-CA');
const acceptance = { version, fingerprint, locale, accepted: true };
const usage = {
  state: 'confirmed',
  channels: ['website'],
  targets: ['openg7'],
  transformations: ['technical'],
  credit: null,
  restrictions: null
};

// The root build emits public workspaces under dist/, without package-local builds.
const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openg7/funding-core')
      return {
        url: new URL(
          '../dist/packages/funding-core/src/index.js',
          import.meta.url
        ).href,
        shortCircuit: true
      };
    return nextResolve(specifier, context);
  }
});
const { SponsorshipFollowupMediaController } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/sponsorship-followup-media-controller.js');
workspaceHook.deregister();

const limits = {
  maxUploadBytes: 8 * 1024 * 1024,
  maxSupportingImages: 3,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
};
const asset = (overrides = {}) => ({
  id: 'synthetic-image',
  contributionId: 'synthetic-sponsorship',
  kind: 'supporting_image',
  reviewStatus: 'pending_review',
  uploadedBy: 'sponsor',
  originalFilename: 'presentation.png',
  originalMimeType: 'image/png',
  originalSizeBytes: 4,
  processedMimeType: 'image/webp',
  processedSizeBytes: 4,
  width: 1,
  height: 1,
  altText: null,
  sortOrder: 0,
  publicUrl: null,
  reviewedAt: null,
  version: 'synthetic-version-1',
  createdAt: '2026-09-18T12:00:00Z',
  ...overrides
});
const file = (name = 'presentation.png') =>
  new File(['test'], name, { type: 'image/png' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let index = 0; index < 6; index++) await Promise.resolve();
};

function fixture(t, initial = []) {
  const created = [],
    revoked = [],
    reads = [],
    previews = [],
    uploads = [],
    grants = [],
    receipts = [],
    deletions = [],
    busy = [];
  const state = {
    token: 'synthetic-followup-token',
    canUploadMedia: true,
    isBrowser: true,
    confirmed: true,
    confirmations: 0
  };
  const server = { assets: initial, limits: { ...limits } };
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = `blob:synthetic-${created.length + 1}`;
    created.push({ blob, url });
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const service = {
    async getSponsorshipMedia(token) {
      reads.push(token);
      return { assets: [...server.assets], limits: server.limits };
    },
    async getSponsorshipMediaPreview(token, assetId) {
      previews.push({ token, assetId });
      return new Blob(['synthetic-preview'], { type: 'image/png' });
    },
    async uploadSponsorshipMedia(
      token,
      kind,
      file,
      altText,
      usage,
      termsAcceptance,
      requestId
    ) {
      grants.push({ usage, termsAcceptance, requestId });
      uploads.push({ token, kind, file, altText });
      const uploaded = asset({
        id: `synthetic-upload-${uploads.length}`,
        kind,
        originalFilename: file.name,
        altText
      });
      server.assets = [...server.assets, uploaded];
      return { uploaded: true, asset: uploaded };
    },
    async getSponsorshipMediaUploadReceipt(token, requestId) {
      receipts.push({ token, requestId });
      return { found: false };
    },
    async deleteSponsorshipMedia(request) {
      deletions.push(request);
      server.assets = server.assets.filter(
        (item) => item.id !== request.assetId
      );
      return { deleted: true, assetId: request.assetId };
    }
  };
  const controller = new SponsorshipFollowupMediaController({
    service,
    token: () => state.token,
    canUploadMedia: () => state.canUploadMedia,
    isBrowser: () => state.isBrowser,
    busyChange: (value) => busy.push(value),
    confirmDelete: () => {
      state.confirmations++;
      return state.confirmed;
    }
  });
  t.after(() => controller.dispose());
  return {
    controller,
    service,
    state,
    server,
    created,
    revoked,
    reads,
    previews,
    uploads,
    grants,
    receipts,
    deletions,
    busy
  };
}

test('uploads require explicit current terms acceptance and confirmed rights', async (t) => {
  const f = fixture(t),
    c = f.controller;
  await c.refresh();
  await c.uploadMedia('supporting_image', [file()], usage, undefined);
  await c.uploadMedia('supporting_image', [file()], usage, {
    ...acceptance,
    accepted: false
  });
  await c.uploadMedia(
    'supporting_image',
    [file()],
    { ...usage, state: 'needs_confirmation' },
    acceptance
  );
  assert.deepEqual(f.uploads, []);
  assert.deepEqual(c.attempts(), []);
  await c.uploadMedia('supporting_image', [file()], usage, acceptance);
  assert.deepEqual(f.grants[0].usage, usage);
  assert.deepEqual(f.grants[0].termsAcceptance, acceptance);
  assert.match(f.grants[0].requestId, /^[a-f0-9-]{36}$/);
});

test('a lost successful upload response is reconciled by its receipt without replaying the file', async (t) => {
  const f = fixture(t),
    c = f.controller,
    upload = f.service.uploadSponsorshipMedia;
  await c.refresh();
  let saved;
  f.service.uploadSponsorshipMedia = async (...args) => {
    saved = await upload(...args);
    throw new Error('Synthetic response lost');
  };
  f.service.getSponsorshipMediaUploadReceipt = async (token, requestId) => {
    assert.equal(token, f.state.token);
    assert.equal(requestId, f.grants[0].requestId);
    return { found: true, result: saved };
  };
  await c.uploadMedia('supporting_image', [file()], usage, acceptance);
  assert.equal(f.uploads.length, 1);
  assert.equal(c.assets().length, 1);
  assert.equal(c.hasUnresolvedUpload(), false);
  assert.deepEqual(c.attempts(), []);
  assert.deepEqual(c.message(), {
    key: 'result',
    params: { received: 1, failed: 0 }
  });
});

test('uncertain uploads retain the exact file, UUID and accepted terms and block replacements until explicit verified retry', async (t) => {
  const f = fixture(t),
    c = f.controller,
    calls = [],
    original = file(),
    upload = f.service.uploadSponsorshipMedia;
  await c.refresh();
  c.setAltText('Exact captured description');
  f.service.uploadSponsorshipMedia = async (...args) => {
    calls.push(args);
    throw new Error('Synthetic network loss');
  };
  f.service.getSponsorshipMediaUploadReceipt = async () => {
    throw new Error('Synthetic receipt unavailable');
  };
  await c.uploadMedia(
    'supporting_image',
    [original, file('not-sent.png')],
    usage,
    acceptance
  );
  assert.equal(c.attempts()[0].status, 'uncertain');
  assert.equal(c.attempts()[1].feedback.key, 'uploadPaused');
  assert.equal(c.hasUnresolvedUpload(), true);
  await c.dismiss(c.attempts()[0]);
  await c.uploadMedia(
    'supporting_image',
    [file('replacement.png')],
    usage,
    acceptance
  );
  assert.equal(calls.length, 1);
  assert.equal(c.attempts().length, 2);
  c.setAltText('Later unrelated draft');
  f.service.getSponsorshipMediaUploadReceipt = async () => ({ found: false });
  f.service.uploadSponsorshipMedia = async (...args) => {
    calls.push(args);
    return upload(...args);
  };
  await c.retryUpload(c.attempts()[0]);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(calls[1][2], original);
  assert.equal(calls[1][3], 'Exact captured description');
  assert.deepEqual(calls[1][5], acceptance);
  assert.match(calls[1][6], /^[a-f0-9-]{36}$/);
  assert.equal(c.hasUnresolvedUpload(), false);
  assert.equal(f.uploads.length, 1);
});

test('an incomplete receipt never authorizes replay and changing dossier discards the pending file', async (t) => {
  const f = fixture(t),
    c = f.controller;
  await c.refresh();
  let uploads = 0;
  f.service.uploadSponsorshipMedia = async () => {
    uploads++;
    throw new Error('Synthetic network loss');
  };
  f.service.getSponsorshipMediaUploadReceipt = async () => ({ found: true });
  await c.uploadMedia('supporting_image', [file()], usage, acceptance);
  const attempt = c.attempts()[0];
  await c.retryUpload(attempt);
  assert.equal(uploads, 1);
  assert.equal(c.attempts()[0].status, 'uncertain');
  f.state.token = 'synthetic-next-dossier';
  await c.refresh();
  await c.retryUpload(attempt);
  assert.equal(uploads, 1);
  assert.equal(c.hasUnresolvedUpload(), false);
});

test('loads server limits and private previews, serializes refresh and releases replaced URLs', async (t) => {
  const f = fixture(t, [asset()]),
    c = f.controller,
    pending = deferred();
  f.service.getSponsorshipMediaPreview = () => pending.promise;
  const refresh = c.refresh();
  await flush();
  await c.refresh();
  assert.equal(f.reads.length, 1);
  assert.equal(c.busy(), true);
  pending.resolve(new Blob(['first-preview']));
  await refresh;
  assert.equal(c.loaded(), true);
  assert.deepEqual(c.limits(), limits);
  assert.equal(c.photoCount(), 1);
  assert.deepEqual(c.previews(), { 'synthetic-image': 'blob:synthetic-1' });
  f.service.getSponsorshipMediaPreview = async () => new Blob(['replacement']);
  await c.refresh();
  assert.deepEqual(c.previews(), { 'synthetic-image': 'blob:synthetic-2' });
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  assert.deepEqual(f.busy, [true, false, true, false]);
  c.dispose();
  c.dispose();
  assert.deepEqual(f.revoked, ['blob:synthetic-1', 'blob:synthetic-2']);
});

test('validates each selected file and enforces remaining capacity while counting successful uploads only', async (t) => {
  const f = fixture(t, [asset(), asset({ id: 'synthetic-second' })]),
    c = f.controller;
  await c.refresh();
  c.setAltText('Synthetic description');
  const valid = file();
  await c.uploadMedia(
    'supporting_image',
    [
      new File([], 'empty.png', { type: 'image/png' }),
      {
        name: 'too-large.png',
        size: limits.maxUploadBytes + 1,
        type: 'image/png'
      },
      new File(['test'], 'invalid.gif', { type: 'image/gif' }),
      valid,
      file('over-capacity.png')
    ],
    usage,
    acceptance
  );
  assert.deepEqual(
    c.attempts().map((attempt) => [attempt.filename, attempt.feedback.key]),
    [
      ['empty.png', 'emptyFile'],
      ['too-large.png', 'tooLarge'],
      ['invalid.gif', 'invalidType'],
      ['over-capacity.png', 'limit']
    ]
  );
  assert.deepEqual(f.uploads, [
    {
      token: f.state.token,
      kind: 'supporting_image',
      file: valid,
      altText: 'Synthetic description'
    }
  ]);
  assert.deepEqual(c.message(), {
    key: 'result',
    params: { received: 1, failed: 4 }
  });
  assert.equal(c.photoCount(), 3);
  assert.equal(c.canAddSupportingImage(), false);
  assert.equal(c.altText(), '');
  assert.equal(f.created.length, 6);
  assert.equal(f.revoked.length, 3);
});

test('a failed upload does not consume capacity, and its preview remains removable without a deletion', async (t) => {
  const f = fixture(t),
    c = f.controller,
    upload = f.service.uploadSponsorshipMedia;
  f.server.limits.maxSupportingImages = 1;
  await c.refresh();
  f.service.uploadSponsorshipMedia = async (...args) => {
    if (args[2].name === 'rejected.png')
      throw new Error('Payment for this sponsorship is not confirmed yet.');
    return upload(...args);
  };
  await c.uploadMedia(
    'supporting_image',
    [file('rejected.png'), file('accepted.png')],
    usage,
    acceptance
  );
  const attempt = c.attempts()[0];
  assert.equal(attempt.status, 'failed');
  assert.equal(attempt.feedback.key, 'paymentUnconfirmed');
  assert.equal(attempt.previewUrl, 'blob:synthetic-1');
  assert.equal(c.photoCount(), 1);
  assert.deepEqual(c.message(), {
    key: 'result',
    params: { received: 1, failed: 1 }
  });
  await c.dismiss(attempt);
  assert.deepEqual(c.attempts(), []);
  assert.deepEqual(f.deletions, []);
  assert.ok(f.revoked.includes('blob:synthetic-1'));
});

test('server capacity rejection releases the rejected file preview immediately', async (t) => {
  const f = fixture(t),
    c = f.controller;
  await c.refresh();
  f.service.uploadSponsorshipMedia = async () => {
    throw new Error('The supporting image limit has been reached.');
  };
  await c.uploadMedia('supporting_image', [file()], usage, acceptance);
  assert.equal(c.attempts()[0].feedback.key, 'limit');
  assert.equal(c.attempts()[0].previewUrl, '');
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  await c.dismiss(c.attempts()[0]);
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
});

for (const kind of ['logo', 'supporting_image'])
  test(`${kind} POST confirmation survives failed reread and is reconciled without replay`, async (t) => {
    const f = fixture(t),
      c = f.controller,
      read = f.service.getSponsorshipMedia;
    await c.refresh();
    c.setAltText('Synthetic description');
    f.service.getSponsorshipMedia = async () => {
      throw new Error('Synthetic reread failure');
    };
    await c.uploadMedia(kind, [file()], usage, acceptance);
    assert.equal(c.loadError(), true);
    assert.equal(c.attempts()[0].status, 'uploaded');
    assert.equal(c.attempts()[0].asset.id, 'synthetic-upload-1');
    assert.equal(c.hasActiveLogo(), kind === 'logo');
    assert.equal(c.photoCount(), kind === 'supporting_image' ? 1 : 0);
    assert.equal(c.altText(), 'Synthetic description');
    assert.deepEqual(c.message(), {
      key: 'result',
      params: { received: 1, failed: 0 }
    });
    await c.uploadMedia(
      kind,
      [file('blocked-after-read-error.png')],
      usage,
      acceptance
    );
    assert.equal(f.uploads.length, 1);
    f.service.getSponsorshipMedia = read;
    await c.refresh();
    assert.equal(c.loadError(), false);
    assert.deepEqual(c.attempts(), []);
    assert.equal(f.uploads.length, 1);
    assert.ok(f.revoked.includes('blob:synthetic-1'));
  });

test('upload guards protect an approved logo, unconfirmed payment, initial loading and double submission', async (t) => {
  const f = fixture(t, [asset({ kind: 'logo', reviewStatus: 'approved' })]),
    c = f.controller;
  await c.uploadMedia('supporting_image', [file()], usage, acceptance);
  await c.refresh();
  await c.uploadMedia('logo', [file()], usage, acceptance);
  assert.equal(await c.deleteMedia(f.server.assets[0]), false);
  assert.equal(f.state.confirmations, 0);
  f.state.canUploadMedia = false;
  await c.uploadMedia('supporting_image', [file()], usage, acceptance);
  assert.equal(f.uploads.length, 0);
  f.state.canUploadMedia = true;
  const pending = deferred();
  f.service.uploadSponsorshipMedia = (...args) => {
    f.uploads.push(args);
    return pending.promise;
  };
  const uploading = c.uploadMedia(
    'supporting_image',
    [file()],
    usage,
    acceptance
  );
  await flush();
  await c.uploadMedia(
    'supporting_image',
    [file('duplicate.png')],
    usage,
    acceptance
  );
  assert.equal(f.uploads.length, 1);
  pending.resolve({ uploaded: true, asset: asset() });
  await uploading;
  assert.equal(c.busy(), false);
});

test('failed initial read disables uploads until the server snapshot can be retried', async (t) => {
  const f = fixture(t),
    c = f.controller,
    read = f.service.getSponsorshipMedia;
  f.service.getSponsorshipMedia = async () => {
    throw new Error('Synthetic metadata failure');
  };
  await c.refresh();
  assert.equal(c.loaded(), false);
  assert.equal(c.loadError(), true);
  assert.equal(c.busy(), false);
  await c.uploadMedia('supporting_image', [file()], usage, acceptance);
  assert.deepEqual(f.uploads, []);
  f.service.getSponsorshipMedia = read;
  await c.refresh();
  assert.equal(c.loaded(), true);
  assert.equal(c.loadError(), false);
});

test('deletion requires confirmation and version, and confirmed deletion survives a failed reread', async (t) => {
  const initial = asset(),
    f = fixture(t, [initial]),
    c = f.controller;
  await c.refresh();
  f.state.confirmed = false;
  assert.equal(await c.deleteMedia(initial), false);
  assert.deepEqual(f.deletions, []);
  f.state.confirmed = true;
  f.service.getSponsorshipMedia = async () => {
    throw new Error('Synthetic reread failure');
  };
  assert.equal(await c.deleteMedia(initial), true);
  assert.deepEqual(f.deletions, [
    {
      token: f.state.token,
      assetId: initial.id,
      expectedVersion: initial.version,
      confirmed: true
    }
  ]);
  assert.deepEqual(c.assets(), []);
  assert.deepEqual(c.previews(), {});
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  assert.equal(c.loadError(), true);
  assert.deepEqual(c.message(), { key: 'deleted' });
  assert.equal(c.busy(), false);
});

test('missing deletion confirmation from API retains the asset and reports a localized error', async (t) => {
  const initial = asset(),
    f = fixture(t, [initial]),
    c = f.controller;
  await c.refresh();
  f.service.deleteSponsorshipMedia = async () => ({ deleted: false });
  assert.equal(await c.deleteMedia(initial), false);
  assert.deepEqual(c.assets(), [initial]);
  assert.equal(c.previews()[initial.id], 'blob:synthetic-1');
  assert.deepEqual(f.revoked, []);
  assert.deepEqual(c.message(), { key: 'deleteError' });
});

test('switching the token releases visible and pending previews and ignores old results', async (t) => {
  const f = fixture(t, [asset()]),
    c = f.controller;
  await c.refresh();
  const pending = deferred();
  f.service.getSponsorshipMediaPreview = () => pending.promise;
  const obsolete = c.refresh();
  await flush();
  f.state.token = 'synthetic-next-followup-token';
  f.server.assets = [asset({ id: 'synthetic-next-image' })];
  f.service.getSponsorshipMediaPreview = async () => new Blob(['new-dossier']);
  await c.refresh();
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  assert.deepEqual(c.previews(), {
    'synthetic-next-image': 'blob:synthetic-2'
  });
  const busy = [...f.busy];
  pending.resolve(new Blob(['obsolete-private-image']));
  await obsolete;
  assert.equal(f.created.length, 2);
  assert.deepEqual(f.busy, busy);
  assert.equal(c.assets()[0].id, 'synthetic-next-image');
});

for (const failure of [false, true])
  test(`token change ignores a delayed upload ${failure ? 'failure' : 'success'} and stops the old selection`, async (t) => {
    const f = fixture(t),
      c = f.controller,
      pending = deferred();
    await c.refresh();
    f.service.uploadSponsorshipMedia = (...args) => {
      f.uploads.push(args);
      return pending.promise;
    };
    const upload = c.uploadMedia(
      'supporting_image',
      [file(), file('next.png')],
      usage,
      acceptance
    );
    await flush();
    f.state.token = 'synthetic-next-followup-token';
    await c.refresh();
    const busy = [...f.busy];
    if (failure) pending.reject(new Error('Synthetic obsolete failure'));
    else pending.resolve({ uploaded: true, asset: asset() });
    await upload;
    assert.equal(f.uploads.length, 1);
    assert.deepEqual(c.attempts(), []);
    assert.deepEqual(c.assets(), []);
    assert.equal(c.message(), null);
    assert.deepEqual(f.revoked, ['blob:synthetic-1']);
    assert.deepEqual(f.busy, busy);
  });

for (const operation of ['read', 'preview', 'upload', 'delete'])
  test(`disposal ignores delayed ${operation} results and releases every allocated URL`, async (t) => {
    const f = fixture(t, operation === 'delete' ? [asset()] : []),
      c = f.controller,
      pending = deferred();
    let request;
    if (operation === 'read') {
      f.service.getSponsorshipMedia = () => pending.promise;
      request = c.refresh();
    } else if (operation === 'preview') {
      f.server.assets = [asset()];
      f.service.getSponsorshipMediaPreview = () => pending.promise;
      request = c.refresh();
    } else {
      await c.refresh();
      if (operation === 'upload') {
        f.service.uploadSponsorshipMedia = () => pending.promise;
        request = c.uploadMedia(
          'supporting_image',
          [file()],
          usage,
          acceptance
        );
      } else {
        f.service.deleteSponsorshipMedia = () => pending.promise;
        request = c.deleteMedia(f.server.assets[0]);
      }
    }
    await flush();
    const before = {
      assets: c.assets(),
      attempts: c.attempts(),
      message: c.message(),
      busy: [...f.busy],
      created: f.created.length
    };
    c.dispose();
    pending.resolve(
      operation === 'read'
        ? { assets: [asset()], limits }
        : operation === 'preview'
          ? new Blob(['late-preview'])
          : operation === 'upload'
            ? { uploaded: true, asset: asset() }
            : { deleted: true, assetId: asset().id }
    );
    await request;
    assert.deepEqual(c.assets(), before.assets);
    assert.deepEqual(c.attempts(), before.attempts);
    assert.deepEqual(c.message(), before.message);
    assert.deepEqual(f.busy, before.busy);
    assert.equal(f.created.length, before.created);
    assert.deepEqual(
      f.revoked,
      f.created.map(({ url }) => url)
    );
    await c.refresh();
    await c.uploadMedia('logo', [file()], usage, acceptance);
    await c.deleteMedia(asset());
    c.setAltText('ignored');
    assert.equal(c.altText(), '');
  });

test('SSR reads metadata without preview URLs, browser confirmation or private deletion', async (t) => {
  const f = fixture(t, [asset()]),
    c = f.controller;
  f.state.isBrowser = false;
  await c.refresh();
  assert.equal(c.loaded(), true);
  assert.deepEqual(c.previews(), {});
  assert.deepEqual(f.previews, []);
  assert.deepEqual(f.created, []);
  assert.equal(await c.deleteMedia(f.server.assets[0]), false);
  assert.equal(f.state.confirmations, 0);
  assert.deepEqual(f.deletions, []);
  c.dispose();
  assert.deepEqual(f.revoked, []);
});
