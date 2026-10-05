import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { AdminSponsorMediaWorkflow } from '../dist/apps/funding-web/src/app/features/funding/services/admin-sponsor-media-workflow.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const sponsorship = (
  id = 'sponsor-synthetic',
  version = 'sponsor-version-3'
) => ({
  id,
  version,
  sponsor_logo_url: `/api/public/sponsor-logos/${id}`
});

const mediaAsset = (
  id,
  reviewStatus = 'pending_review',
  version = `${id}-v2`
) => ({
  id,
  contributionId: 'sponsor-synthetic',
  kind: 'supporting_image',
  reviewStatus,
  uploadedBy: 'sponsor',
  originalFilename: `${id}.png`,
  originalMimeType: 'image/png',
  originalSizeBytes: 2048,
  processedMimeType: 'image/webp',
  processedSizeBytes: 1024,
  width: 800,
  height: 600,
  altText: null,
  sortOrder: 0,
  publicUrl: null,
  reviewedAt: null,
  version,
  createdAt: '2026-01-01T00:00:00.000Z'
});

const review = (asset, altText = '') => ({
  assetId: asset.id,
  expectedVersion: asset.version,
  reviewStatus: 'approved',
  altText
});

const fixture = (t, locale = null) => {
  const selected = sponsorship();
  const catalog = locale
    ? JSON.parse(
        fs.readFileSync(
          `apps/funding-web/src/assets/i18n/${locale}.json`,
          'utf8'
        )
      )
    : null;
  const calls = [];
  const translated = [];
  const created = [];
  const revoked = [];
  const state = { action: null, allowed: true, browser: true, selected };
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = `blob:synthetic-${created.length + 1}`;
    created.push({ blob, url });
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const ports = {
    adminToken: () => 'synthetic-session',
    canActOn: (record) =>
      state.allowed &&
      state.selected?.id === record.id &&
      state.selected?.version === record.version,
    actionPending: () => state.action !== null,
    setActionState: (action) => {
      state.action = action;
      calls.push(['action', action]);
    },
    reloadSponsorships: async () => calls.push(['reload']),
    messageFromError: (error, fallback) => {
      calls.push(['error', error, fallback]);
      return `central: ${fallback}`;
    },
    t: (key, params) => {
      translated.push({ key, params });
      if (!catalog) return params ? `${key} ${JSON.stringify(params)}` : key;
      const text = key
        .split('.')
        .reduce((value, part) => value?.[part], catalog);
      assert.equal(
        typeof text,
        'string',
        `Missing ${locale} translation: ${key}`
      );
      return text;
    },
    confirm: async (message) => {
      calls.push(['confirm', message]);
      return true;
    },
    isBrowser: () => state.browser,
    mediaLoaded: () => calls.push(['mediaLoaded']),
    admin: {
      uploadSponsorLogo: async (...args) => {
        calls.push(['uploadLogo', ...args]);
        return { sizeBytes: args[3].size };
      },
      deleteSponsorLogo: async (...args) => calls.push(['deleteLogo', ...args]),
      getSponsorLogoPreview: async (...args) => {
        calls.push(['logoPreview', ...args]);
        return new Blob(['synthetic private logo']);
      },
      getSponsorMedia: async (...args) => {
        calls.push(['media', ...args]);
        return { assets: [] };
      },
      getSponsorMediaPreview: async (...args) => {
        calls.push(['mediaPreview', ...args]);
        return new Blob(['synthetic private media']);
      },
      reviewSponsorMedia: async (...args) => calls.push(['review', ...args]),
      deleteSponsorMedia: async (...args) =>
        calls.push(['deleteMedia', ...args])
    }
  };
  const workflow = new AdminSponsorMediaWorkflow(ports);
  t.after(() => workflow.dispose());
  return {
    workflow,
    ports,
    calls,
    state,
    selected,
    created,
    revoked,
    translated
  };
};

const fileInput = (size, type = 'image/png') => ({
  value: 'synthetic-logo.png',
  files: [new File([new Uint8Array(size)], 'synthetic-logo.png', { type })]
});

