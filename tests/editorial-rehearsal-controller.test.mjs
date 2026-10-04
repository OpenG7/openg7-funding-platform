import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { computed, signal } from '@angular/core';

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
const { EditorialRehearsalController } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/admin-pilotage/editorial-rehearsal-controller.js');
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
  version: 7,
  feedId: 'openg7:facebook',
  kind: 'sponsorship',
  message: 'Synthetic project facts.\n\nSynthetic sponsor disclosure.',
  scheduledAt: '2026-10-06T15:00:00.000Z',
  mediaId: 'synthetic-private-media',
  mediaUrl: 'https://example.test/private.png',
  mediaAlt: 'Synthetic reviewed image',
  accountId: 'synthetic-page',
  mode: 'mock',
  sponsors: [{ id: 'synthetic-sponsor', name: 'Synthetic Company' }],
  status: 'draft',
  errorCode: null,
  ...changes
});

const variant = (changes = {}) => ({
  deliveryId: 'synthetic-delivery',
  version: 7,
  feedId: 'openg7:facebook',
  intent: 'project_first',
  before: 'Synthetic project facts.\n\nSynthetic sponsor disclosure.',
  after: 'Project first: synthetic facts.\n\nSynthetic sponsor disclosure.',
  ...changes
});

const fixture = (t) => {
  const selected = signal(delivery());
  const profile = signal({
    feedId: 'openg7:facebook',
    version: 4,
    preferences: ['neutral'],
    observations: { neutral: 3 }
  });
  const feedId = signal('openg7:facebook');
  const issues = signal([
    {
      deliveryId: 'synthetic-delivery',
      codes: ['SOURCE_NOT_ELIGIBLE'],
      repair: { version: 'synthetic-repair-v3' }
    }
  ]);
  const pending = signal(null);
  const blocked = signal(false);
  const originalDate = '2026-10-05T15:00:00.000Z';
  const calls = { variants: [], previews: [], events: [] };
  const created = [];
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = `blob:synthetic-${created.length + 1}`;
    created.push({ blob, url });
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const ports = {
    api: {
      editorialVariant: async (id, version, instruction) => {
        calls.variants.push({ id, version, instruction });
        calls.events.push('request');
        return variant();
      },
      getMediaPreview: async (id) => {
        calls.previews.push(id);
        return new Blob(['synthetic private media']);
      }
    },
    error: signal(''),
    working: signal(false),
    readonly: computed(() => blocked() || ports.working()),
    selected,
    profile,
    feedId,
    originalDate: () => originalDate,
    issue: (id) => issues().find((issue) => issue.deliveryId === id),
    setPending: (command) => {
      pending.set(command);
      calls.events.push(command === null ? 'pending.clear' : 'pending.stage');
    },
    contextChanged: () => calls.events.push('context')
  };
  const controller = new EditorialRehearsalController(ports);
  t.after(() => controller.dispose());
  return {
    controller,
    ports,
    selected,
    profile,
    feedId,
    issues,
    pending,
    blocked,
    originalDate,
    calls,
    created,
    revoked
  };
};

test('a comparison prepares the exact versioned edit while retaining protected programme facts', async (t) => {
  const f = fixture(t);
  const facts = structuredClone(f.selected());
  f.controller.changeInstruction('Projet en premier');
  f.calls.events.length = 0;
  await f.controller.transform();
  assert.deepEqual(f.calls.variants, [
    { id: facts.id, version: facts.version, instruction: 'Projet en premier' }
  ]);
  assert.deepEqual(f.calls.events, ['pending.clear', 'request', 'context']);
  assert.equal(f.ports.working(), false);
  assert.equal(f.pending(), null);
  f.controller.stageVariant();
  assert.deepEqual(f.pending(), {
    action: 'publication.edit',
    targetId: facts.id,
    version: '7',
    payload: {
      message: variant().after,
      scheduledAt: f.originalDate,
      mediaId: facts.mediaId,
      editorialIntent: 'project_first'
    }
  });
  assert.notEqual(f.pending().payload.scheduledAt, facts.scheduledAt);
  assert.deepEqual(f.selected(), facts);
  assert.deepEqual(f.calls.events.slice(-2), ['pending.stage', 'context']);
});

test('an explicit recognised intent takes precedence over the instruction field', async (t) => {
  const f = fixture(t);
  f.controller.instruction = 'Synthetic field instruction';
  await f.controller.transform('neutral');
  assert.equal(f.calls.variants[0].instruction, 'neutral');
  assert.equal(f.controller.instruction, 'Synthetic field instruction');
});

