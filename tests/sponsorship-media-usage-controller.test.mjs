import assert from 'node:assert/strict';
import test from 'node:test';
import { SponsorshipMediaUsageController } from '../dist/apps/funding-web/src/app/features/funding/services/sponsorship-media-usage-controller.js';
const usage = {
  state: 'confirmed',
  channels: ['website', 'facebook'],
  targets: ['openg7'],
  transformations: ['technical', 'portrait'],
  credit: 'Photo : Atelier synthétique',
  restrictions: null
};
const asset = {
  id: 'synthetic-photo',
  contributionId: 'synthetic-dossier',
  kind: 'supporting_image',
  version: 'asset-v1',
  usage
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function fixture() {
  const calls = [],
    busy = [],
    state = {
      token: 'synthetic-private-link-A',
      assets: [asset],
      preference: { revision: 3 },
      fail: false,
      refreshes: 0,
      withdraw: true
    };
  const ports = {
    token: () => state.token,
    assets: () => state.assets,
    preference: () => state.preference,
    isBrowser: () => true,
    busyChange: (value) => busy.push(value),
    refresh: async () => {
      state.refreshes++;
    },
    confirmWithdrawal: () => state.withdraw,
    service: {
      updateSponsorshipMediaUsage: async (payload) => {
        calls.push(structuredClone(payload));
        if (state.fail) throw new Error('Synthetic unavailable');
        return { updated: true };
      },
      requestSponsorshipMediaPreference: async (payload) => {
        calls.push(structuredClone(payload));
        if (state.fail) throw new Error('Synthetic unavailable');
        return { updated: true };
      }
    }
  };
  return {
    controller: new SponsorshipMediaUsageController(ports),
    calls,
    busy,
    state,
    ports
  };
}
test('usage updates capture exact rights/asset version and refresh only after server confirmation', async () => {
  const f = fixture();
  await f.controller.updateUsage(asset, usage);
  assert.deepEqual(
    { ...f.calls[0], requestId: 'captured' },
    {
      token: f.state.token,
      assetId: asset.id,
      expectedVersion: 'asset-v1',
      requestId: 'captured',
      confirmed: true,
      usage
    }
  );
  assert.match(f.calls[0].requestId, /^[a-f0-9-]{36}$/);
  assert.equal(f.state.refreshes, 1);
  assert.equal(f.controller.pending(), null);
  assert.deepEqual(f.busy, [true, false]);
});
test('uncertain usage keeps the same UUID and exact payload; a changed grant cannot bypass verification', async () => {
  const f = fixture();
  f.state.fail = true;
  await f.controller.updateUsage(asset, usage);
  const first = f.calls[0];
  assert.equal(f.controller.notice(), 'mutationUnavailable');
  await f.controller.updateUsage(asset, { ...usage, credit: 'Another author' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.notice(), 'verificationRequired');
  f.state.fail = false;
  await f.controller.retry();
  assert.deepEqual(f.calls[1], first);
  assert.equal(f.state.refreshes, 1);
  assert.equal(f.controller.pending(), null);
});
test('a token change and reset discards late results from the previous dossier', async () => {
  const f = fixture(),
    waiting = deferred();
  f.ports.service.updateSponsorshipMediaUsage = () => waiting.promise;
  const saving = f.controller.updateUsage(asset, usage);
  assert.equal(f.controller.busy(), true);
  f.state.token = 'synthetic-private-link-B';
  f.controller.reset();
  waiting.resolve({ updated: true });
  await saving;
  assert.equal(f.state.refreshes, 0);
  assert.equal(f.controller.notice(), '');
  assert.equal(f.controller.busy(), false);
  assert.equal(f.controller.pending(), null);
});
test('withdrawal requires confirmation and retains only this asset permission scope', async () => {
  const f = fixture();
  f.state.withdraw = false;
  await f.controller.withdraw(asset);
  assert.equal(f.calls.length, 0);
  f.state.withdraw = true;
  await f.controller.withdraw(asset);
  assert.deepEqual(f.calls[0].usage, { ...usage, state: 'withdrawn' });
  await f.controller.updateUsage({ ...asset, version: 'stale-version' }, usage);
  assert.equal(f.calls.length, 1);
});
test('owned photo preference sends current revision and correction once; foreign/logo selections are ignored', async () => {
  const f = fixture();
  f.controller.correction.set('Please use this exact photograph.');
  await f.controller.propose({ ...asset, id: 'foreign' });
  await f.controller.propose({ ...asset, kind: 'logo' });
  assert.equal(f.calls.length, 0);
  f.state.fail = true;
  await f.controller.propose(asset);
  const first = f.calls[0];
  assert.equal(first.expectedRevision, 3);
  assert.equal(first.assetId, asset.id);
  assert.equal(first.correction, 'Please use this exact photograph.');
  f.state.fail = false;
  await f.controller.retry();
  assert.deepEqual(f.calls[1], first);
  assert.equal(f.controller.correction(), '');
  assert.equal(f.state.refreshes, 1);
});