test('logo upload keeps MIME and size boundaries, expected version, reload and input cleanup', async (t) => {
  const f = fixture(t);
  const input = fileInput(512 * 1024);
  await f.workflow.uploadLogo(f.selected, { target: input });
  assert.deepEqual(f.calls, [
    ['action', 'logo:sponsor-synthetic'],
    [
      'uploadLogo',
      'synthetic-session',
      f.selected.id,
      f.selected.version,
      input.files[0]
    ],
    ['reload'],
    ['action', null]
  ]);
  assert.equal(input.value, '');
  assert.match(
    f.workflow.logoUploadMessageFor(f.selected.id),
    /logo_enregistre_p0_kib.*512/
  );

  for (const invalid of [
    fileInput(512 * 1024 + 1),
    fileInput(1, 'image/svg+xml'),
    fileInput(1, '')
  ]) {
    f.calls.length = 0;
    await f.workflow.uploadLogo(f.selected, { target: invalid });
    assert.deepEqual(f.calls, []);
    assert.equal(invalid.value, '');
    assert.match(f.workflow.logoUploadMessageFor(f.selected.id), /logo_refuse/);
  }
  f.calls.length = 0;
  await f.workflow.uploadLogo(f.selected, { target: { files: [] } });
  assert.deepEqual(f.calls, []);
});

test('upload errors use the central error policy, unlock actions and clear the input', async (t) => {
  const f = fixture(t);
  const failure = new Error('synthetic version conflict');
  f.ports.admin.uploadSponsorLogo = async () => {
    throw failure;
  };
  const input = fileInput(1024);
  await f.workflow.uploadLogo(f.selected, { target: input });
  assert.equal(input.value, '');
  assert.equal(f.state.action, null);
  assert.equal(f.calls.filter(([name]) => name === 'reload').length, 0);
  assert.equal(f.calls.find(([name]) => name === 'error')[1], failure);
  assert.match(f.workflow.logoUploadMessageFor(f.selected.id), /^central:/);
});

test('shared action locks, selection versions and permissions block media mutations', async (t) => {
  for (const guard of ['locked', 'permission', 'selection-version']) {
    await t.test(guard, async (t) => {
      const f = fixture(t);
      if (guard === 'locked') f.state.action = 'refund:sponsor-synthetic';
      if (guard === 'permission') f.state.allowed = false;
      if (guard === 'selection-version')
        f.state.selected = sponsorship(f.selected.id, 'new-version');
      const asset = mediaAsset('asset-synthetic');
      f.workflow.sponsorMedia.set({ [f.selected.id]: [asset] });
      await f.workflow.uploadLogo(f.selected, { target: fileInput(10) });
      await f.workflow.deleteLogo(f.selected);
      await f.workflow.reviewSponsorMedia(f.selected, review(asset));
      await f.workflow.approveAllSponsorMedia(f.selected, [review(asset)]);
      await f.workflow.deleteSponsorMedia(f.selected, review(asset));
      assert.deepEqual(f.calls, []);
    });
  }
});

test('sensitive deletion and rejection require confirmation and recheck rights afterward', async (t) => {
  for (const operation of ['logo', 'media', 'reject']) {
    for (const outcome of ['cancel', 'changed-version', 'locked']) {
      await t.test(`${operation}: ${outcome}`, async (t) => {
        const f = fixture(t);
        f.ports.confirm = async () => {
          f.calls.push(['confirm']);
          if (outcome === 'changed-version')
            f.state.selected = sponsorship(f.selected.id, 'new-version');
          if (outcome === 'locked') f.state.action = 'note:other';
          return outcome !== 'cancel';
        };
        const asset = mediaAsset('asset-synthetic');
        if (operation === 'logo') await f.workflow.deleteLogo(f.selected);
        if (operation === 'media')
          await f.workflow.deleteSponsorMedia(f.selected, review(asset));
        if (operation === 'reject')
          await f.workflow.reviewSponsorMedia(f.selected, {
            ...review(asset),
            reviewStatus: 'rejected'
          });
        assert.deepEqual(f.calls, [['confirm']]);
      });
    }
  }
});

