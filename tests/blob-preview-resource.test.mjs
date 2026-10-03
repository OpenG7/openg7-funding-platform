import assert from 'node:assert/strict';
import test from 'node:test';

import { BlobPreviewResource } from '../dist/apps/funding-web/src/app/features/funding/services/blob-preview-resource.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const fixture = (t) => {
  const created = [];
  const revoked = [];
  const errors = [];
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = `blob:synthetic-${created.length + 1}`;
    created.push({ blob, url });
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const resource = new BlobPreviewResource();
  return {
    resource,
    created,
    revoked,
    errors,
    load: (source) => resource.load(source, (error) => errors.push(error))
  };
};

test('each replacement releases its previous URL, and clearing releases the current URL once', async (t) => {
  const f = fixture(t);
  const first = new Blob(['first'], { type: 'image/png' });
  const next = new Blob(['next'], { type: 'image/webp' });
  await f.load(async () => first);
  assert.equal(f.resource.url(), 'blob:synthetic-1');

  const loading = deferred();
  const request = f.load(() => loading.promise);
  assert.equal(f.resource.url(), '');
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  loading.resolve(next);
  await request;
  assert.equal(f.resource.url(), 'blob:synthetic-2');
  assert.deepEqual(
    f.created.map((entry) => entry.blob),
    [first, next]
  );

  f.resource.clear();
  f.resource.clear();
  assert.equal(f.resource.url(), '');
  assert.deepEqual(f.revoked, ['blob:synthetic-1', 'blob:synthetic-2']);
  assert.deepEqual(f.errors, []);
});

test('a delayed response cannot replace the latest selection or allocate another URL', async (t) => {
  const f = fixture(t);
  const obsolete = deferred();
  const latest = deferred();
  const firstRequest = f.load(() => obsolete.promise);
  const lastRequest = f.load(() => latest.promise);
  const blob = new Blob(['latest']);
  latest.resolve(blob);
  await lastRequest;
  obsolete.resolve(new Blob(['obsolete private media']));
  await firstRequest;

  assert.equal(f.resource.url(), 'blob:synthetic-1');
  assert.deepEqual(f.created, [{ blob, url: 'blob:synthetic-1' }]);
  assert.deepEqual(f.revoked, []);
  assert.deepEqual(f.errors, []);
});

test('only the current failure reaches error presentation, with no request replay', async (t) => {
  const f = fixture(t);
  const obsolete = deferred();
  const latest = deferred();
  let calls = 0;
  const firstRequest = f.load(() => {
    calls++;
    return obsolete.promise;
  });
  const lastRequest = f.load(() => {
    calls++;
    return latest.promise;
  });
  obsolete.reject(new Error('obsolete failure'));
  await firstRequest;
  assert.deepEqual(f.errors, []);

  const failure = new Error('current failure');
  latest.reject(failure);
  await lastRequest;
  assert.deepEqual(f.errors, [failure]);
  assert.equal(calls, 2);
  assert.equal(f.resource.url(), '');
  assert.deepEqual(f.created, []);
});

test('removing media or closing a preview invalidates unfinished success and failure callbacks', async (t) => {
  for (const outcome of ['success', 'failure']) {
    await t.test(outcome, async (t) => {
      const f = fixture(t);
      const pending = deferred();
      const request = f.load(() => pending.promise);
      await f.load(null);
      if (outcome === 'success') pending.resolve(new Blob(['late media']));
      else pending.reject(new Error('late failure'));
      await request;
      assert.equal(f.resource.url(), '');
      assert.deepEqual(f.created, []);
      assert.deepEqual(f.revoked, []);
      assert.deepEqual(f.errors, []);
    });
  }
});

test('disposal releases visible media and prevents later completions or loads from restoring it', async (t) => {
  const f = fixture(t);
  await f.load(async () => new Blob(['visible media']));
  f.resource.dispose();
  f.resource.dispose();
  let calls = 0;
  await f.load(async () => {
    calls++;
    return new Blob(['forbidden replacement']);
  });
  assert.equal(calls, 0);
  assert.equal(f.resource.url(), '');
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);

  const pendingResource = new BlobPreviewResource();
  const pending = deferred();
  const request = pendingResource.load(
    () => pending.promise,
    (error) => f.errors.push(error)
  );
  pendingResource.dispose();
  pending.resolve(new Blob(['late private media']));
  await request;
  assert.equal(pendingResource.url(), '');
  assert.equal(f.created.length, 1);
  assert.deepEqual(f.errors, []);
});

test('URL allocation failures retain the caller error policy and leave no preview', async (t) => {
  const f = fixture(t);
  const failure = new Error('object URL unavailable');
  t.mock.method(URL, 'createObjectURL', () => {
    throw failure;
  });
  await f.load(async () => new Blob(['media']));
  assert.deepEqual(f.errors, [failure]);
  assert.equal(f.resource.url(), '');
  assert.deepEqual(f.revoked, []);
});

test('construction and empty cleanup work during SSR without browser URL APIs', async (t) => {
  const f = fixture(t);
  const create = t.mock.method(URL, 'createObjectURL', () => {
    throw new Error('unexpected URL allocation');
  });
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {
    throw new Error('unexpected URL cleanup');
  });
  await f.load(null);
  f.resource.clear();
  f.resource.dispose();
  assert.equal(f.resource.url(), '');
  assert.equal(create.mock.callCount(), 0);
  assert.equal(revoke.mock.callCount(), 0);
  assert.deepEqual(f.errors, []);
});
