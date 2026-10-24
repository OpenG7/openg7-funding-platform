import { fundingBaseTranslations } from './support/funding-base-translations.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { signal } from '@angular/core';
import { moderationDecision } from './support/moderation-ui-fixture.mjs';

const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === '@openg7/funding-core'
      ? {
          url: new URL(
            '../dist/packages/funding-core/src/index.js',
            import.meta.url
          ).href,
          shortCircuit: true
        }
      : nextResolve(specifier, context);
  }
});
const { PublicationDeliveryController } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/admin-publications/publication-delivery-controller.js');
workspaceHook.deregister();

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const delivery = (changes = {}) => ({
  id: 'synthetic-delivery',
  feedId: 'openg20:linkedin',
  kind: 'sponsorship',
  message: 'Exact synthetic content for the displayed destination',
  scheduledAt: '2026-10-05T15:00:00.000Z',
  mediaId: null,
  mediaUrl: null,
  mediaAlt: null,
  accountId: 'synthetic-organization',
  mode: 'mock',
  sponsors: [],
  version: 7,
  status: 'draft',
  errorCode: null,
  ...changes
});

const sponsor = (changes = {}) => ({
  id: 'synthetic-sponsor',
  version: 'sponsor-v4',
  name: 'Synthetic company',
  reviewStatus: 'pending_review',
  presentationApproved: true,
  ...changes
});

const fixture = (t) => {
  const calls = {
    commands: [],
    confirmations: [],
    previews: [],
    errors: [],
    media: 0
  };
  const created = [];
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = `blob:synthetic-${created.length + 1}`;
    created.push({ blob, url });
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const ports = {
    moderate: async (subject, level, initial) =>
      moderationDecision(subject, level, initial),
    refresh: async () => true,
    state: signal({ feeds: [], deliveries: [] }),
    busy: signal(false),
    error: signal(''),
    commands: {
      run: async (command, open = false) => {
        calls.commands.push({ command, open });
        return true;
      }
    },
    admin: {
      publicationMedia: async () => {
        calls.media++;
        return [];
      },
      getSavedAdminToken: () => 'synthetic-session',
      publicationImagePreview: async (id, version, hash, imageIndex) => {
        calls.previews.push({
          id,
          version,
          hash,
          ...(imageIndex !== undefined ? { imageIndex } : {})
        });
        return new Blob(['exact JPEG'], { type: 'image/jpeg' });
      },
      getSponsorMediaPreview: async (token, id) => {
        calls.previews.push({ token, id });
        return new Blob(['synthetic private image']);
      }
    },
    i18n: { t: (key) => key, currentLanguage: () => 'fr-CA' },
    confirm: async (message, title) => {
      calls.confirmations.push({ message, title });
      return true;
    },
    showError: (error) => calls.errors.push(error),
    clearError: () => ports.error.set('')
  };
  const controller = new PublicationDeliveryController(ports);
  t.after(() => controller.dispose());
  return { controller, ports, calls, created, revoked };
};

test('unchanged deliveries and empty new compositions close without a confirmation or a command', async (t) => {
  for (const mode of ['edit', 'compose'])
    await t.test(mode, async (t) => {
      const f = fixture(t);
      if (mode === 'edit') f.controller.open(delivery());
      else f.controller.create();
      assert.equal(f.controller.dirty(), false);
      await f.controller.requestClose();
      assert.equal(f.controller.selected(), null);
      assert.equal(f.controller.composing(), false);
      assert.deepEqual(f.calls.confirmations, []);
      assert.deepEqual(f.calls.commands, []);
    });
});

test('new composition changes to every editable field require a discard decision and cancellation preserves them', async (t) => {
  const changes = {
    message: (c) => (c.edit.message = 'Unsaved synthetic composition'),
    scheduledAt: (c) => (c.edit.scheduledAt = '2026-11-05T11:30'),
    mediaId: (c) => (c.edit.mediaId = 'synthetic-photo'),
    publicationFormat: (c) => (c.edit.publicationFormat = 'image_collection'),
    photoSelections: (c) =>
      (c.edit.photoSelections = [
        { contributionId: 'synthetic-sponsor', assetId: 'synthetic-photo' }
      ]),
    feed: (c) => (c.composeFeed = 'openg20:linkedin'),
    kind: (c) => (c.composeKind = 'campaign')
  };
  for (const [field, change] of Object.entries(changes))
    await t.test(field, async (t) => {
      const f = fixture(t);
      f.controller.create();
      const original = structuredClone(f.controller.edit);
      change(f.controller);
      const draft = structuredClone(f.controller.edit);
      const feed = f.controller.composeFeed;
      const kind = f.controller.composeKind;
      f.ports.confirm = async (message, title) => {
        f.calls.confirmations.push({ message, title });
        return false;
      };
      assert.equal(f.controller.dirty(), true);
      await f.controller.requestClose();
      assert.equal(f.controller.composing(), true);
      assert.equal(f.controller.editing(), true);
      assert.deepEqual(f.controller.edit, draft);
      assert.equal(f.controller.composeFeed, feed);
      assert.equal(f.controller.composeKind, kind);
      assert.deepEqual(f.calls.confirmations, [
        {
          message: 'admin.publicationAutomation.discardChangesConfirm',
          title: feed
        }
      ]);
      assert.deepEqual(f.calls.commands, []);
      f.controller.edit = original;
      f.controller.composeFeed = 'openg7:facebook';
      f.controller.composeKind = 'news';
      assert.equal(f.controller.dirty(), false);
    });
});