test('confirmed logo and media deletion retain versions and server reloads', async (t) => {
  const f = fixture(t);
  await f.workflow.deleteLogo(f.selected);
  assert.deepEqual(
    f.calls.find(([name]) => name === 'deleteLogo'),
    [
      'deleteLogo',
      'synthetic-session',
      f.selected.id,
      f.selected.version,
      f.selected.id
    ]
  );
  assert.equal(f.calls.filter(([name]) => name === 'confirm').length, 1);
  assert.equal(f.calls.filter(([name]) => name === 'reload').length, 1);
  assert.equal(
    f.workflow.logoUploadMessageFor(f.selected.id),
    'admin.messages.logo_supprime'
  );

  f.calls.length = 0;
  const asset = mediaAsset('asset-synthetic');
  await f.workflow.deleteSponsorMedia(f.selected, review(asset));
  assert.deepEqual(
    f.calls.find(([name]) => name === 'deleteMedia'),
    [
      'deleteMedia',
      'synthetic-session',
      {
        assetId: asset.id,
        expectedVersion: asset.version,
        confirmation: asset.id
      }
    ]
  );
  assert.equal(f.calls.filter(([name]) => name === 'media').length, 1);
  assert.equal(f.calls.filter(([name]) => name === 'confirm').length, 1);
  assert.equal(f.state.action, null);
  assert.equal(
    f.workflow.sponsorMediaMessages()[f.selected.id],
    'admin.messages.media_supprime'
  );
});

test('reviews preserve asset version and trimmed or absent alt text without automatic public visibility', async (t) => {
  const f = fixture(t);
  const asset = mediaAsset('asset-synthetic');
  await f.workflow.reviewSponsorMedia(
    f.selected,
    review(asset, '  Vue synthétique du kiosque  ')
  );
  assert.deepEqual(
    f.calls.find(([name]) => name === 'review'),
    [
      'review',
      'synthetic-session',
      {
        assetId: asset.id,
        expectedVersion: asset.version,
        reviewStatus: 'approved',
        altText: 'Vue synthétique du kiosque'
      }
    ]
  );
  assert.equal(f.calls.filter(([name]) => name === 'confirm').length, 0);
  assert.equal(f.calls.filter(([name]) => name === 'media').length, 1);
  assert.match(
    f.workflow.sponsorMediaMessages()[f.selected.id],
    /visible_seulement_lorsque/
  );

  f.calls.length = 0;
  await f.workflow.reviewSponsorMedia(f.selected, {
    ...review(asset, '   '),
    reviewStatus: 'rejected'
  });
  assert.deepEqual(f.calls.find(([name]) => name === 'review')[2], {
    assetId: asset.id,
    expectedVersion: asset.version,
    reviewStatus: 'rejected',
    altText: undefined
  });
  assert.equal(f.calls.filter(([name]) => name === 'confirm').length, 1);
  assert.equal(f.state.action, null);
});

test('bulk approval processes exact versions sequentially and reports partial interruption after server reload', async (t) => {
  const f = fixture(t);
  const assets = [
    mediaAsset('already-approved', 'approved'),
    mediaAsset('first'),
    mediaAsset('stale'),
    mediaAsset('second'),
    mediaAsset('never-sent')
  ];
  f.workflow.sponsorMedia.set({ [f.selected.id]: assets });
  const failure = new Error('synthetic second asset conflict');
  f.ports.admin.reviewSponsorMedia = async (token, payload) => {
    f.calls.push(['review', token, payload]);
    if (payload.assetId === 'second') throw failure;
  };
  await f.workflow.approveAllSponsorMedia(f.selected, [
    review(assets[0]),
    review(assets[1], '  Première vue  '),
    { ...review(assets[2]), expectedVersion: 'obsolete-version' },
    review(assets[3]),
    review(assets[4])
  ]);
  assert.deepEqual(
    f.calls
      .filter(([name]) => name === 'review')
      .map((entry) => entry[2].assetId),
    ['first', 'second']
  );
  assert.equal(f.calls.filter(([name]) => name === 'media').length, 1);
  assert.equal(f.calls.find(([name]) => name === 'error')[1], failure);
  assert.match(
    f.workflow.sponsorMediaMessages()[f.selected.id],
    /interrompue.*"p0":1/
  );
  assert.equal(f.state.action, null);
});

