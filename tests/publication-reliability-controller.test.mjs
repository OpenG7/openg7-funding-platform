import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicationReliabilityController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/publication-reliability-controller.js';
import { FundingAdminPublicationsClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-publications.client.js';

const page = (nextCursor = null) => ({
  scope: 'global',
  evaluatedAt: '2030-06-01T12:00:00Z',
  globalTotal: 151,
  filteredTotal: 101,
  limit: 50,
  incidents: [
    {
      code: 'ACCOUNT_RESULT_UNCERTAIN',
      subjectType: 'delivery',
      subjectId: 'synthetic'
    }
  ],
  snapshot: 'a'.repeat(32),
  nextCursor
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test('incident paging preserves global facts, navigates exact cursors and resets continuation when filters change', async () => {
  const calls = [];
  const controller = new PublicationReliabilityController({
    read: async (filter) => {
      calls.push(filter);
      return page(filter.cursor ? 'second' : 'first');
    }
  });
  await controller.refresh();
  assert.equal(controller.offset(), 0);
  assert.equal(controller.page().globalTotal, 151);
  assert.equal(controller.canPrevious(), false);
  await controller.next();
  assert.equal(controller.offset(), 50);
  assert.equal(controller.canPrevious(), true);
  await controller.previous();
  assert.equal(controller.offset(), 0);
  assert.deepEqual(calls, [{}, { cursor: 'first' }, {}]);
  controller.setCode('ACCOUNT_RESULT_UNCERTAIN');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), { code: 'ACCOUNT_RESULT_UNCERTAIN' });
  assert.equal(controller.offset(), 0);
  controller.setSubjectType('delivery');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), {
    code: 'ACCOUNT_RESULT_UNCERTAIN',
    subjectType: 'delivery'
  });
});

test('a changed snapshot requires refresh and never blindly restarts the failing cursor', async () => {
  const calls = [];
  const controller = new PublicationReliabilityController({
    read: async (filter) => {
      calls.push(filter);
      if (filter.cursor) throw new Error('RELIABILITY_SNAPSHOT_CHANGED');
      return page('first');
    }
  });
  await controller.refresh();
  await controller.next();
  assert.equal(
    controller.error(),
    'admin.publicationReliability.snapshotChanged'
  );
  assert.equal(controller.offset(), 0);
  await controller.next();
  assert.equal(calls.length, 2);
  await controller.refresh();
  assert.deepEqual(calls.at(-1), {});
  assert.equal(controller.error(), '');
});

test('late replies cannot replace a newer filter and disposed requests cannot publish state', async () => {
  const first = deferred(),
    second = deferred();
  let n = 0;
  const controller = new PublicationReliabilityController({
    read: () => (++n === 1 ? first.promise : second.promise)
  });
  const initial = controller.refresh();
  controller.setCode('ACCOUNT_RESULT_UNCERTAIN');
  second.resolve(page('current'));
  await new Promise((resolve) => setImmediate(resolve));
  first.resolve(page('obsolete'));
  await initial;
  assert.equal(controller.page().nextCursor, 'current');
  assert.equal(controller.busy(), false);
  const pending = deferred();
  const disposed = new PublicationReliabilityController({
    read: () => pending.promise
  });
  const loading = disposed.refresh();
  disposed.dispose();
  pending.resolve(page());
  await loading;
  assert.equal(disposed.page(), null);
});

test('returning to the first page cannot replace the paging snapshot without explicit refresh', async () => {
  let snapshot = 'a'.repeat(32);
  const controller = new PublicationReliabilityController({
    read: async (filter) => ({
      ...page(filter.cursor ? null : 'next'),
      snapshot
    })
  });
  await controller.refresh();
  await controller.next();
  snapshot = 'b'.repeat(32);
  await controller.previous();
  assert.equal(
    controller.error(),
    'admin.publicationReliability.snapshotChanged'
  );
  assert.equal(controller.offset(), 50);
  assert.equal(controller.page().snapshot, 'a'.repeat(32));
  await controller.refresh();
  assert.equal(controller.error(), '');
  assert.equal(controller.offset(), 0);
  assert.equal(controller.page().snapshot, snapshot);
});

test('incident client uses saved-session GET no-store and preserves structured snapshot refusal', async () => {
  const calls = [];
  const client = new FundingAdminPublicationsClient({
    requestAdminJson: async (path, options) => {
      calls.push({ path, options });
      return new Response(JSON.stringify(page()), { status: 200 });
    }
  });
  await client.publicationReliabilityIncidents({
    code: 'ACCOUNT_RESULT_UNCERTAIN',
    subjectType: 'delivery',
    cursor: 'safe_cursor'
  });
  assert.equal(
    calls[0].path,
    '/admin/publication-automation/incidents?code=ACCOUNT_RESULT_UNCERTAIN&subjectType=delivery&cursor=safe_cursor'
  );
  assert.deepEqual(calls[0].options, { auth: 'saved', cache: 'no-store' });
  const refused = new FundingAdminPublicationsClient({
    requestAdminJson: async () =>
      new Response(JSON.stringify({ code: 'RELIABILITY_SNAPSHOT_CHANGED' }), {
        status: 409
      })
  });
  await assert.rejects(refused.publicationReliabilityIncidents(), {
    message: 'RELIABILITY_SNAPSHOT_CHANGED'
  });
});