for (const mode of ['edit', 'compose']) {
  test(`only an explicit discard closes the ${mode} draft without saving or authorizing it`, async (t) => {
    const f = fixture(t);
    if (mode === 'edit') f.controller.open(delivery());
    else f.controller.create();
    f.controller.edit.message = 'Unsaved synthetic content';
    await f.controller.requestClose();
    assert.equal(f.calls.confirmations.length, 1);
    assert.equal(f.controller.selected(), null);
    assert.equal(f.controller.composing(), false);
    assert.equal(f.controller.editing(), false);
    assert.deepEqual(f.calls.commands, []);
  });

  test(`a failed ${mode} save retains the draft and the error when a subsequent close is cancelled`, async (t) => {
    const f = fixture(t);
    if (mode === 'edit') f.controller.open(delivery());
    else f.controller.create();
    f.controller.edit.message = 'Draft retained after a failed save';
    const selected = f.controller.selected();
    const draft = structuredClone(f.controller.edit);
    f.ports.commands.run = async (command) => {
      f.calls.commands.push({ command });
      f.ports.error.set('SYNTHETIC_SAVE_FAILURE');
      return false;
    };
    await f.controller.save();
    assert.equal(f.calls.commands.length, 1);
    assert.equal(f.controller.selected(), selected);
    assert.equal(f.controller.composing(), mode === 'compose');
    assert.deepEqual(f.controller.edit, draft);
    assert.equal(f.controller.dirty(), true);
    f.ports.confirm = async () => false;
    await f.controller.requestClose();
    assert.equal(f.controller.selected(), selected);
    assert.equal(f.controller.composing(), mode === 'compose');
    assert.deepEqual(f.controller.edit, draft);
    assert.equal(f.ports.error(), 'SYNTHETIC_SAVE_FAILURE');
    assert.equal(f.calls.commands.length, 1);
  });
}

test('repeated close requests share one pending discard confirmation', async (t) => {
  const f = fixture(t);
  f.controller.create();
  f.controller.edit.message = 'Keep until an explicit decision';
  const confirmation = deferred();
  f.ports.confirm = (message, title) => {
    f.calls.confirmations.push({ message, title });
    return confirmation.promise;
  };
  const closing = f.controller.requestClose();
  await f.controller.requestClose();
  await f.controller.requestClose();
  assert.equal(f.calls.confirmations.length, 1);
  assert.equal(f.controller.composing(), true);
  confirmation.resolve(false);
  await closing;
  await f.controller.requestClose();
  assert.equal(f.calls.confirmations.length, 2);
  assert.equal(f.controller.composing(), true);
});

test('user close cannot discard an edit while its save command is running', async (t) => {
  const f = fixture(t);
  f.controller.open(delivery());
  f.controller.edit.message = 'Save in progress';
  const saving = deferred();
  f.ports.commands.run = async () => {
    f.ports.busy.set(true);
    await saving.promise;
    f.ports.busy.set(false);
    return false;
  };
  const savingDraft = f.controller.save();
  await f.controller.requestClose();
  assert.equal(f.controller.selected()?.id, 'synthetic-delivery');
  assert.equal(f.controller.edit.message, 'Save in progress');
  assert.deepEqual(f.calls.confirmations, []);
  saving.resolve();
  await savingDraft;
  assert.equal(f.controller.dirty(), true);
});

test('a late discard decision cannot close a different selection, version, draft or active command', async (t) => {
  const changes = {
    selection: (f) => f.controller.open(delivery({ id: 'another-delivery' })),
    version: (f) => f.controller.selected.set(delivery({ version: 8 })),
    draft: (f) => (f.controller.edit.message = 'A newer local draft'),
    composition: (f) => f.controller.create(),
    busy: (f) => f.ports.busy.set(true),
    disposed: (f) => f.controller.dispose()
  };
  for (const [scenario, change] of Object.entries(changes))
    await t.test(scenario, async (t) => {
      const f = fixture(t);
      f.controller.open(delivery());
      f.controller.edit.message = 'Draft awaiting a discard decision';
      const confirmation = deferred();
      f.ports.confirm = () => confirmation.promise;
      const closing = f.controller.requestClose();
      change(f);
      const selected = f.controller.selected();
      const composing = f.controller.composing();
      const draft = structuredClone(f.controller.edit);
      confirmation.resolve(true);
      await closing;
      assert.equal(f.controller.selected(), selected);
      assert.equal(f.controller.composing(), composing);
      assert.deepEqual(f.controller.edit, draft);
      assert.deepEqual(f.calls.commands, []);
    });
});

test('forced context cleanup bypasses draft confirmation and invalidates its pending decision', async (t) => {
  const f = fixture(t);
  f.controller.create();
  f.controller.edit.message = 'Private draft from the old context';
  const confirmation = deferred();
  f.ports.confirm = () => confirmation.promise;
  const closing = f.controller.requestClose();
  f.controller.close();
  f.controller.create();
  f.controller.edit.message = 'New context draft';
  confirmation.resolve(true);
  await closing;
  assert.equal(f.controller.composing(), true);
  assert.equal(f.controller.edit.message, 'New context draft');
  assert.deepEqual(f.calls.commands, []);
});