test('bulk approval has no mutation when all assets are already approved and counts only matching drafts', async (t) => {
  const f = fixture(t);
  f.workflow.sponsorMedia.set({
    [f.selected.id]: [mediaAsset('approved', 'approved')]
  });
  await f.workflow.approveAllSponsorMedia(f.selected, []);
  assert.deepEqual(f.calls, []);
  assert.match(
    f.workflow.sponsorMediaMessages()[f.selected.id],
    /deja_approuves/
  );

  const first = mediaAsset('first');
  f.workflow.sponsorMedia.set({
    [f.selected.id]: [first, mediaAsset('missing-draft')]
  });
  await f.workflow.approveAllSponsorMedia(f.selected, [review(first, ' Vue ')]);
  assert.deepEqual(
    f.calls.filter(([name]) => name === 'review').map((entry) => entry[2]),
    [
      {
        assetId: first.id,
        expectedVersion: first.version,
        reviewStatus: 'approved',
        altText: 'Vue'
      }
    ]
  );
  assert.match(f.workflow.sponsorMediaMessages()[f.selected.id], /"p0":1/);
  assert.equal(f.state.action, null);
});

test('deletion, review and metadata failures use central error handling and always release the shared lock', async (t) => {
  for (const operation of ['deleteLogo', 'deleteMedia', 'review', 'metadata']) {
    await t.test(operation, async (t) => {
      const f = fixture(t);
      const failure = new Error(`synthetic ${operation} failure`);
      const fail = async () => {
        throw failure;
      };
      if (operation === 'deleteLogo') {
        f.ports.admin.deleteSponsorLogo = fail;
        await f.workflow.deleteLogo(f.selected);
      } else if (operation === 'deleteMedia') {
        f.ports.admin.deleteSponsorMedia = fail;
        await f.workflow.deleteSponsorMedia(
          f.selected,
          review(mediaAsset('asset'))
        );
      } else if (operation === 'review') {
        f.ports.admin.reviewSponsorMedia = fail;
        await f.workflow.reviewSponsorMedia(
          f.selected,
          review(mediaAsset('asset'))
        );
      } else {
        f.ports.admin.getSponsorMedia = fail;
        await f.workflow.loadSponsorMedia(f.selected.id);
      }
      assert.equal(f.calls.find(([name]) => name === 'error')[1], failure);
      assert.equal(f.state.action, null);
      const message =
        operation === 'deleteLogo'
          ? f.workflow.logoUploadMessageFor(f.selected.id)
          : f.workflow.sponsorMediaMessages()[f.selected.id];
      assert.match(message, /^central:/);
    });
  }
});

test('logo previews distinguish controlled routes, external URLs and absent data while releasing replacements', async (t) => {
  const f = fixture(t);
  const legacy = {
    ...sponsorship('legacy'),
    sponsor_logo_url: '/public/sponsor-logos/legacy'
  };
  const external = {
    ...sponsorship('external'),
    sponsor_logo_url: 'https://example.test/logo.png'
  };
  const absent = { ...sponsorship('absent'), sponsor_logo_url: null };
  await f.workflow.loadLogoPreviews([f.selected, legacy, external, absent]);
  assert.deepEqual(
    f.calls.filter(([name]) => name === 'logoPreview').map((entry) => entry[2]),
    [f.selected.id, legacy.id]
  );
  assert.equal(f.workflow.logoPreviewSourceFor(f.selected), 'blob:synthetic-1');
  assert.equal(f.workflow.logoPreviewSourceFor(legacy), 'blob:synthetic-2');
  assert.equal(
    f.workflow.logoPreviewSourceFor(external),
    external.sponsor_logo_url
  );
  assert.equal(f.workflow.logoPreviewSourceFor(absent), '');
  assert.equal(f.workflow.logoUploadMessageFor('absent'), '');
  await f.workflow.loadLogoPreviews([]);
  assert.deepEqual(f.revoked, ['blob:synthetic-1', 'blob:synthetic-2']);
  assert.deepEqual(f.workflow.logoPreviewUrls(), {});
});

test('media metadata preserves ordering, notifies the page and owns preview URLs by asset ID', async (t) => {
  const f = fixture(t);
  const assets = [mediaAsset('second'), mediaAsset('first', 'approved')];
  f.ports.admin.getSponsorMedia = async () => ({ assets });
  await f.workflow.loadSponsorMedia(f.selected.id);
  assert.deepEqual(f.workflow.sponsorMedia()[f.selected.id], assets);
  assert.equal(f.calls.filter(([name]) => name === 'mediaLoaded').length, 1);
  assert.deepEqual(f.workflow.sponsorMediaPreviewUrls(), {
    second: 'blob:synthetic-1',
    first: 'blob:synthetic-2'
  });
  await f.workflow.loadSponsorMedia(f.selected.id);
  assert.deepEqual(f.revoked, ['blob:synthetic-1', 'blob:synthetic-2']);
});

