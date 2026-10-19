import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminSponsorshipAdoptionController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-adoption-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

function fixture() {
  const state = {
    owner: true,
    destroyed: false,
    identity: 'synthetic-owner',
    calls: [],
    failure: null,
    response: null,
    redirects: 0
  };
  const c = new AdminSponsorshipAdoptionController({
    canOwn: () => state.owner,
    destroyed: () => state.destroyed,
    identity: () => state.identity,
    preview: async (pageSize, cursor) => {
      state.calls.push({ pageSize, cursor });
      if (state.failure) throw state.failure;
      return state.response ?? { items: [], pageSize, nextCursor: null };
    },
    unauthorized: async () => {
      state.redirects++;
    }
  });
  return { c, state };
}

test('adoption inventory reads only on request and only for the owner', async () => {
  const { c, state } = fixture();
  assert.equal(state.calls.length, 0);
  for (const owner of [false, true]) {
    state.owner = owner;
    await c.load();
  }
  assert.deepEqual(state.calls, [{ pageSize: 25, cursor: undefined }]);
  state.destroyed = true;
  await c.load();
  assert.equal(state.calls.length, 1);
});

test('portfolio reads retain their stable cursor and bounded page size', async () => {
  const { c, state } = fixture();
  c.pageSize.set(50);
  state.response = { items: [], pageSize: 50, nextCursor: 'synthetic-cursor' };
  await c.load();
  state.response = { items: [], pageSize: 50, nextCursor: null };
  await c.load(true);
  await c.load(true);
  assert.deepEqual(state.calls, [
    { pageSize: 50, cursor: undefined },
    { pageSize: 50, cursor: 'synthetic-cursor' }
  ]);
});

test('a changed owner session discards the old inventory and in-flight result', async () => {
  const { c, state } = fixture();
  let resolve;
  state.response = new Promise((done) => {
    resolve = done;
  });
  const reading = c.load();
  state.identity = 'another-synthetic-owner';
  c.reset();
  resolve({
    items: [{ contributionId: 'synthetic-old-private-dossier' }],
    pageSize: 25,
    nextCursor: null
  });
  await reading;
  assert.equal(c.data(), null);
  assert.equal(c.loading(), false);
});

test('authorization errors remain errors and an expired session follows shared handling', async () => {
  const { c, state } = fixture();
  state.failure = new AdminDashboardRequestError(403);
  await c.load();
  assert.equal(c.error(), 'ownerRequired');
  assert.equal(c.data(), null);
  state.failure = new AdminDashboardRequestError(401);
  await c.load();
  assert.equal(state.redirects, 1);
  assert.equal(c.loading(), false);
});