test('derived portraits preserve their exact photos and format while the source mediaId remains null', async (t) => {
  const f = fixture(t),
    photos = [
      {
        contributionId: 'synthetic-sponsor',
        assetId: 'own-photo',
        assetVersion: 'photo-v1'
      }
    ];
  f.controller.open(
    delivery({
      mediaId: 'synthetic-delivery',
      mediaDerivedHash: 'a'.repeat(64),
      publicationFormat: 'individual_portrait',
      photoSelections: photos,
      sponsors: [sponsor()]
    })
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.controller.edit.mediaId, '');
  assert.equal(f.controller.previewExact(), true);
  assert.equal(f.controller.dirty(), false);
  f.controller.edit.message = 'Edited portrait caption';
  await f.controller.save();
  assert.equal(f.calls.commands[0].command.mediaId, null);
  assert.equal(
    f.calls.commands[0].command.publicationFormat,
    'individual_portrait'
  );
  assert.deepEqual(f.calls.commands[0].command.photoSelections, photos);
});
test('composite photo choices use the scoped owner/version and clear the old exact preview before a new save', async (t) => {
  const f = fixture(t);
  f.controller.open(
    delivery({
      kind: 'sponsorship',
      sponsors: [sponsor(), sponsor({ id: 'second-sponsor' })]
    })
  );
  await Promise.resolve();
  f.controller.media.set([
    {
      id: 'first-photo',
      contributionId: 'synthetic-sponsor',
      version: 'photo-v1',
      kind: 'supporting_image',
      transformations: ['technical', 'composite'],
      url: '',
      alt: 'First',
      company: 'First'
    },
    {
      id: 'second-photo',
      contributionId: 'second-sponsor',
      version: 'photo-v2',
      kind: 'supporting_image',
      transformations: ['technical', 'composite'],
      url: '',
      alt: 'Second',
      company: 'Second'
    }
  ]);
  f.controller.changeFormat('collective_composite');
  f.controller.selectPhoto('synthetic-sponsor', 'second-photo');
  assert.equal(f.controller.mediaSelectionValid(), false);
  assert.deepEqual(f.controller.edit.photoSelections, []);
  f.controller.selectPhoto('synthetic-sponsor', 'first-photo');
  f.controller.selectPhoto('second-sponsor', 'second-photo');
  assert.equal(f.controller.mediaSelectionValid(), true);
  assert.equal(f.controller.previewExact(), false);
  await f.controller.save();
  assert.deepEqual(f.calls.commands[0].command.photoSelections, [
    {
      contributionId: 'second-sponsor',
      assetId: 'second-photo',
      assetVersion: 'photo-v2'
    },
    {
      contributionId: 'synthetic-sponsor',
      assetId: 'first-photo',
      assetVersion: 'photo-v1'
    }
  ]);
  f.controller.changeFormat('image_collection');
  assert.equal(f.controller.edit.publicationFormat, 'image_collection');
  assert.deepEqual(f.controller.edit.photoSelections, []);
  assert.equal(f.controller.mediaSelectionValid(), false);
});
test('a source preview alone never authorizes sending an unprepared image', async (t) => {
  const f = fixture(t);
  f.controller.open(delivery({ mediaId: 'source-image' }));
  await Promise.resolve();
  await Promise.resolve();
  f.controller.approved = true;
  assert.ok(f.controller.previewUrl());
  assert.equal(f.controller.previewExact(), false);
  await f.controller.approve();
  assert.equal(f.calls.commands.length, 0);
});

test('collection approval requires every exact preview and closing releases all private URLs', async (t) => {
  const f = fixture(t);
  const images = [
    {
      alt: 'First authorized photo',
      sha256: 'a'.repeat(64),
      width: 12,
      height: 8
    },
    {
      alt: 'Second authorized photo',
      sha256: 'b'.repeat(64),
      width: 12,
      height: 8
    }
  ];
  const selected = delivery({
    publicationFormat: 'image_collection',
    mediaId: 'synthetic-delivery',
    mediaDerivedHash: 'c'.repeat(64),
    mediaImages: images,
    sponsors: [
      sponsor({ reviewStatus: 'approved' }),
      sponsor({ id: 'second-sponsor', reviewStatus: 'approved' })
    ]
  });
  f.controller.open(selected);
  await f.controller.loadPreview(selected.mediaId);
  assert.equal(f.controller.previewExact(), true);
  assert.equal(f.controller.collectionPreviews().length, 2);
  assert.deepEqual(
    f.controller.collectionPreviews().map((image) => image.alt),
    images.map((image) => image.alt)
  );
  assert.deepEqual(
    f.calls.previews
      .slice(-2)
      .map((call) => ({ hash: call.hash, imageIndex: call.imageIndex })),
    images.map((image, imageIndex) => ({ hash: image.sha256, imageIndex }))
  );
  f.controller.approved = true;
  await f.controller.approve();
  assert.equal(f.calls.commands.length, 1);
  f.controller.close();
  assert.equal(f.controller.collectionPreviews().length, 0);
  assert.equal(f.controller.previewExact(), false);
  assert.deepEqual(
    f.revoked.slice().sort(),
    f.created.map((created) => created.url).sort()
  );
});