test('SSR and absent browser URL APIs skip private previews without blocking metadata', async (t) => {
  for (const mode of ['ssr', 'missing-url-api', 'missing-url-global']) {
    await t.test(mode, async (t) => {
      const f = fixture(t);
      if (mode === 'ssr') f.state.browser = false;
      else if (mode === 'missing-url-api') {
        const descriptor = Object.getOwnPropertyDescriptor(
          URL,
          'createObjectURL'
        );
        Object.defineProperty(URL, 'createObjectURL', {
          ...descriptor,
          value: undefined
        });
        t.after(() =>
          Object.defineProperty(URL, 'createObjectURL', descriptor)
        );
      } else {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'URL');
        Object.defineProperty(globalThis, 'URL', {
          ...descriptor,
          value: undefined
        });
        t.after(() => Object.defineProperty(globalThis, 'URL', descriptor));
      }
      f.ports.admin.getSponsorMedia = async () => ({
        assets: [mediaAsset('asset')]
      });
      await f.workflow.loadLogoPreviews([f.selected]);
      await f.workflow.loadSponsorMedia(f.selected.id);
      assert.deepEqual(f.created, []);
      assert.equal(
        f.calls.some(
          ([name]) => name === 'logoPreview' || name === 'mediaPreview'
        ),
        false
      );
      assert.equal(f.workflow.sponsorMedia()[f.selected.id].length, 1);
      assert.deepEqual(f.workflow.logoPreviewUrls(), {});
      assert.deepEqual(f.workflow.sponsorMediaPreviewUrls(), {});
    });
  }
});

test('obsolete logo responses cannot replace latest previews or allocate leaked URLs', async (t) => {
  const f = fixture(t);
  const old = deferred();
  f.ports.admin.getSponsorLogoPreview = (_token, id) =>
    id === 'obsolete' ? old.promise : Promise.resolve(new Blob(['latest']));
  const pending = f.workflow.loadLogoPreviews([sponsorship('obsolete')]);
  await f.workflow.loadLogoPreviews([sponsorship('latest')]);
  old.resolve(new Blob(['obsolete']));
  await pending;
  assert.deepEqual(f.workflow.logoPreviewUrls(), {
    latest: 'blob:synthetic-1'
  });
  assert.equal(f.created.length, 1);
  assert.equal(
    f.calls.some(([name]) => name === 'error'),
    false
  );
});

test('latest metadata request wins and obsolete failures do not reach central error presentation', async (t) => {
  for (const outcome of ['success', 'failure']) {
    await t.test(outcome, async (t) => {
      const f = fixture(t);
      const old = deferred();
      f.ports.admin.getSponsorMedia = (_token, id) =>
        id === 'obsolete'
          ? old.promise
          : Promise.resolve({ assets: [mediaAsset('latest-asset')] });
      const pending = f.workflow.loadSponsorMedia('obsolete');
      await f.workflow.loadSponsorMedia('latest');
      if (outcome === 'success')
        old.resolve({ assets: [mediaAsset('obsolete-asset')] });
      else old.reject(new Error('obsolete failure'));
      await pending;
      assert.equal(f.workflow.sponsorMedia().obsolete, undefined);
      assert.deepEqual(f.workflow.sponsorMediaPreviewUrls(), {
        'latest-asset': 'blob:synthetic-1'
      });
      assert.equal(
        f.calls.filter(([name]) => name === 'mediaLoaded').length,
        1
      );
      assert.equal(
        f.calls.some(([name]) => name === 'error'),
        false
      );
    });
  }
});