test('instruction edits clear comparison, pending intention and error in the existing order', async (t) => {
  const f = fixture(t);
  await f.controller.transform();
  f.controller.stageVariant();
  f.ports.error.set('OLD_ERROR');
  f.calls.events.length = 0;
  f.controller.changeInstruction('Nouvelle intention');
  assert.equal(f.controller.instruction, 'Nouvelle intention');
  assert.equal(f.controller.variant(), null);
  assert.equal(f.pending(), null);
  assert.equal(f.ports.error(), '');
  assert.deepEqual(f.calls.events, ['pending.clear', 'context']);
});

test('selection, instruction, feed and refresh invalidate delayed comparisons and failures', async (t) => {
  for (const change of ['selection', 'instruction', 'feed', 'refresh']) {
    for (const outcome of ['success', 'failure']) {
      await t.test(`${change}: ${outcome}`, async (t) => {
        const f = fixture(t);
        const response = deferred();
        f.ports.api.editorialVariant = () => response.promise;
        const request = f.controller.transform();
        assert.equal(f.ports.working(), true);
        if (change === 'instruction')
          f.controller.changeInstruction('Nouvelle intention');
        else {
          if (change === 'selection')
            f.selected.set(delivery({ id: 'next-delivery' }));
          if (change === 'feed') f.feedId.set('openg20:linkedin');
          if (change === 'refresh') f.selected.set(null);
          f.controller.invalidateComparison();
        }
        f.ports.error.set('CURRENT_CONTEXT_ERROR');
        if (outcome === 'success') response.resolve(variant());
        else response.reject(new Error('OBSOLETE_VARIANT_ERROR'));
        await request;
        assert.equal(f.controller.variant(), null);
        assert.equal(f.pending(), null);
        assert.equal(f.ports.error(), 'CURRENT_CONTEXT_ERROR');
        assert.equal(f.ports.working(), false);
      });
    }
  }
});

test('comparison invalidation and preference synchronisation leave the shared intention to their owner', async (t) => {
  const f = fixture(t);
  const plan = { action: 'programme.apply', targetId: 'openg7:facebook' };
  f.pending.set(plan);
  f.controller.variant.set(variant());
  f.controller.invalidateComparison();
  f.controller.syncPreferences();
  assert.equal(f.controller.variant(), null);
  assert.equal(f.pending(), plan);
  assert.deepEqual(f.controller.preferences(), ['neutral']);
  assert.deepEqual(f.calls.events, []);
});

test('getter context and returned target, feed and version must still match before showing or staging a variant', async (t) => {
  for (const change of [
    'selection',
    'feed',
    'version',
    'response-target',
    'response-feed',
    'response-version'
  ]) {
    await t.test(change, async (t) => {
      const f = fixture(t);
      const response = deferred();
      f.ports.api.editorialVariant = () => response.promise;
      const request = f.controller.transform();
      if (change === 'selection')
        f.selected.set(delivery({ id: 'next-delivery' }));
      if (change === 'feed') f.feedId.set('openg20:linkedin');
      if (change === 'version') f.selected.set(delivery({ version: 8 }));
      const result = variant(
        change === 'response-target'
          ? { deliveryId: 'other-delivery' }
          : change === 'response-feed'
            ? { feedId: 'openg20:linkedin' }
            : change === 'response-version'
              ? { version: 8 }
              : {}
      );
      response.resolve(result);
      await request;
      assert.equal(f.controller.variant(), null);
      f.controller.variant.set(result);
      f.controller.stageVariant();
      assert.equal(f.pending(), null);
    });
  }
});

test('unchanged variants, readonly contexts and missing facts cannot prepare a privileged intention', async (t) => {
  const f = fixture(t);
  f.controller.variant.set(variant({ after: variant().before }));
  f.controller.stageVariant();
  assert.equal(f.pending(), null);
  f.controller.variant.set(variant());
  f.blocked.set(true);
  await f.controller.transform();
  f.controller.stageVariant();
  f.controller.stagePreferences();
  f.controller.stageRepair('synthetic-delivery');
  assert.equal(f.pending(), null);
  assert.deepEqual(f.calls.variants, []);
  f.blocked.set(false);
  f.selected.set(null);
  f.profile.set(undefined);
  f.issues.set([]);
  await f.controller.transform();
  f.controller.stageVariant();
  f.controller.stagePreferences();
  f.controller.stageRepair('synthetic-delivery');
  assert.equal(f.pending(), null);
  assert.deepEqual(f.calls.events, []);
});

test('current variant failures retain their code or generic fallback and clear old confirmations without retry', async (t) => {
  for (const error of [
    new Error('UNKNOWN_EDITORIAL_INTENT'),
    'synthetic failure'
  ]) {
    await t.test(error instanceof Error ? error.message : error, async (t) => {
      const f = fixture(t);
      let calls = 0;
      f.controller.variant.set(variant());
      f.pending.set({ action: 'publication.edit' });
      f.ports.api.editorialVariant = async () => {
        calls++;
        throw error;
      };
      await f.controller.transform();
      assert.equal(calls, 1);
      assert.equal(f.controller.variant(), null);
      assert.equal(f.pending(), null);
      assert.equal(
        f.ports.error(),
        error instanceof Error ? error.message : 'PROGRAMME_UNAVAILABLE'
      );
      assert.equal(f.ports.working(), false);
      assert.deepEqual(f.calls.events, ['pending.clear', 'context']);
    });
  }
});