test('a failed or stale collection preview grants no approval and never leaks an old private URL', async (t) => {
  for (const scenario of ['failure', 'closed'])
    await t.test(scenario, async (t) => {
      const f = fixture(t),
        pending = deferred();
      f.ports.admin.publicationImagePreview = async (
        _id,
        _version,
        _hash,
        imageIndex
      ) => {
        if (imageIndex === 1) return pending.promise;
        return new Blob(['synthetic first JPEG'], { type: 'image/jpeg' });
      };
      const selected = delivery({
        publicationFormat: 'image_collection',
        mediaId: 'synthetic-delivery',
        mediaDerivedHash: 'c'.repeat(64),
        mediaImages: [
          { alt: 'First', sha256: 'a'.repeat(64) },
          { alt: 'Second', sha256: 'b'.repeat(64) }
        ]
      });
      f.controller.open(selected);
      await Promise.resolve();
      f.controller.approved = true;
      await f.controller.approve();
      assert.equal(f.calls.commands.length, 0);
      if (scenario === 'closed') f.controller.close();
      if (scenario === 'failure')
        pending.reject(new Error('Synthetic digest mismatch'));
      else pending.resolve(new Blob(['late private image']));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.controller.previewExact(), false);
      assert.equal(f.controller.collectionPreviews().length, 0);
      assert.deepEqual(
        f.revoked.slice().sort(),
        f.created.map((created) => created.url).sort()
      );
    });
});

test('an incomplete derived draft never authorizes approval or substitutes an available photo', async (t) => {
  const f = fixture(t);
  f.ports.admin.publicationMedia = async () => [
    {
      id: 'own-photo',
      contributionId: 'synthetic-sponsor',
      version: 'photo-v1',
      kind: 'supporting_image',
      transformations: ['technical', 'portrait'],
      company: 'Synthetic company',
      alt: 'Available owned photo',
      url: '/api/public/sponsor-media/own-photo'
    }
  ];
  f.controller.open(
    delivery({
      publicationFormat: 'individual_portrait',
      photoSelections: [],
      sponsors: [sponsor({ reviewStatus: 'approved' })]
    })
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.controller.media().length, 1);
  assert.deepEqual(f.controller.edit.photoSelections, []);
  assert.equal(f.controller.previewExact(), false);
  assert.equal(f.controller.previewUrl(), '');
  f.controller.approved = true;
  await f.controller.approve();
  assert.equal(f.calls.commands.length, 0);
  assert.deepEqual(f.calls.previews, []);
});

test('a retained uncertain account can be reviewed without discarding its moderation block', async (t) => {
  const f = fixture(t);
  f.controller.open(
    delivery({
      status: 'blocked',
      accountRecoveryRequired: true,
      errorCode: 'MODERATION_RESTRICTED'
    })
  );
  f.controller.absenceChecked = true;
  f.controller.absenceReason = 'Synthetic account history verified as absent';
  f.controller.confirmAbsent();
  assert.equal(f.calls.commands.at(-1).command.action, 'confirm-absent');
  assert.equal(f.controller.selected().errorCode, 'MODERATION_RESTRICTED');
});

test('visibility reads require confirmation for the exact live published delivery', async (t) => {
  const f = fixture(t);
  f.controller.open(delivery({ status: 'published', mode: 'mock' }));
  await f.controller.checkVisibility();
  assert.equal(f.calls.commands.length, 0);
  f.controller.open(delivery({ status: 'published', mode: 'live' }));
  await f.controller.checkVisibility();
  const command = f.calls.commands.at(-1).command;
  assert.equal(command.action, 'check-visibility');
  assert.equal(command.id, 'synthetic-delivery');
  assert.equal(command.version, 7);
  assert.equal(command.confirmation, command.id);
  assert.match(command.requestId, /^[a-f0-9-]{36}$/);
});

test('an unconfirmed visibility observation reuses its exact UUID after closing and reopening the delivery', async (t) => {
  const f = fixture(t);
  const published = delivery({ status: 'published', mode: 'live' });
  let confirmed = false;
  f.ports.commands.run = async (command) => {
    f.calls.commands.push({ command });
    f.ports.error.set(confirmed ? '' : 'RESULT_UNKNOWN');
    if (confirmed) f.controller.open(published);
    return confirmed;
  };
  f.controller.open(published);
  await f.controller.checkVisibility();
  const first = f.calls.commands.at(-1).command;
  f.controller.close();
  f.controller.open(published);
  confirmed = true;
  await f.controller.checkVisibility();
  assert.deepEqual(f.calls.commands.at(-1).command, first);
  await f.controller.checkVisibility();
  assert.notEqual(f.calls.commands.at(-1).command.requestId, first.requestId);
});

