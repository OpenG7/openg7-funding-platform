import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaReviewConsentPreviews } from '../dist/apps/funding-web/src/app/features/funding/components/media-review/media-review-consent-previews.js';

const contributionId = '10000000-0000-4000-8000-000000000801';
const first = {
  id: '10000000-0000-4000-8000-000000000802',
  version: '2026-11-01 12:00:00+00'
};
const second = {
  id: '10000000-0000-4000-8000-000000000803',
  version: '2026-11-02 12:00:00+00'
};
const delivery = (mediaSnapshot = [first, second]) => ({
  purpose: 'media_consent',
  contributionId,
  contextVersion: 'a'.repeat(64),
  mediaSnapshot
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture(t) {
  const requests = [],
    allocated = [],
    revoked = [];
  t.mock.method(URL, 'createObjectURL', () => {
    const url = 'blob:synthetic-consent-' + allocated.length;
    allocated.push(url);
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const c = new MediaReviewConsentPreviews(
    (id, version) =>
      new Promise((resolve, reject) =>
        requests.push({ id, version, resolve, reject })
      )
  );
  t.after(() => c.dispose());
  return {
    c,
    requests,
    allocated,
    revoked,
    finish(index) {
      requests[index].resolve(new Blob(['synthetic'], { type: 'image/webp' }));
    }
  };
}

test('consent previews use only the exact server manifest and preserve its order and versions', async (t) => {
  const f = fixture(t);
  const prepared = delivery([second, first]);
  f.c.setManifest(prepared, contributionId, 'synthetic-session');
  assert.deepEqual(f.c.manifest(), [second, first]);
  assert.deepEqual(
    f.requests.map(({ id, version }) => ({ id, version })),
    [second, first]
  );
  f.c.setManifest(prepared, contributionId, 'synthetic-session');
  assert.equal(f.requests.length, 2);
  f.finish(0);
  f.finish(1);
  await flush();
  assert.equal(f.allocated.length, 2);
  f.c.setManifest(null, contributionId, 'synthetic-session');
  assert.deepEqual(f.c.manifest(), []);
  assert.deepEqual(f.revoked, f.allocated);
});

test('invalid, duplicated or foreign consent manifests never load private images', (t) => {
  const f = fixture(t);
  for (const invalid of [
    { ...delivery(), contributionId: second.id },
    { ...delivery(), purpose: 'public_consent' },
    { ...delivery(), contextVersion: 'invalid' },
    delivery([]),
    delivery([first, first]),
    delivery([{ ...first, version: '' }]),
    delivery([{ ...first, version: '\n' }]),
    delivery([{ id: 'invalid', version: 'v1' }]),
    delivery(Array.from({ length: 101 }, () => first)),
    'invalid'
  ]) {
    f.c.setManifest(invalid, contributionId, 'synthetic-session');
    assert.equal(f.c.unavailable(), true);
    assert.deepEqual(f.c.manifest(), []);
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.allocated.length, 0);
});

test('removed photos and changed sessions cancel late previews and revoke the previous private URLs', async (t) => {
  const f = fixture(t);
  f.c.setManifest(delivery(), contributionId, 'session-one');
  f.c.setManifest(delivery([second]), contributionId, 'session-one');
  f.finish(0);
  f.finish(1);
  f.finish(2);
  await flush();
  assert.equal(f.allocated.length, 1);
  assert.deepEqual(f.c.manifest(), [second]);
  f.c.setManifest(delivery([second]), contributionId, 'session-two');
  assert.deepEqual(f.revoked, f.allocated);
  f.c.setManifest(null, contributionId, 'session-two');
  f.finish(3);
  await flush();
  assert.equal(f.allocated.length, 1);
  assert.deepEqual(f.c.previews.previews(), {});
});

test('current metadata can invalidate a prepared photo but never replace or extend its manifest', async (t) => {
  const f = fixture(t);
  f.c.setManifest(delivery(), contributionId, 'synthetic-session', [
    first,
    second
  ]);
  f.finish(0);
  f.finish(1);
  await flush();
  assert.equal(f.allocated.length, 2);
  f.c.setManifest(delivery(), contributionId, 'synthetic-session', [
    { ...first, version: 'newer' }
  ]);
  assert.deepEqual(f.c.manifest(), [first, second]);
  assert.deepEqual(f.revoked, f.allocated);
  assert.equal(f.requests.length, 2);
  for (const entry of [first, second])
    assert.deepEqual(
      f.c.previews.previews()[f.c.previews.key(entry.id, entry.version)],
      { url: '', failed: true }
    );
});

test('a refused version stays unavailable without falling back to another image or an unversioned request', async (t) => {
  const f = fixture(t);
  f.c.setManifest(delivery([first]), contributionId, 'synthetic-session');
  f.requests[0].reject(new Error('MEDIA_VERSION_CONFLICT'));
  await flush();
  const key = f.c.previews.key(first.id, first.version);
  assert.deepEqual(f.c.previews.previews()[key], { url: '', failed: true });
  assert.equal(f.allocated.length, 0);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.c.manifest(), [first]);
});