test('selection clear and disposal invalidate unfinished media and logo requests', async (t) => {
  const f = fixture(t);
  const logo = deferred();
  const metadata = deferred();
  f.ports.admin.getSponsorLogoPreview = () => logo.promise;
  f.ports.admin.getSponsorMedia = () => metadata.promise;
  const logoRequest = f.workflow.loadLogoPreviews([f.selected]);
  const metadataRequest = f.workflow.loadSponsorMedia(f.selected.id);
  await f.workflow.loadSponsorMedia(null);
  f.workflow.dispose();
  logo.resolve(new Blob(['late private logo']));
  metadata.resolve({ assets: [mediaAsset('late-asset')] });
  await Promise.all([logoRequest, metadataRequest]);
  await f.workflow.loadLogoPreviews([f.selected]);
  await f.workflow.loadSponsorMedia(f.selected.id);
  await f.workflow.deleteLogo(f.selected);
  assert.deepEqual(f.created, []);
  assert.deepEqual(f.workflow.logoPreviewUrls(), {});
  assert.deepEqual(f.workflow.sponsorMediaPreviewUrls(), {});
  assert.deepEqual(f.workflow.sponsorMedia(), {});
  assert.equal(
    f.calls.some(([name]) => name === 'confirm' || name === 'mediaLoaded'),
    false
  );
});

test('late media previews do not allocate URLs after replacement or destruction, with no replay', async (t) => {
  const f = fixture(t);
  const old = deferred();
  let previewCalls = 0;
  f.ports.admin.getSponsorMedia = async (_token, id) => ({
    assets: [mediaAsset(id)]
  });
  f.ports.admin.getSponsorMediaPreview = (_token, id) => {
    previewCalls++;
    return id === 'old' ? old.promise : Promise.resolve(new Blob(['current']));
  };
  const pending = f.workflow.loadSponsorMedia('old');
  await Promise.resolve();
  await f.workflow.loadSponsorMedia('current');
  f.workflow.dispose();
  old.resolve(new Blob(['obsolete private media']));
  await pending;
  assert.equal(previewCalls, 2);
  assert.equal(f.created.length, 1);
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  assert.deepEqual(f.workflow.sponsorMediaPreviewUrls(), {});
});

test('missing preview files remain silent and cleanup releases every URL exactly once', async (t) => {
  const f = fixture(t);
  f.ports.admin.getSponsorLogoPreview = async () => {
    throw new Error('private logo missing');
  };
  f.ports.admin.getSponsorMedia = async () => ({
    assets: [mediaAsset('visible'), mediaAsset('missing')]
  });
  f.ports.admin.getSponsorMediaPreview = async (_token, id) => {
    if (id === 'missing') throw new Error('private media missing');
    return new Blob(['visible']);
  };
  await f.workflow.loadLogoPreviews([f.selected]);
  await f.workflow.loadSponsorMedia(f.selected.id);
  assert.deepEqual(f.workflow.logoPreviewUrls(), {});
  assert.deepEqual(f.workflow.sponsorMediaPreviewUrls(), {
    visible: 'blob:synthetic-1'
  });
  assert.equal(
    f.calls.some(([name]) => name === 'error'),
    false
  );
  f.workflow.dispose();
  f.workflow.dispose();
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
});

test('existing presentation and mutation messages resolve in both French and English catalogs', async (t) => {
  for (const locale of ['fr-CA', 'en']) {
    await t.test(locale, async (t) => {
      const f = fixture(t, locale);
      assert.ok(f.workflow.sponsorMediaStatusLabel('approved'));
      assert.ok(f.workflow.sponsorMediaStatusLabel('rejected'));
      assert.ok(f.workflow.sponsorMediaStatusLabel('pending_review'));
      assert.equal(f.workflow.formatMediaSize(0), '1 Ko');
      assert.equal(f.workflow.formatMediaSize(1024 * 1024), '1.0 Mo');
      await f.workflow.uploadLogo(f.selected, { target: fileInput(10) });
      await f.workflow.deleteLogo(f.selected);
      await f.workflow.reviewSponsorMedia(
        f.selected,
        review(mediaAsset('asset'))
      );
      await f.workflow.reviewSponsorMedia(f.selected, {
        ...review(mediaAsset('asset')),
        reviewStatus: 'rejected'
      });
      await f.workflow.deleteSponsorMedia(
        f.selected,
        review(mediaAsset('asset'))
      );
      f.workflow.sponsorMedia.set({ [f.selected.id]: [mediaAsset('asset')] });
      await f.workflow.approveAllSponsorMedia(f.selected, [
        review(mediaAsset('asset'))
      ]);
      await f.workflow.approveAllSponsorMedia(f.selected, []);
      assert.ok(f.translated.length > 10);
    });
  }
});