test('visibility confirmation cannot start a concurrent observation', async (t) => {
  const f = fixture(t);
  const confirmation = deferred();
  f.ports.confirm = () => confirmation.promise;
  f.controller.open(delivery({ status: 'published', mode: 'live' }));
  const first = f.controller.checkVisibility();
  await f.controller.checkVisibility();
  assert.equal(f.calls.commands.length, 0);
  confirmation.resolve(true);
  await first;
  assert.equal(f.calls.commands.length, 1);
});

test('approval binds the displayed delivery version and pending sponsor dossier versions', async (t) => {
  const f = fixture(t);
  const selected = delivery({
    sponsors: [
      sponsor(),
      sponsor({ id: 'already-reviewed', reviewStatus: 'approved' })
    ]
  });
  f.controller.open(selected);
  f.controller.approved = true;
  await f.controller.approve();
  assert.deepEqual(f.calls.commands, [
    {
      command: {
        action: 'approve',
        id: selected.id,
        version: 7,
        confirmation: selected.id,
        approveSponsors: [
          {
            id: 'synthetic-sponsor',
            version: 'sponsor-v4',
            moderationDecision: moderationDecision(
              { type: 'sponsorship', id: 'synthetic-sponsor' },
              'N0'
            )
          }
        ],
        moderationDecision: moderationDecision(
          { type: 'publication_delivery', id: selected.id },
          'N0'
        )
      },
      open: false
    }
  ]);
  assert.equal(f.controller.selected(), selected);
  assert.equal(f.controller.selected().status, 'draft');
});

test('approval without pending sponsors binds editorial evidence to the delivery', async (t) => {
  const f = fixture(t);
  f.controller.open(delivery());
  f.controller.approved = true;
  await f.controller.approve();
  assert.deepEqual(f.calls.commands[0].command, {
    action: 'approve',
    id: 'synthetic-delivery',
    version: 7,
    confirmation: 'synthetic-delivery',
    moderationDecision: moderationDecision(
      { type: 'publication_delivery', id: 'synthetic-delivery' },
      'N0'
    )
  });
});

test('every edit revokes the checked approval even when its original value is restored', async (t) => {
  const f = fixture(t);
  f.controller.open(delivery());
  for (const [field, changed] of [
    ['message', 'Revised content'],
    ['scheduledAt', '2026-10-06T11:00'],
    ['mediaId', 'synthetic-replacement']
  ]) {
    const original = f.controller.edit[field];
    f.controller.approved = true;
    f.controller.changeEdit(field, changed);
    assert.equal(f.controller.approved, false);
    assert.equal(f.controller.dirty(), true);
    f.controller.changeEdit(field, original);
    assert.equal(f.controller.dirty(), false);
    await f.controller.approve();
  }
  assert.equal(f.calls.commands.length, 0);
});

test('unchecked, dirty, locked, incomplete sponsor and non-draft deliveries cannot be approved', async (t) => {
  for (const blocked of ['unchecked', 'dirty', 'busy', 'photo', 'status']) {
    await t.test(blocked, async (t) => {
      const f = fixture(t);
      f.controller.open(
        delivery(
          blocked === 'photo'
            ? { sponsors: [sponsor({ presentationApproved: false })] }
            : blocked === 'status'
              ? { status: 'approved' }
              : {}
        )
      );
      f.controller.approved = blocked !== 'unchecked';
      if (blocked === 'dirty') f.controller.edit.message += ' unsaved';
      if (blocked === 'busy') f.ports.busy.set(true);
      await f.controller.approve();
      assert.equal(f.calls.commands.length, 0);
    });
  }
});

test('private media must finish the verified exact JPEG preview before the exact draft can be approved', async (t) => {
  const f = fixture(t);
  const image = deferred();
  let preview;
  const loadPreview = f.controller.loadPreview.bind(f.controller);
  f.controller.loadPreview = (id) => {
    preview = loadPreview(id);
    return preview;
  };
  f.ports.admin.publicationImagePreview = (id, version, hash) => {
    f.calls.previews.push({ id, version, hash });
    return image.promise;
  };
  f.controller.open(
    delivery({
      mediaId: 'synthetic-private',
      mediaDerivedHash: 'a'.repeat(64),
      mediaUrl: 'https://example.test/private.png',
      mediaAlt: 'Private reviewed photo'
    })
  );
  f.controller.approved = true;
  await f.controller.approve();
  assert.equal(f.calls.commands.length, 0);
  assert.deepEqual(f.calls.previews, [
    { id: 'synthetic-delivery', version: 7, hash: 'a'.repeat(64) }
  ]);
  image.resolve(new Blob(['private']));
  await preview;
  assert.equal(f.controller.previewExact(), true);
  await f.controller.approve();
  assert.equal(f.calls.commands.length, 1);
  assert.deepEqual(f.controller.mediaPreview(), {
    url: 'blob:synthetic-1',
    alt: 'Private reviewed photo'
  });
  f.controller.close();
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
});

test('invalidated media is never loaded when opening a blocked delivery', async (t) => {
  const f = fixture(t);
  for (const errorCode of [
    'MEDIA_CHANGED',
    'MEDIA_NOT_APPROVED',
    'MEDIA_UNAVAILABLE'
  ]) {
    f.controller.open(
      delivery({ status: 'blocked', mediaId: 'invalidated-private', errorCode })
    );
    assert.equal(f.controller.mediaBlocked(f.controller.selected()), true);
    assert.equal(f.controller.mediaPreview(), undefined);
  }
  assert.equal(f.calls.previews.length, 0);
  assert.equal(f.calls.errors.length, 0);
});