test('preference drafts read the current feed profile without changing its authoritative snapshot', async (t) => {
  const f = fixture(t);
  f.controller.syncPreferences();
  assert.notEqual(f.controller.preferences(), f.profile().preferences);
  f.pending.set({ action: 'programme.apply' });
  f.controller.toggle('concise');
  assert.equal(f.pending(), null);
  assert.deepEqual(f.controller.preferences(), ['neutral', 'concise']);
  assert.deepEqual(f.profile().preferences, ['neutral']);
  f.controller.toggle('neutral');
  f.controller.stagePreferences();
  assert.deepEqual(f.pending(), {
    action: 'editorial.preferences',
    targetId: 'openg7:facebook',
    version: '4',
    payload: { preferences: ['concise'] }
  });
  f.feedId.set('openg20:linkedin');
  f.profile.set({
    feedId: 'openg20:linkedin',
    version: 11,
    preferences: ['linkedin'],
    observations: { linkedin: 4 }
  });
  f.controller.syncPreferences();
  f.controller.stagePreferences();
  assert.deepEqual(f.pending(), {
    action: 'editorial.preferences',
    targetId: 'openg20:linkedin',
    version: '11',
    payload: { preferences: ['linkedin'] }
  });
  f.profile.set(undefined);
  f.controller.syncPreferences();
  assert.deepEqual(f.controller.preferences(), []);
});

test('preferences, variant and repair replace one facade intention and perform no mutation', async (t) => {
  const f = fixture(t);
  await f.controller.transform();
  f.controller.stageVariant();
  assert.equal(f.pending().action, 'publication.edit');
  f.controller.stagePreferences();
  assert.equal(f.pending().action, 'editorial.preferences');
  f.controller.stageRepair('synthetic-delivery');
  assert.deepEqual(f.pending(), {
    action: 'publication.repair',
    targetId: 'synthetic-delivery',
    version: 'synthetic-repair-v3'
  });
  f.issues.set([{ deliveryId: 'synthetic-delivery', repair: null }]);
  f.controller.stageRepair('synthetic-delivery');
  assert.equal(f.pending().action, 'publication.repair');
  assert.equal(f.calls.variants.length, 1);
  assert.equal(f.selected().status, 'draft');
});

test('paragraph comparison retains shared disclosures and highlights changed passages', (t) => {
  const f = fixture(t);
  assert.deepEqual(
    f.controller.paragraphs('First paragraph\n\n\nShared disclosure'),
    ['First paragraph', 'Shared disclosure']
  );
  assert.equal(
    f.controller.changed('Shared disclosure', 'Changed\n\nShared disclosure'),
    false
  );
  assert.equal(
    f.controller.changed('First paragraph', 'Changed\n\nShared disclosure'),
    true
  );
});

test('private previews use their authenticated port and release each replaced or removed blob', async (t) => {
  const f = fixture(t);
  assert.deepEqual(f.calls.previews, []);
  assert.deepEqual(f.created, []);
  await f.controller.preview();
  assert.deepEqual(f.calls.previews, ['synthetic-private-media']);
  assert.equal(f.controller.image(), 'blob:synthetic-1');
  assert.equal(f.controller.imageFailed(), false);
  f.selected.set(delivery({ id: 'next-delivery', mediaId: 'next-private' }));
  await f.controller.preview();
  assert.deepEqual(f.calls.previews, [
    'synthetic-private-media',
    'next-private'
  ]);
  assert.equal(f.controller.image(), 'blob:synthetic-2');
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  f.selected.set(delivery({ mediaId: null }));
  await f.controller.preview();
  assert.equal(f.controller.image(), '');
  assert.deepEqual(f.revoked, ['blob:synthetic-1', 'blob:synthetic-2']);
  assert.equal(f.calls.previews.length, 2);
});

test('replaced preview responses and failures cannot alter the currently selected private image', async (t) => {
  for (const outcome of ['success', 'failure']) {
    await t.test(outcome, async (t) => {
      const f = fixture(t);
      const response = deferred();
      f.ports.api.getMediaPreview = () => response.promise;
      const obsolete = f.controller.preview();
      f.selected.set(delivery({ mediaId: 'next-private' }));
      f.ports.api.getMediaPreview = async () => new Blob(['current image']);
      await f.controller.preview();
      if (outcome === 'success') response.resolve(new Blob(['obsolete image']));
      else response.reject(new Error('OBSOLETE_PREVIEW_FAILURE'));
      await obsolete;
      assert.equal(f.controller.image(), 'blob:synthetic-1');
      assert.equal(f.controller.imageFailed(), false);
      assert.equal(f.created.length, 1);
    });
  }
});