test('late private preview results and failures do not replace another delivery or closed drawer', async (t) => {
  for (const outcome of ['changed', 'closed', 'failed']) {
    await t.test(outcome, async (t) => {
      const f = fixture(t);
      const response = deferred();
      f.ports.admin.getSponsorMediaPreview = () => response.promise;
      f.controller.open(delivery({ mediaId: 'old-private' }));
      if (outcome === 'changed')
        f.controller.open(delivery({ id: 'next-delivery' }));
      else f.controller.close();
      if (outcome === 'failed')
        response.reject(new Error('LATE_MEDIA_FAILURE'));
      else response.resolve(new Blob(['late-private']));
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(f.controller.previewUrl(), '');
      assert.equal(f.created.length, 0);
      assert.equal(f.calls.errors.length, 0);
    });
  }
});

test('late media catalog responses and errors are ignored after navigation and disposal', async (t) => {
  for (const outcome of [
    'changed',
    'composing',
    'closed',
    'disposed',
    'failed'
  ]) {
    await t.test(outcome, async (t) => {
      const f = fixture(t);
      const response = deferred();
      f.ports.admin.publicationMedia = () => response.promise;
      f.controller.open(delivery());
      if (outcome === 'changed' || outcome === 'composing') {
        f.ports.admin.publicationMedia = async () => [
          { id: 'current', url: '', alt: 'Current', company: 'Synthetic' }
        ];
        if (outcome === 'changed')
          f.controller.open(delivery({ id: 'next-delivery' }));
        else f.controller.create();
      } else if (outcome === 'disposed') f.controller.dispose();
      else f.controller.close();
      if (outcome === 'failed')
        response.reject(new Error('LATE_CATALOG_FAILURE'));
      else
        response.resolve([
          { id: 'old', url: '', alt: 'Old', company: 'Synthetic' }
        ]);
      await Promise.resolve();
      await Promise.resolve();
      assert.deepEqual(
        f.controller.media().map((item) => item.id),
        outcome === 'changed' || outcome === 'composing' ? ['current'] : []
      );
      assert.equal(f.calls.errors.length, 0);
    });
  }
});