test('clearing for refresh revokes the displayed image and invalidates late private preview responses', async (t) => {
  for (const outcome of ['success', 'failure']) {
    await t.test(outcome, async (t) => {
      const f = fixture(t);
      await f.controller.preview();
      f.controller.imageFailed.set(true);
      f.controller.clearPreview();
      assert.equal(f.controller.image(), '');
      assert.equal(f.controller.imageFailed(), false);
      assert.deepEqual(f.revoked, ['blob:synthetic-1']);

      const response = deferred();
      f.ports.api.getMediaPreview = (id) => {
        f.calls.previews.push(id);
        return response.promise;
      };
      const obsolete = f.controller.preview();
      f.controller.clearPreview();
      f.selected.set(delivery({ version: 8, mediaId: 'refreshed-private' }));
      f.ports.api.getMediaPreview = async (id) => {
        f.calls.previews.push(id);
        return new Blob(['refreshed private image']);
      };
      await f.controller.preview();
      if (outcome === 'success') response.resolve(new Blob(['obsolete image']));
      else response.reject(new Error('OBSOLETE_PREVIEW_FAILURE'));
      await obsolete;

      assert.equal(f.controller.image(), 'blob:synthetic-2');
      assert.equal(f.controller.imageFailed(), false);
      assert.equal(f.created.length, 2);
      assert.deepEqual(f.revoked, ['blob:synthetic-1']);
      assert.deepEqual(f.calls.previews, [
        'synthetic-private-media',
        'synthetic-private-media',
        'refreshed-private'
      ]);
      assert.deepEqual(f.calls.events, []);
      assert.equal(f.pending(), null);
    });
  }
});

test('a current private preview failure is explicit and the next preview resets it', async (t) => {
  const f = fixture(t);
  let calls = 0;
  f.ports.api.getMediaPreview = async () => {
    calls++;
    throw new Error('PRIVATE_PREVIEW_UNAVAILABLE');
  };
  await f.controller.preview();
  assert.equal(calls, 1);
  assert.equal(f.controller.imageFailed(), true);
  assert.equal(f.controller.image(), '');
  assert.equal(f.ports.error(), '');
  f.selected.set(null);
  await f.controller.preview();
  assert.equal(f.controller.imageFailed(), false);
  assert.equal(calls, 1);
});

test('dispose revokes visible blobs once and ignores late variants, errors and protected previews', async (t) => {
  for (const outcome of ['success', 'failure']) {
    await t.test(outcome, async (t) => {
      const f = fixture(t);
      await f.controller.preview();
      const imageResponse = deferred();
      const variantResponse = deferred();
      f.ports.api.getMediaPreview = () => imageResponse.promise;
      f.ports.api.editorialVariant = () => variantResponse.promise;
      const imageRequest = f.controller.preview();
      const variantRequest = f.controller.transform();
      f.controller.dispose();
      f.controller.dispose();
      f.calls.events.length = 0;
      const working = f.ports.working();
      if (outcome === 'success') {
        imageResponse.resolve(new Blob(['late private image']));
        variantResponse.resolve(variant());
      } else {
        imageResponse.reject(new Error('LATE_PRIVATE_PREVIEW_ERROR'));
        variantResponse.reject(new Error('LATE_VARIANT_ERROR'));
      }
      await Promise.all([imageRequest, variantRequest]);
      assert.equal(f.controller.image(), '');
      assert.equal(f.controller.variant(), null);
      assert.equal(f.controller.imageFailed(), false);
      assert.equal(f.ports.error(), '');
      assert.equal(f.ports.working(), working);
      assert.deepEqual(f.calls.events, []);
      assert.equal(f.created.length, 1);
      assert.deepEqual(f.revoked, ['blob:synthetic-1']);
    });
  }
});

test('disposed controllers do not request previews, transform or prepare further intentions', async (t) => {
  const f = fixture(t);
  f.controller.dispose();
  f.controller.variant.set(variant());
  f.controller.clearPreview();
  await f.controller.preview();
  await f.controller.transform();
  f.controller.changeInstruction('After destruction');
  f.controller.toggle('concise');
  f.controller.syncPreferences();
  f.controller.stageVariant();
  f.controller.stagePreferences();
  f.controller.stageRepair('synthetic-delivery');
  assert.equal(f.controller.instruction, '');
  assert.deepEqual(f.controller.preferences(), []);
  assert.equal(f.pending(), null);
  assert.deepEqual(f.calls.events, []);
  assert.deepEqual(f.calls.variants, []);
  assert.deepEqual(f.calls.previews, []);
});