test('assigned images omitted from the catalog do not block exact approval of a complete pending sponsor', async (t) => {
  const f = fixture(t);
  f.controller.open(
    delivery({
      mediaId: 'assigned-private-image',
      mediaDerivedHash: 'a'.repeat(64),
      sponsors: [sponsor()]
    })
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(f.controller.media(), []);
  assert.ok(f.controller.previewUrl());
  f.controller.approved = true;
  await f.controller.approve();
  assert.deepEqual(f.calls.commands[0].command, {
    action: 'approve',
    id: 'synthetic-delivery',
    version: 7,
    confirmation: 'synthetic-delivery',
    approveSponsors: [
      {
        id: 'synthetic-sponsor',
        version: 'sponsor-v4',
        moderationDecision: moderationDecision(
          { type: 'sponsorship', id: 'synthetic-sponsor' },
          'N0'
        )
      }
    ],
    moderationDecision: moderationDecision(
      { type: 'publication_delivery', id: 'synthetic-delivery' },
      'N0'
    )
  });
});

test('delivery changes request their own catalog while editorial composition requests the global catalog', async (t) => {
  const f = fixture(t);
  const first = {
    id: 'first-image',
    url: '',
    alt: 'First',
    company: 'First sponsor'
  };
  const second = {
    id: 'second-image',
    url: '',
    alt: 'Second',
    company: 'Second sponsor'
  };
  const contexts = [];
  f.ports.admin.publicationMedia = async (id) => {
    contexts.push(id);
    return id === undefined
      ? [first, second]
      : id === 'first-delivery'
        ? [first]
        : [second];
  };
  f.controller.open(delivery({ id: 'first-delivery' }));
  await Promise.resolve();
  assert.deepEqual(f.controller.media(), [first]);
  f.controller.open(delivery({ id: 'second-delivery' }));
  assert.deepEqual(f.controller.media(), []);
  await Promise.resolve();
  assert.deepEqual(f.controller.media(), [second]);
  f.controller.create();
  assert.deepEqual(f.controller.media(), []);
  await Promise.resolve();
  assert.deepEqual(f.controller.media(), [first, second]);
  f.controller.close();
  assert.deepEqual(f.controller.media(), []);
  assert.deepEqual(contexts, ['first-delivery', 'second-delivery', undefined]);
});

test('a failed catalog load after changing delivery or composing leaves no previous options', async (t) => {
  for (const context of ['delivery', 'editorial']) {
    await t.test(context, async (t) => {
      const f = fixture(t);
      f.ports.admin.publicationMedia = async () => [
        { id: 'old-image', url: '', alt: 'Old', company: 'Previous sponsor' }
      ];
      f.controller.open(delivery());
      await Promise.resolve();
      const response = deferred();
      f.ports.admin.publicationMedia = () => response.promise;
      if (context === 'delivery')
        f.controller.open(delivery({ id: 'second-delivery' }));
      else f.controller.create();
      assert.deepEqual(f.controller.media(), []);
      const failure = new Error('CURRENT_CATALOG_UNAVAILABLE');
      response.reject(failure);
      await Promise.resolve();
      await Promise.resolve();
      assert.deepEqual(f.controller.media(), []);
      assert.deepEqual(f.calls.errors, [failure]);
    });
  }
});

test('saving rejects a new image outside the current catalog but retains the assigned image and image-free posts', async (t) => {
  const f = fixture(t);
  const existing = 'existing-reviewed-image';
  f.controller.open(delivery({ mediaId: existing }));
  f.controller.edit.message = 'Revised text with the existing reviewed image';
  await f.controller.save();
  assert.equal(f.calls.commands[0].command.mediaId, existing);
  const previewCount = f.calls.previews.length;
  f.controller.changeEdit('mediaId', 'foreign-image');
  assert.equal(f.controller.mediaSelectionValid(), false);
  assert.equal(f.calls.previews.length, previewCount);
  await f.controller.save();
  assert.equal(f.calls.commands.length, 1);
  f.ports.admin.publicationMedia = async () => [
    { id: 'current-image', url: '', alt: 'Current', company: 'Current sponsor' }
  ];
  await f.controller.loadMedia();
  f.controller.changeEdit('mediaId', 'current-image');
  await f.controller.save();
  assert.equal(f.calls.commands[1].command.mediaId, 'current-image');
  f.controller.changeEdit('mediaId', '');
  await f.controller.save();
  assert.equal(f.calls.commands[2].command.mediaId, null);
  f.controller.create();
  f.controller.edit.message = 'Editorial text';
  f.controller.edit.mediaId = 'foreign-image';
  await f.controller.save();
  assert.equal(f.calls.commands.length, 3);
});

test('current catalog and preview failures use the page error policy', async (t) => {
  const f = fixture(t);
  const catalogError = new Error('CATALOG_UNAVAILABLE');
  f.ports.admin.publicationMedia = async () => {
    throw catalogError;
  };
  await f.controller.loadMedia();
  const previewError = new Error('PRIVATE_PREVIEW_UNAVAILABLE');
  f.ports.admin.getSponsorMediaPreview = async () => {
    throw previewError;
  };
  await f.controller.loadPreview('private');
  assert.deepEqual(f.calls.errors, [catalogError, previewError]);
});

test('composition and editing retain payloads, versions, null media and server-owned success', async (t) => {
  const f = fixture(t);
  f.controller.create();
  f.controller.composeFeed = 'openg20:linkedin';
  f.controller.composeKind = 'campaign';
  f.controller.edit = {
    message: 'Synthetic campaign',
    scheduledAt: '2026-10-05T11:00',
    mediaId: ''
  };
  await f.controller.save();
  assert.deepEqual(f.calls.commands[0], {
    command: {
      action: 'compose',
      feedId: 'openg20:linkedin',
      kind: 'campaign',
      message: 'Synthetic campaign',
      scheduledAt: new Date('2026-10-05T11:00').toISOString(),
      mediaId: null
    },
    open: true
  });
  assert.equal(f.controller.composing(), true);
  f.controller.open(delivery({ status: 'approved' }));
  f.controller.edit.message = 'Explicit replacement';
  await f.controller.save();
  assert.deepEqual(f.calls.commands[1].command, {
    action: 'edit',
    id: 'synthetic-delivery',
    version: 7,
    message: 'Explicit replacement',
    scheduledAt: '2026-10-05T15:00:00.000Z',
    mediaId: null
  });
  assert.equal(f.controller.selected().status, 'approved');
});

test('invalid dates and shared command locks do not send composition or edit commands', async (t) => {
  const f = fixture(t);
  f.controller.create();
  f.controller.edit.scheduledAt = 'invalid';
  await f.controller.save();
  f.controller.open(delivery());
  f.ports.busy.set(true);
  await f.controller.save();
  await f.controller.reject();
  assert.equal(f.calls.commands.length, 0);
  assert.equal(f.calls.confirmations.length, 0);
});

for (const action of ['reject', 'cancel']) {
  test(`${action} keeps the explicit confirmation, delivery ID and displayed version`, async (t) => {
    const f = fixture(t);
    f.controller.open(
      delivery({ status: action === 'cancel' ? 'approved' : 'draft' })
    );
    await f.controller[action]();
    assert.deepEqual(
      f.calls.confirmations,
      action === 'reject'
        ? []
        : [
            {
              message: `admin.publicationAutomation.${action}Confirm`,
              title: 'openg20:linkedin'
            }
          ]
    );
    assert.deepEqual(f.calls.commands[0].command, {
      action,
      id: 'synthetic-delivery',
      version: 7,
      confirmation: 'synthetic-delivery',
      ...(action === 'reject'
        ? {
            moderationDecision: moderationDecision(
              { type: 'publication_delivery', id: 'synthetic-delivery' },
              'N3'
            )
          }
        : {})
    });
  });

  test(`${action} rechecks selection, version and command lock after confirmation`, async (t) => {
    for (const outcome of [
      'cancelled',
      'changed',
      'version',
      'closed',
      'busy'
    ]) {
      await t.test(outcome, async (t) => {
        const f = fixture(t);
        f.controller.open(
          delivery({ status: action === 'cancel' ? 'approved' : 'draft' })
        );
        f.ports[action === 'reject' ? 'moderate' : 'confirm'] = async () => {
          if (outcome === 'changed')
            f.controller.open(delivery({ id: 'different' }));
          if (outcome === 'version')
            f.controller.selected.set(delivery({ version: 8 }));
          if (outcome === 'closed') f.controller.close();
          if (outcome === 'busy') f.ports.busy.set(true);
          return outcome === 'cancelled'
            ? null
            : action === 'reject'
              ? moderationDecision(
                  { type: 'publication_delivery', id: 'synthetic-delivery' },
                  'N3'
                )
              : true;
        };
        await f.controller[action]();
        assert.equal(f.calls.commands.length, 0);
      });
    }
  });
}

test('uncertain recovery requires existing-post evidence or a substantive checked absence, and never retries', async (t) => {
  const f = fixture(t);
  f.controller.open(delivery({ status: 'uncertain' }));
  f.controller.reconcile();
  f.controller.confirmAbsent();
  assert.equal(f.calls.commands.length, 0);
  f.controller.externalPostId = 'provider:synthetic-existing';
  f.controller.reconcile();
  f.controller.absenceReason = '  short  ';
  f.controller.absenceChecked = true;
  f.controller.confirmAbsent();
  assert.equal(f.calls.commands.length, 1);
  f.controller.absenceReason =
    'Provider history checked with synthetic evidence';
  f.controller.confirmAbsent();
  assert.deepEqual(
    f.calls.commands.map(({ command }) => command),
    [
      {
        action: 'reconcile',
        id: 'synthetic-delivery',
        version: 7,
        confirmation: 'synthetic-delivery',
        externalPostId: 'provider:synthetic-existing'
      },
      {
        action: 'confirm-absent',
        id: 'synthetic-delivery',
        version: 7,
        confirmation: 'synthetic-delivery',
        reason: 'Provider history checked with synthetic evidence'
      }
    ]
  );
  assert.equal(f.controller.selected().status, 'uncertain');
});

test('media uncertainty cannot be reconciled by text alone and each delivery resets absence evidence', async (t) => {
  const f = fixture(t);
  f.controller.open(delivery({ status: 'uncertain', mediaId: 'private' }));
  f.controller.externalPostId = 'provider:synthetic';
  f.controller.absenceChecked = true;
  f.controller.absenceReason = 'Synthetic provider evidence inspected';
  f.controller.reconcile();
  assert.equal(f.calls.commands.length, 0);
  f.controller.open(delivery({ id: 'next-uncertain', status: 'uncertain' }));
  assert.equal(f.controller.externalPostId, '');
  assert.equal(f.controller.absenceReason, '');
  assert.equal(f.controller.absenceChecked, false);
});

test('construction is browser-lazy and the page controls resource disposal', async (t) => {
  const f = fixture(t);
  assert.equal(f.calls.media, 0);
  assert.equal(f.calls.previews.length, 0);
  assert.equal(f.created.length, 0);
  await f.controller.loadPreview('synthetic-private');
  f.controller.dispose();
  await f.controller.loadPreview('after-destruction');
  f.controller.open(delivery());
  f.controller.create();
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  assert.equal(f.calls.previews.length, 1);
  assert.equal(f.controller.selected(), null);
});

test('drawer preserves dossier hooks, content/media/destination, translations and the accessible shared shell', () => {
  const root =
    'apps/funding-web/src/app/features/funding/components/admin-publications/';
  const html = fs.readFileSync(
    root + 'publication-delivery-drawer.component.html',
    'utf8'
  );
  const ts = fs.readFileSync(
    root + 'publication-delivery-drawer.component.ts',
    'utf8'
  );
  assert.match(ts, /ChangeDetectionStrategy\.OnPush/);
  assert.match(ts, /input\.required<PublicationDeliveryController>/);
  assert.match(ts, /AdminDrawerComponent/);
  assert.match(html, /\(closed\)="c\.requestClose\(\)"/);
  assert.match(html, /job\.feedId.*job\.accountId/);
  assert.match(html, /job\.message/);
  assert.match(html, /\[src\]="image\.url" \[alt\]="image\.alt"/);
  for (const field of ['message', 'scheduledAt', 'mediaId'])
    assert.ok(html.includes(`c.changeEdit('${field}', $event)`));
  for (const hook of [
    'publication-media-blocker',
    'publication-review-blocker',
    'publication-payment-blocker',
    'publication-sponsor-review'
  ])
    assert.ok(html.includes(`data-og7="${hook}"`));
  assert.match(html, /sponsorshipId: sponsor\.id/);
  const keys = [...html.matchAll(/'(admin\.[^']+)'/g)]
    .map((match) => match[1])
    .filter((key) => !key.endsWith('.'));
  for (const locale of ['fr-CA', 'en']) {
    const catalog = fundingBaseTranslations(locale);
    for (const key of keys)
      assert.equal(
        typeof key.split('.').reduce((entry, part) => entry?.[part], catalog),
        'string',
        `${locale}: ${key}`
      );
  }
});
